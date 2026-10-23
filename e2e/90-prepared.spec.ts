import type { Locator, Page } from "@playwright/test";
import { autoAcceptDialogs, createEvent, expect, goTab, openApp, placeOrder, readState, test } from "./support";
import { modal, openMenuEditor } from "./extra";

/**
 * Prepared ingredients: made from raw ingredients, cost worked out from the
 * recipe, used as ONE line in a drink, following raw price changes, one level
 * of nesting only.
 */
// seed prices: agave $8.99 / 660 ml, strawberry purée $7 / 500 ml
const AGAVE_ML = 8.99 / 660;
const PUREE_ML = 7 / 500;
const batch = (agavePerMl = AGAVE_ML) => 100 * agavePerMl + 50 * PUREE_ML;

async function openIngredients(page: Page) {
  await goTab(page, "Menu Manager");
  await page.getByRole("button", { name: /Ingredients/ }).first().click();
}

/** Menu Manager stays on the Ingredients sub-tab until Items is chosen. */
async function editItem(page: Page, name: string) {
  await goTab(page, "Menu Manager");
  await page.getByRole("button", { name: "Items", exact: true }).click();
  return openMenuEditor(page, name);
}

/** Create a prepared ingredient "Test Syrup" yielding 500 ml, with a two-line recipe. */
async function createSyrup(page: Page) {
  await openIngredients(page);
  await page.getByRole("button", { name: /New ingredient/ }).click();
  const form = modal(page, "New ingredient");
  await form.getByRole("textbox").first().fill("Test Syrup");
  await form.getByLabel("Type").selectOption("prepared");
  await expect(form.getByText("Package $")).toHaveCount(0); // prepared: no typed price
  await form.locator("input[type=number]").first().fill("500");
  await form.locator("select").nth(1).selectOption("ml");
  await form.getByRole("button", { name: "Add" }).click();
  await expect(form).toBeHidden();

  await page.getByRole("button", { name: "Recipe for Test Syrup" }).click();
  const dlg = modal(page, "Recipe: Test Syrup");
  const addLine = async (n: number, ingredient: string, amount: number, unit: string) => {
    await dlg.getByRole("button", { name: /Add ingredient/ }).click();
    await dlg.locator("select").nth(2 * n).selectOption({ label: ingredient });
    await dlg.locator("input").nth(n).fill(String(amount));
    await dlg.locator("select").nth(2 * n + 1).selectOption(unit);
  };
  await addLine(0, "Agave", 100, "ml");
  await addLine(1, "Strawberry purée", 50, "ml");
  return dlg;
}

test.describe("prepared ingredients", () => {
  test("define a recipe and yield; cost per unit is computed; a drink uses it as one line", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Prepared" });
    const dlg = await createSyrup(page);

    // live cost summary: one batch, and per ml (yield 500 ml)
    await expect(dlg.getByTestId("recipe-batch-cost")).toHaveText(`$${batch().toFixed(2)}`);
    await expect(dlg.getByTestId("recipe-unit-cost")).toHaveText(`$${(batch() / 500).toFixed(4)}`);
    await dlg.getByRole("button", { name: "Save recipe" }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByTestId("batch-cost-Test Syrup")).toContainText(`$${batch().toFixed(2)}`);

    const st = (await readState(page)).ingredients.find((i: any) => i.name === "Test Syrup");
    expect(st.kind).toBe("prepared");
    expect(st.packageAmount).toBe(500);
    expect(st.subRecipe).toHaveLength(2);

    // same picker, same line: add "Test Syrup 30 ml" to Classic Matcha
    const editor = await editItem(page, "Classic Matcha");
    await editor.getByRole("button", { name: /Add line/ }).click();
    const lastSelect = editor.locator("select").filter({ has: page.locator("option", { hasText: "Test Syrup" }) }).last();
    await lastSelect.selectOption({ label: "Test Syrup" });
    await editor.locator("div.grid").filter({ has: page.locator("option", { hasText: "Test Syrup" }) }).last().locator("input").fill("30");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).toBeHidden();

    await goTab(page, "Live Orders");
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "P1", pay: "Cash", declineCombo: true });
    const classicBase =
      4.5 * (159 / 500) + 180 * (5.49 / 3785) + 5 * AGAVE_ML + 50 * (4 / 4000) + 28 / 100 + 12 / 100 + 6 / 250;
    const cost1 = (await readState(page)).orders.at(-1).items[0].costSnap;
    expect(cost1).toBeCloseTo(classicBase + 30 * (batch() / 500), 4);
  });

  test("a raw price change flows into the prepared ingredient and the drink; a placed order keeps its cost", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Flow" });
    const dlg = await createSyrup(page);
    await dlg.getByRole("button", { name: "Save recipe" }).click();
    const editor = await editItem(page, "Classic Matcha");
    await editor.getByRole("button", { name: /Add line/ }).click();
    await editor.locator("select").filter({ has: page.locator("option", { hasText: "Test Syrup" }) }).last().selectOption({ label: "Test Syrup" });
    await editor.locator("div.grid").filter({ has: page.locator("option", { hasText: "Test Syrup" }) }).last().locator("input").fill("30");
    await editor.getByRole("button", { name: "Save" }).click();

    await goTab(page, "Live Orders");
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Before", pay: "Cash", declineCombo: true });
    const first = (await readState(page)).orders.at(-1).items[0].costSnap;

    // agave doubles
    await openIngredients(page);
    const price = page.locator(`tr:has(input[value="Agave"])`).locator("input").nth(1);
    await price.fill("17.98");
    await price.blur();
    await expect(page.getByTestId("batch-cost-Test Syrup")).toContainText(`$${batch(AGAVE_ML * 2).toFixed(2)}`);

    await goTab(page, "Live Orders");
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "After", pay: "Cash", declineCombo: true });
    const orders = (await readState(page)).orders;
    const [o1, o2] = [orders.find((o: any) => o.customerName === "Before"), orders.find((o: any) => o.customerName === "After")];
    expect(o1.items[0].costSnap).toBeCloseTo(first, 10); // untouched by the price change
    // new order: direct agave line (5 ml) and the syrup's agave (30 ml of a 500 ml batch = 6 ml) both doubled
    expect(o2.items[0].costSnap - first).toBeCloseTo((5 + 6) * AGAVE_ML, 4);
  });

  test("one level only: a prepared ingredient cannot go in a recipe, and a used raw ingredient cannot become prepared", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    const dlg = await createSyrup(page);
    await dlg.getByRole("button", { name: "Save recipe" }).click();
    await expect(dlg).toBeHidden();

    // Agave is in Test Syrup's recipe, so it stays raw
    await expect(page.getByLabel("Type of Agave")).toBeDisabled();

    // a second prepared ingredient cannot list Test Syrup (or itself)
    await page.getByRole("button", { name: /New ingredient/ }).click();
    const form = modal(page, "New ingredient");
    await form.getByRole("textbox").first().fill("Other Mix");
    await form.getByLabel("Type").selectOption("prepared");
    await form.locator("input[type=number]").first().fill("100");
    await form.getByRole("button", { name: "Add" }).click();
    await page.getByRole("button", { name: "Recipe for Other Mix" }).click();
    const other = modal(page, "Recipe: Other Mix");
    await other.getByRole("button", { name: /Add ingredient/ }).click();
    const options = (await other.locator("select").first().locator("option").allTextContents()).map((t) => t.trim());
    expect(options).toContain("Agave");
    expect(options).not.toContain("Test Syrup");
    expect(options).not.toContain("Other Mix");
  });
});
