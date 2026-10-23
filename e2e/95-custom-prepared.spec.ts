import type { Locator, Page } from "@playwright/test";
import { autoAcceptDialogs, createEvent, expect, goTab, openApp, placeOrder, readState, test } from "./support";
import { modal, openMenuEditor } from "./extra";

/**
 * Both features together, through the real UI: a PREPARED ingredient (made from
 * raw ones) used in a CUSTOM drink. It needs a base/topping role to be offered,
 * costs from its recipe (not $0), and follows a raw price change.
 */
const AGAVE_ML = 8.99 / 660;
const PUREE_ML = 7 / 500;
const batch = (agavePerMl = AGAVE_ML) => 100 * agavePerMl + 50 * PUREE_ML; // Test Syrup: 500 ml
// seed: Classic Matcha is first in menu order (180 ml milk); packaging = 16oz cup + lid + straw + 50 g ice + 5 ml agave
const PACKAGING = 28 / 100 + 12 / 100 + 6 / 250 + (4 / 4000) * 50 + AGAVE_ML * 5;
const customCost = (agavePerMl = AGAVE_ML) =>
  4 * (32 / 100) + 180 * (5.49 / 3785) + 30 * (batch(agavePerMl) / 500) + (PACKAGING - 5 * AGAVE_ML + 5 * agavePerMl);

const addBase = (dlg: Locator, name: string) => dlg.getByLabel("Add base").selectOption({ label: name });
const addTopping = (dlg: Locator, name: string) => dlg.getByLabel("Add topping").selectOption({ label: name });
const optionTexts = async (sel: Locator) => (await sel.locator("option").allTextContents()).map((t) => t.trim());

async function openIngredients(page: Page) {
  await goTab(page, "Menu Manager");
  await page.getByRole("button", { name: /Ingredients/ }).first().click();
}

async function createSyrup(page: Page) {
  await openIngredients(page);
  await page.getByRole("button", { name: /New ingredient/ }).click();
  const form = modal(page, "New ingredient");
  await form.getByRole("textbox").first().fill("Test Syrup");
  await form.getByLabel("Type", { exact: true }).selectOption("prepared");
  await form.locator("input[type=number]").first().fill("500");
  await form.locator("select").nth(1).selectOption("ml");
  await form.getByRole("button", { name: "Add" }).click();
  await expect(form).toBeHidden();
  await page.getByRole("button", { name: "Recipe for Test Syrup" }).click();
  const dlg = modal(page, "Recipe: Test Syrup");
  const addLine = async (n: number, ingredient: string, amount: number) => {
    await dlg.getByRole("button", { name: /Add ingredient/ }).click();
    await dlg.locator("select").nth(2 * n).selectOption({ label: ingredient });
    await dlg.locator("input").nth(n).fill(String(amount));
    await dlg.locator("select").nth(2 * n + 1).selectOption("ml");
  };
  await addLine(0, "Agave", 100);
  await addLine(1, "Strawberry purée", 50);
  await dlg.getByRole("button", { name: "Save recipe" }).click();
  await expect(dlg).toBeHidden();
}

async function addSyrupToClassic(page: Page) {
  await goTab(page, "Menu Manager");
  await page.getByRole("button", { name: "Items", exact: true }).click();
  const editor = await openMenuEditor(page, "Classic Matcha");
  await editor.getByRole("button", { name: /Add line/ }).click();
  const row = editor.locator("div.grid").filter({ has: page.locator("option", { hasText: "Test Syrup" }) }).last();
  await row.locator("select").first().selectOption({ label: "Test Syrup" });
  await row.locator("input").fill("30");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
}

const openCustom = (page: Page) => page.locator("main header").getByRole("button", { name: "+ Custom drink" }).click();

test.describe("custom drink + prepared ingredient", () => {
  test("a prepared ingredient needs a role to be offered, then costs from its recipe in a custom drink", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Both features" });
    await createSyrup(page);
    await addSyrupToClassic(page); // gives the syrup a standard amount (30 ml) in a recipe

    // no role yet: not offered, and the builder says so
    await goTab(page, "Live Orders");
    await openCustom(page);
    let dlg = modal(page, "Custom drink");
    expect(await optionTexts(dlg.getByLabel("Add topping"))).not.toContain("Test Syrup");
    await expect(dlg.getByTestId("unassigned-prepared")).toContainText("Test Syrup");
    await dlg.getByRole("button", { name: "Cancel" }).click();

    // both controls exist on the ingredient row: Type (Raw/Prepared) and the custom drink role
    await openIngredients(page);
    await expect(page.getByLabel("Type of Test Syrup")).toHaveValue("prepared");
    await expect(page.getByLabel("Type of Agave")).toBeDisabled(); // used in Test Syrup's recipe
    await page.getByLabel("Custom drink role for Test Syrup").selectOption("topping");
    expect((await readState(page)).ingredients.find((i: any) => i.name === "Test Syrup")).toMatchObject({ kind: "prepared", customRole: "topping" });

    // the New ingredient form offers both choices
    await page.getByRole("button", { name: /New ingredient/ }).click();
    const form = modal(page, "New ingredient");
    await expect(form.getByLabel("Type", { exact: true })).toBeVisible();
    await expect(form.getByLabel("Custom drink role")).toBeVisible();
    await form.getByRole("button", { name: "Cancel" }).click();

    // now offered; the cost preview and the stamped cost come from the recipe, not $0
    await goTab(page, "Live Orders");
    await openCustom(page);
    dlg = modal(page, "Custom drink");
    expect(await optionTexts(dlg.getByLabel("Add topping"))).toContain("Test Syrup");
    await expect(dlg.getByTestId("unassigned-prepared")).toHaveCount(0);
    await addBase(dlg, "Hojicha powder");
    const withoutTopping = await dlg.getByTestId("custom-cost").innerText();
    await addTopping(dlg, "Test Syrup");
    await expect(dlg.getByTestId("custom-price")).toHaveText("$6.90");
    await expect(dlg.getByTestId("custom-cost")).toContainText(`$${customCost().toFixed(2)}`);
    expect(await dlg.getByTestId("custom-cost").innerText()).not.toBe(withoutTopping);
    await dlg.getByRole("button", { name: "Add custom drink" }).click();
    await placeOrder(page, { items: [], name: "Before", pay: "Cash" });
    const first = (await readState(page)).orders.find((o: any) => o.customerName === "Before").items[0];
    expect(first.menuItemNameSnap).toBe("Custom: Hojicha powder + Test Syrup");
    expect(first.costSnap).toBeCloseTo(customCost(), 4);

    // a raw price change (agave doubles) flows raw -> prepared -> custom drink for the next order only
    await openIngredients(page);
    const price = page.locator(`tr:has(input[value="Agave"])`).locator("input").nth(1);
    await price.fill("17.98");
    await price.blur();
    await goTab(page, "Live Orders");
    await openCustom(page);
    dlg = modal(page, "Custom drink");
    await addBase(dlg, "Hojicha powder");
    await addTopping(dlg, "Test Syrup");
    await dlg.getByRole("button", { name: "Add custom drink" }).click();
    await placeOrder(page, { items: [], name: "After", pay: "Cash" });
    const orders = (await readState(page)).orders;
    const before = orders.find((o: any) => o.customerName === "Before").items[0].costSnap;
    const after = orders.find((o: any) => o.customerName === "After").items[0].costSnap;
    expect(before).toBeCloseTo(customCost(), 4); // placed order untouched
    expect(after).toBeCloseTo(customCost(AGAVE_ML * 2), 4);
    expect(after).toBeGreaterThan(before);
  });
});
