import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clearSaveErrors, getSaveErrors } from "@/lib/supabase/save-errors";
import { writer } from "@/lib/supabase/writer";
import type { Ingredient } from "@/lib/types";

/**
 * Two independent migrations add ingredient columns: custom_role
 * (migration-add-ingredient-custom-role.sql) and kind + sub_recipe
 * (migration-add-prepared-ingredients.sql). Production may have either, both or
 * neither. For every combination, whatever the writer saves must be safe:
 *  - a prepared ingredient is NEVER saved as a raw row (it would cost $0);
 *  - a price, yield or unit that belongs to a prepared ingredient is NEVER
 *    written onto the database's raw row;
 *  - everything that can be saved still is, and each missing column is reported.
 */
const T = "2026-01-01T00:00:00.000Z";
const RAW: Ingredient = { id: "r1", name: "Agave", packagePrice: 8.99, packageAmount: 660, unit: "ml", pool: null, createdAt: T, updatedAt: T };
const PREP: Ingredient = {
  id: "p1", name: "Syrup", packagePrice: 0, packageAmount: 500, unit: "ml", pool: null, kind: "prepared",
  subRecipe: [{ ingredientId: "r1", amount: 100, unit: "ml" }], createdAt: T, updatedAt: T,
};

type Cols = { role: boolean; prepared: boolean };
const COMBOS: Array<[string, Cols]> = [
  ["neither migration applied", { role: false, prepared: false }],
  ["only the role migration applied", { role: true, prepared: false }],
  ["only the prepared migration applied", { role: false, prepared: true }],
  ["both migrations applied", { role: true, prepared: true }],
];

/** A database with only some of the columns: rejects a payload naming a missing one (first in key order, like PostgREST). */
function fakeDb(cols: Cols) {
  const missing = (key: string) =>
    (key === "custom_role" && !cols.role) || ((key === "kind" || key === "sub_recipe") && !cols.prepared);
  const applied: Array<{ op: "insert" | "update"; row: Record<string, unknown> }> = [];
  const attempts: Array<Record<string, unknown>> = [];
  const check = (row: Record<string, unknown>) => {
    attempts.push(row);
    const bad = Object.keys(row).find(missing);
    return bad ? { code: "PGRST204", message: `Could not find the '${bad}' column of 'ingredients' in the schema cache` } : null;
  };
  const client = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        const error = check(row);
        if (!error) applied.push({ op: "insert", row });
        return Promise.resolve({ error });
      },
      update: (row: Record<string, unknown>) => {
        const error = check(row);
        if (!error) applied.push({ op: "update", row });
        const chain = { eq: () => chain, then: (res: (v: unknown) => unknown) => Promise.resolve({ error }).then(res) };
        return chain;
      },
    }),
  } as unknown as SupabaseClient;
  return { client, applied, attempts };
}

const messages = () => getSaveErrors().map((e) => e.message).join(" | ");
const PREPARED_ONLY_FIELDS = ["package_price", "package_amount", "unit", "kind", "sub_recipe"];

describe.each(COMBOS)("ingredient writes when %s", (_label, cols) => {
  beforeEach(() => clearSaveErrors());

  it("a plain raw ingredient is added and edited with no error", async () => {
    const { client, applied } = fakeDb(cols);
    await writer(client, "w").addIngredient(RAW);
    await writer(client, "w").updateIngredient("r1", { packagePrice: 9.5 }, RAW);
    expect(applied.map((a) => a.op)).toEqual(["insert", "update"]);
    expect(applied[1].row).toEqual({ package_price: 9.5 });
    expect(getSaveErrors()).toHaveLength(0);
  });

  it("a raw ingredient with a role is saved, with the role only if the database has the column", async () => {
    const { client, applied } = fakeDb(cols);
    await writer(client, "w").addIngredient({ ...RAW, customRole: "topping" });
    expect(applied).toHaveLength(1);
    expect("custom_role" in applied[0].row).toBe(cols.role);
    expect(getSaveErrors().length > 0).toBe(!cols.role);
    if (!cols.role) expect(messages()).toContain("migration-add-ingredient-custom-role.sql");
  });

  it("setting a role alone saves it or reports; setting it with another edit keeps the other edit", async () => {
    const { client, applied } = fakeDb(cols);
    await writer(client, "w").updateIngredient("r1", { customRole: "base", name: "Agave 2" }, RAW);
    expect(applied).toHaveLength(1);
    expect(applied[0].row.name).toBe("Agave 2");
    expect("custom_role" in applied[0].row).toBe(cols.role);
    expect(getSaveErrors().length > 0).toBe(!cols.role);
  });

  it("a prepared ingredient is saved as prepared, or not at all: never as a raw row", async () => {
    const { client, applied } = fakeDb(cols);
    await writer(client, "w").addIngredient({ ...PREP, customRole: "topping" });
    if (cols.prepared) {
      expect(applied).toHaveLength(1);
      expect(applied[0].row.kind).toBe("prepared");
      expect(applied[0].row.sub_recipe).toEqual(PREP.subRecipe);
      expect("custom_role" in applied[0].row).toBe(cols.role); // role dropped only if its column is missing
      expect(getSaveErrors().length > 0).toBe(!cols.role);
    } else {
      expect(applied).toHaveLength(0); // no insert at all, in particular none without `kind`
      expect(messages()).toContain("migration-add-prepared-ingredients.sql");
    }
  });

  it("turning a raw ingredient into a prepared one never zeroes its price, yield or unit in the database", async () => {
    const { client, applied } = fakeDb(cols);
    await writer(client, "w").updateIngredient(
      "r1",
      { kind: "prepared", subRecipe: [], packagePrice: 0, name: "Agave prep" },
      RAW,
    );
    if (cols.prepared) {
      expect(applied[0].row).toMatchObject({ kind: "prepared", package_price: 0, name: "Agave prep" });
    } else {
      for (const a of applied) for (const f of PREPARED_ONLY_FIELDS) expect(f in a.row, `${f} must not be written`).toBe(false);
      expect(applied.some((a) => a.row.name === "Agave prep")).toBe(true); // the unrelated part still saved
      expect(messages()).toContain("migration-add-prepared-ingredients.sql");
    }
  });

  it("a prepared ingredient that is only on this device never overwrites a raw row with its recipe, yield or unit", async () => {
    const { client, applied } = fakeDb(cols);
    const w = writer(client, "w");
    // convert (fails when the columns are missing), then edit its recipe and yield, then its yield alone
    await w.updateIngredient("r1", { kind: "prepared", subRecipe: [], packagePrice: 0 }, RAW);
    const local: Ingredient = { ...RAW, kind: "prepared", subRecipe: [], packagePrice: 0 };
    await w.updateIngredient("r1", { subRecipe: [{ ingredientId: "x", amount: 1, unit: "ml" }], packageAmount: 500, unit: "ml" }, local);
    await w.updateIngredient("r1", { packageAmount: 400 }, local);
    if (!cols.prepared) {
      for (const a of applied) for (const f of PREPARED_ONLY_FIELDS) expect(f in a.row, `${f} must not be written`).toBe(false);
    } else {
      expect(applied).toHaveLength(3); // columns exist: everything is saved normally
    }
  });

  it("turning a prepared ingredient back to raw is saved (kind only when the column exists)", async () => {
    const { client, applied } = fakeDb(cols);
    await writer(client, "w").updateIngredient("p1", { kind: "raw", subRecipe: [], packagePrice: 5 }, PREP);
    expect(applied).toHaveLength(1);
    expect(applied[0].row.package_price).toBe(5);
    expect("kind" in applied[0].row).toBe(cols.prepared);
  });

  it("an ordinary edit of a raw ingredient never touches any new column", async () => {
    const { client, attempts } = fakeDb(cols);
    await writer(client, "w").updateIngredient("r1", { packageAmount: 700, unit: "ml", name: "Agave" }, RAW);
    for (const a of attempts) for (const f of ["custom_role", "kind", "sub_recipe"]) expect(f in a).toBe(false);
  });
});
