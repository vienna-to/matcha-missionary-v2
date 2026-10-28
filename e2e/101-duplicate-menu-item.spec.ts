import { autoAcceptDialogs, createEvent, expect, field, goTab, openApp, placeOrder, readState, test } from "./support";
import { modal, openMenuEditor } from "./extra";

/** Menu Manager > Duplicate: an independent copy of a drink, opened for editing. */
const item = async (page: import("@playwright/test").Page, name: string) =>
  (await readState(page)).menuItems.find((m: any) => m.name === name);

test.describe("duplicate a menu item", () => {
  test("the copy is complete, named (copy), opens for editing, and is independent of the original", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await goTab(page, "Menu Manager");
    const original = await item(page, "Classic Matcha");
    expect(original.ingredientLines.length).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Duplicate Classic Matcha", exact: true }).click();
    const dlg = modal(page, /Edit menu item/);
    await expect(dlg).toBeVisible();
    await expect(field(dlg, "Name")).toHaveValue("Classic Matcha (copy)");

    // everything came across (checked on the stored copy)
    const copy = await item(page, "Classic Matcha (copy)");
    expect(copy.id).not.toBe(original.id);
    expect(copy.ingredientLines).toEqual(original.ingredientLines);
    for (const k of ["price", "size", "category", "description", "taxable", "defaultMilkId", "defaultCreamId", "allowedMilkIds", "allowedCreamIds"]) {
      expect(copy[k], k).toEqual(original[k]); // (stored as JSON: an unset field is simply absent on both)
    }
    expect(copy.active).toBe(true);

    // edit the copy: rename, new price, no milk
    await field(dlg, "Name").fill("Iced Matcha");
    await field(dlg, "Price ($)").fill("9.5");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden();

    // the original did not move at all
    expect(await item(page, "Classic Matcha")).toEqual(original);
    expect((await item(page, "Iced Matcha")).price).toBe(9.5);

    // and editing the original leaves the copy alone
    const editOriginal = await openMenuEditor(page, "Classic Matcha");
    await field(editOriginal, "Price ($)").fill("8.25");
    await editOriginal.getByRole("button", { name: "Save" }).click();
    await expect(editOriginal).toBeHidden();
    expect((await item(page, "Iced Matcha")).price).toBe(9.5);
    expect((await item(page, "Classic Matcha")).price).toBe(8.25);
  });

  test("a second copy is numbered; duplicating a copy does not stack suffixes", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await goTab(page, "Menu Manager");
    await page.getByRole("button", { name: "Duplicate Hojicha Latte", exact: true }).click();
    await modal(page, /Edit menu item/).getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Duplicate Hojicha Latte", exact: true }).click();
    await modal(page, /Edit menu item/).getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Duplicate Hojicha Latte (copy)", exact: true }).click();
    await modal(page, /Edit menu item/).getByRole("button", { name: "Cancel" }).click();
    const names = (await readState(page)).menuItems.map((m: any) => m.name).filter((n: string) => n.startsWith("Hojicha Latte"));
    expect(names.sort()).toEqual(["Hojicha Latte", "Hojicha Latte (copy 2)", "Hojicha Latte (copy 3)", "Hojicha Latte (copy)"].sort());
  });

  test("the copy sells and costs exactly like the original", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Dup sale" });
    await goTab(page, "Menu Manager");
    await page.getByRole("button", { name: "Duplicate Classic Matcha", exact: true }).click();
    await modal(page, /Edit menu item/).getByRole("button", { name: "Save" }).click(); // keep it unchanged
    await goTab(page, "Live Orders");
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Orig", pay: "Cash", declineCombo: true });
    await placeOrder(page, { items: [{ name: "Classic Matcha \\(copy\\)" }], name: "Copy", pay: "Cash", declineCombo: true });
    const orders = (await readState(page)).orders;
    const a = orders.find((o: any) => o.customerName === "Orig").items[0];
    const b = orders.find((o: any) => o.customerName === "Copy").items[0];
    expect(b.menuItemNameSnap).toBe("Classic Matcha (copy)");
    expect(b.costSnap).toBe(a.costSnap);
    expect(b.priceSnap).toBe(a.priceSnap);
  });

  test("duplicating an archived item gives an active copy", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await goTab(page, "Menu Manager");
    await page.locator('main button[title="Archive"]').first().click();
    const archivedName = (await readState(page)).menuItems.find((m: any) => !m.active).name;
    await page.getByRole("button", { name: `Duplicate ${archivedName}`, exact: true }).click();
    await modal(page, /Edit menu item/).getByRole("button", { name: "Cancel" }).click();
    expect((await item(page, `${archivedName} (copy)`)).active).toBe(true);
    expect((await item(page, archivedName)).active).toBe(false);
  });
});
