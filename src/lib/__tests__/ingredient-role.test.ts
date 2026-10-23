import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromIngredient, toIngredientInsert, toIngredientPatch, type DbIngredient } from "@/lib/supabase/serialize";
import { clearSaveErrors, getSaveErrors } from "@/lib/supabase/save-errors";
import { writer } from "@/lib/supabase/writer";
import type { Ingredient } from "@/lib/types";

/**
 * The ingredient role (base / topping / none) must round-trip, and the app must
 * keep working on a database that does not have the custom_role column yet.
 */
const T = "2026-01-01T00:00:00.000Z";
const ING: Ingredient = {
  id: "i1", name: "Hojicha powder", packagePrice: 32, packageAmount: 100, unit: "g", pool: null, createdAt: T, updatedAt: T,
};
const row = (over: Partial<DbIngredient> = {}): DbIngredient => ({
  id: "i1", workspace_id: "w", name: "Hojicha powder", package_price: 32, package_amount: 100, unit: "g",
  pool: null, sort_order: null, created_at: T, updated_at: T, ...over,
});
const MISSING = { code: "PGRST204", message: "Could not find the 'custom_role' column of 'ingredients' in the schema cache" };

describe("serialize", () => {
  it("reads the role, and a row without the column (old database) has no role", () => {
    expect(fromIngredient(row({ custom_role: "base" })).customRole).toBe("base");
    expect(fromIngredient(row({ custom_role: null })).customRole).toBeUndefined();
    expect(fromIngredient(row()).customRole).toBeUndefined();
  });
  it("does not send custom_role unless the role is set, so adding an ingredient works before the migration", () => {
    expect("custom_role" in toIngredientInsert("w", ING)).toBe(false);
    expect(toIngredientInsert("w", { ...ING, customRole: "topping" }).custom_role).toBe("topping");
  });
  it("a patch sends the role only when it changes", () => {
    expect(toIngredientPatch({ packagePrice: 3 })).toEqual({ package_price: 3 });
    expect(toIngredientPatch({ customRole: "none" })).toEqual({ custom_role: "none" });
  });
});

function fake(failWhenRole: boolean) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    from: () => ({
      insert: (r: Record<string, unknown>) => {
        inserts.push(r);
        return Promise.resolve({ error: failWhenRole && "custom_role" in r ? MISSING : null });
      },
      update: (r: Record<string, unknown>) => {
        updates.push(r);
        const result = { error: failWhenRole && "custom_role" in r ? MISSING : null };
        const chain = { eq: () => chain, then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res) };
        return chain;
      },
    }),
  } as unknown as SupabaseClient;
  return { client, inserts, updates };
}

describe("writer on a database without the custom_role column", () => {
  beforeEach(() => clearSaveErrors());

  it("setting a role still saves the other fields and tells the user to run the migration", async () => {
    const { client, updates } = fake(true);
    await writer(client, "w").updateIngredient("i1", { customRole: "base", packagePrice: 40 });
    expect(updates).toEqual([{ custom_role: "base", package_price: 40 }, { package_price: 40 }]);
    expect(getSaveErrors()[0].message).toContain("migration-add-ingredient-custom-role.sql");
  });

  it("a role-only change reports and does not retry an empty update", async () => {
    const { client, updates } = fake(true);
    await writer(client, "w").updateIngredient("i1", { customRole: "none" });
    expect(updates).toHaveLength(1);
    expect(getSaveErrors()).toHaveLength(1);
  });

  it("adding an ingredient with a role falls back to saving it without the role", async () => {
    const { client, inserts } = fake(true);
    await writer(client, "w").addIngredient({ ...ING, customRole: "topping" });
    expect(inserts).toHaveLength(2);
    expect("custom_role" in inserts[1]).toBe(false);
    expect(getSaveErrors()[0].message).toContain("without its custom drink role");
  });

  it("with the column present, nothing is reported", async () => {
    const { client, updates } = fake(false);
    await writer(client, "w").updateIngredient("i1", { customRole: "base" });
    expect(updates).toEqual([{ custom_role: "base" }]);
    expect(getSaveErrors()).toHaveLength(0);
  });

  it("an ordinary edit (no role) never touches the column", async () => {
    const { client, updates } = fake(true);
    await writer(client, "w").updateIngredient("i1", { packagePrice: 41 });
    expect(updates).toEqual([{ package_price: 41 }]);
  });
});
