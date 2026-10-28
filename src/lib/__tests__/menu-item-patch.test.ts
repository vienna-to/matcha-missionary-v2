import { describe, expect, it } from "vitest";
import { toMenuItemPatch } from "@/lib/supabase/serialize";

/**
 * Unticking "Uses milk?" / "Uses cream?" in Menu Manager saves defaultMilkId / defaultCreamId as undefined.
 * That has to CLEAR the column; skipping it left the old default in the database (the box then ticked
 * itself again after the next sync and looked dead).
 */
describe("toMenuItemPatch clears a default milk / cream", () => {
  it("an explicit undefined default becomes null", () => {
    expect(
      toMenuItemPatch({ defaultMilkId: undefined, allowedMilkIds: [], defaultCreamId: undefined, allowedCreamIds: [] }),
    ).toMatchObject({ default_milk_id: null, allowed_milk_ids: [], default_cream_id: null, allowed_cream_ids: [] });
  });

  it("a chosen default is written", () => {
    expect(toMenuItemPatch({ defaultMilkId: "m1", allowedMilkIds: ["m1", "m2"] })).toMatchObject({
      default_milk_id: "m1",
      allowed_milk_ids: ["m1", "m2"],
    });
  });

  it("a patch that does not mention the defaults leaves them alone (archive, price, rename...)", () => {
    for (const patch of [{ active: false }, { price: 7 }, { name: "x" }, { ingredientLines: [] }]) {
      const row = toMenuItemPatch(patch);
      expect("default_milk_id" in row).toBe(false);
      expect("default_cream_id" in row).toBe(false);
    }
  });

  it("the whole draft the editor saves (explicit undefined for a drink without milk) clears nothing it should not", () => {
    const row = toMenuItemPatch({ name: "Pastry", price: 5, defaultMilkId: undefined, defaultCreamId: undefined });
    expect(row.default_milk_id).toBeNull();
    expect(row.default_cream_id).toBeNull();
    expect(row.name).toBe("Pastry");
  });
});
