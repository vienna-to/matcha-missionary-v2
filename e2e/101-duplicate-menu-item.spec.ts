import { autoAcceptDialogs, createEvent, expect, field, goTab, openApp, placeOrder, readState, test } from "./support";
import { modal, openMenuEditor } from "./extra";

/**
 * Menu Manager > Duplicate: opens the editor on an UNSAVED draft copy. Nothing exists until Save; Cancel or
 * clicking outside discards it. Saving produces a complete, independent copy.
 */
type P = import("@playwright/test").Page;
const items = async (page: P) => (await readState(page)).menuItems as any[];
const item = async (page: P, name: string) => (await items(page)).find((m) => m.name === name);
const dup = (page: P, name: string) => page.getByRole("button", { name: `Duplicate ${name}`, exact: true }).click();

test.describe("duplicate a menu item", () => {
  test("Cancel creates nothing", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await goTab(page, "Menu Manager");
    const before = (await items(page)).length;

    await dup(page, "Classic Matcha");
    const dlg = modal(page, /Duplicate menu item/);
    await expect(dlg).toBeVisible();
    await expect(field(dlg, "Name")).toHaveValue("Classic Matcha (copy)");
    // while the draft is open it is not stored anywhere
    expect((await items(page)).length).toBe(before);
    await dlg.getByRole("button", { name: "Cancel" }).click();
    await expect(dlg).toBeHidden();

    expect((await items(page)).length).toBe(before);
    expect(await item(page, "Classic Matcha (copy)")).toBeUndefined();
    await page.reload();
    expect((await items(page)).length).toBe(before);
    await goTab(page, "Menu Manager");
    await expect(page.getByRole("button", { name: "Duplicate Classic Matcha (copy)", exact: true })).toHaveCount(0);
  });

  test("clicking outside the editor discards the draft too", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await goTab(page, "Menu Manager");
    const before = (await items(page)).length;
    await dup(page, "Hojicha Latte");
    const dlg = modal(page, /Duplicate menu item/);
    await expect(dlg).toBeVisible();
    await dlg.click({ position: { x: 6, y: 6 } }); // the dimmed backdrop, outside the dialog box
    await expect(dlg).toBeHidden();
    expect((await items(page)).length).toBe(before);
    expect(await item(page, "Hojicha Latte (copy)")).toBeUndefined();
  });

  test("Save creates a complete copy that is independent of the original", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await goTab(page, "Menu Manager");
    const original = await item(page, "Classic Matcha");
    expect(original.ingredientLines.length).toBeGreaterThan(0);

    await dup(page, "Classic Matcha");
    const dlg = modal(page, /Duplicate menu item/);
    await dlg.getByRole("button", { name: "Save" }).click(); // unchanged
    await expect(dlg).toBeHidden();

    const copy = await item(page, "Classic Matcha (copy)");
    expect(copy.id).not.toBe(original.id);
    expect(copy.ingredientLines).toEqual(original.ingredientLines);
    for (const k of ["price", "size", "category", "description", "taxable", "defaultMilkId", "defaultCreamId", "allowedMilkIds", "allowedCreamIds"]) {
      expect(copy[k], k).toEqual(original[k]); // (stored as JSON: an unset field is simply absent on both)
    }
    expect(copy.active).toBe(true);

    // edit the copy: the original does not move
    const edit = await openMenuEditor(page, String.raw`Classic Matcha \(copy\)`);
    await field(edit, "Name").fill("Iced Matcha");
    await field(edit, "Price ($)").fill("9.5");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(edit).toBeHidden();
    expect(await item(page, "Classic Matcha")).toEqual(original);
    expect((await item(page, "Iced Matcha")).price).toBe(9.5);

    // and the other way
    const editOriginal = await openMenuEditor(page, "Classic Matcha");
    await field(editOriginal, "Price ($)").fill("8.25");
    await editOriginal.getByRole("button", { name: "Save" }).click();
    await expect(editOriginal).toBeHidden();
    expect((await item(page, "Iced Matcha")).price).toBe(9.5);
    expect((await item(page, "Classic Matcha")).price).toBe(8.25);
  });

  test("changes made in the draft are what gets saved", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await goTab(page, "Menu Manager");
    const original = await item(page, "Classic Matcha");
    await dup(page, "Classic Matcha");
    const dlg = modal(page, /Duplicate menu item/);
    await field(dlg, "Name").fill("Spicy Matcha");
    await field(dlg, "Price ($)").fill("7.75");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden();
    expect((await item(page, "Spicy Matcha")).price).toBe(7.75);
    expect((await item(page, "Spicy Matcha")).ingredientLines).toEqual(original.ingredientLines);
    expect(await item(page, "Classic Matcha (copy)")).toBeUndefined();
    expect(await item(page, "Classic Matcha")).toEqual(original);
  });

  test("copies are numbered and a copy of a copy does not stack suffixes", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await goTab(page, "Menu Manager");
    const saveCopy = async (name: string) => {
      await dup(page, name);
      const dlg = modal(page, /Duplicate menu item/);
      await dlg.getByRole("button", { name: "Save" }).click();
      await expect(dlg).toBeHidden();
    };
    await saveCopy("Hojicha Latte");
    await saveCopy("Hojicha Latte");
    await saveCopy("Hojicha Latte (copy)");
    const names = (await items(page)).map((m) => m.name).filter((n: string) => n.startsWith("Hojicha Latte"));
    expect(names.sort()).toEqual(["Hojicha Latte", "Hojicha Latte (copy 2)", "Hojicha Latte (copy 3)", "Hojicha Latte (copy)"].sort());
  });

  test("the saved copy sells and costs exactly like the original", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Dup sale" });
    await goTab(page, "Menu Manager");
    await dup(page, "Classic Matcha");
    await modal(page, /Duplicate menu item/).getByRole("button", { name: "Save" }).click();
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

  test("duplicating an archived item gives an active copy once saved", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await goTab(page, "Menu Manager");
    await page.locator('main button[title="Archive"]').first().click();
    const archivedName = (await items(page)).find((m) => !m.active).name;
    await dup(page, archivedName);
    await modal(page, /Duplicate menu item/).getByRole("button", { name: "Save" }).click();
    expect((await item(page, `${archivedName} (copy)`)).active).toBe(true);
    expect((await item(page, archivedName)).active).toBe(false);
  });
});
