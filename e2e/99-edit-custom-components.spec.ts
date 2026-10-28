import type { Locator, Page } from "@playwright/test";
import { autoAcceptDialogs, createEvent, expect, goTab, openApp, placeOrder, readState, test } from "./support";
import { baristaCard, modal } from "./extra";

/**
 * A custom drink line's bases and toppings can be changed in Edit Order (no more remove and re-add).
 * Snapshot rules: while the components are unchanged the line keeps the price and cost it was sold at;
 * once they change it is a different product and is stamped at today's menu price and cost.
 */
const addBase = (dlg: Locator, name: string) => dlg.getByLabel("Add base").selectOption({ label: name });
const addTopping = (dlg: Locator, name: string) => dlg.getByLabel("Add topping").selectOption({ label: name });
const openCustom = (page: Page) => page.locator("main header").getByRole("button", { name: "+ Custom drink" }).click();

async function placeCustom(page: Page, customer: string) {
  await openCustom(page);
  const dlg = modal(page, "Custom drink");
  await addBase(dlg, "Hojicha powder");
  await addTopping(dlg, "Banana cream");
  await dlg.getByRole("button", { name: "Add custom drink" }).click();
  await placeOrder(page, { items: [], name: customer, pay: "Cash" });
}

const lineOf = async (page: Page, customer: string) =>
  (await readState(page)).orders.find((o: any) => o.customerName === customer).items[0];

async function openLineEditor(page: Page, orderNumber: number) {
  await goTab(page, "Barista Queue");
  await baristaCard(page, orderNumber).getByTitle("Edit").click();
  const edit = modal(page, new RegExp(`Edit order #${orderNumber}`));
  await edit.getByText(/^Custom: /).first().click();
  return { edit, line: modal(page, /^Custom: /).last() };
}

test.describe("custom drink components in Edit Order", () => {
  test("change bases and toppings: the builder reopens, price and cost are recomputed and stamped", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Edit custom" });
    await placeCustom(page, "Ann");
    const before = await lineOf(page, "Ann");
    expect(before.menuItemNameSnap).toBe("Custom: Hojicha powder + Banana cream");
    expect(before.priceSnap).toBeCloseTo(6.9, 5);

    const { edit, line } = await openLineEditor(page, 1);
    // the builder shows the current components and a live price / cost
    await expect(line.getByTestId("custom-components")).toBeVisible();
    await expect(line.getByRole("button", { name: "Remove Hojicha powder" })).toBeVisible();
    await expect(line.getByRole("button", { name: "Remove Banana cream" })).toBeVisible();
    await expect(line.getByTestId("custom-price")).toHaveText("$6.90");

    // swap the base, add a second topping
    await line.getByRole("button", { name: "Remove Hojicha powder" }).click();
    await expect(line.getByRole("button", { name: "Save" })).toBeDisabled(); // needs a base
    await addBase(line, "Matcha powder");
    await addTopping(line, "Strawberry purée");
    await expect(line.getByTestId("custom-price")).toHaveText("$7.10");
    await line.getByRole("button", { name: "Save" }).click();
    await edit.getByRole("button", { name: "Save" }).click();

    const after = await lineOf(page, "Ann");
    expect(after.menuItemNameSnap).toBe("Custom: Matcha powder + Banana cream + Strawberry purée");
    expect(after.priceSnap).toBeCloseTo(7.1, 5);
    expect(after.costSnap).not.toBeCloseTo(before.costSnap, 4);
    expect(after.quantity).toBe(1);
    // exactly one line, still one order
    expect((await readState(page)).orders.find((o: any) => o.customerName === "Ann").items).toHaveLength(1);
  });

  test("snapshot rules: unchanged components keep the sale-time cost after a price change; changed components use today's", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Edit custom snapshot" });
    await placeCustom(page, "Bea");
    const sold = await lineOf(page, "Bea");

    // the tea gets 3x more expensive after the sale
    await goTab(page, "Menu Manager");
    await page.getByRole("button", { name: /Ingredients/ }).first().click();
    const price = page.locator(`tr:has(input[value="Hojicha powder"])`).locator("input").nth(1);
    const old = Number(await price.inputValue());
    await price.fill(String(old * 3));
    await price.blur();

    // a note-only edit of the custom line: price and cost stay as sold
    let { edit, line } = await openLineEditor(page, 1);
    await line.getByLabel("Special requests").fill("extra cold");
    await line.getByRole("button", { name: "Save" }).click();
    await edit.getByRole("button", { name: "Save" }).click();
    const noteOnly = await lineOf(page, "Bea");
    expect(noteOnly.specialRequests).toBe("extra cold");
    expect(noteOnly.costSnap).toBeCloseTo(sold.costSnap, 6);
    expect(noteOnly.priceSnap).toBeCloseTo(sold.priceSnap, 6);

    // opening the builder and putting the same components back changes nothing either
    ({ edit, line } = await openLineEditor(page, 1));
    await line.getByRole("button", { name: "Remove Banana cream" }).click();
    await addTopping(line, "Banana cream");
    await line.getByRole("button", { name: "Save" }).click();
    await edit.getByRole("button", { name: "Save" }).click();
    expect((await lineOf(page, "Bea")).costSnap).toBeCloseTo(sold.costSnap, 6);

    // changing a component re-stamps the line at today's cost (the pricier tea)
    ({ edit, line } = await openLineEditor(page, 1));
    await addTopping(line, "Strawberry purée");
    await line.getByRole("button", { name: "Save" }).click();
    await edit.getByRole("button", { name: "Save" }).click();
    const changed = await lineOf(page, "Bea");
    expect(changed.menuItemNameSnap).toBe("Custom: Hojicha powder + Banana cream + Strawberry purée");
    // 4 g of the tea now costs 3x (that increase alone) plus the added topping
    const tea = (await readState(page)).ingredients.find((i: any) => i.name === "Hojicha powder");
    const teaIncrease = 4 * (tea.packagePrice / tea.packageAmount) * (2 / 3);
    expect(tea.packagePrice).toBeCloseTo(old * 3, 6);
    expect(changed.costSnap - sold.costSnap).toBeGreaterThan(teaIncrease + 0.01);
  });

  test("menu drinks have no component builder", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Edit menu drink" });
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Cy", pay: "Cash", declineCombo: true });
    await goTab(page, "Barista Queue");
    await baristaCard(page, 1).getByTitle("Edit").click();
    const edit = modal(page, /Edit order #1/);
    await edit.getByText("Classic Matcha").first().click();
    const item = modal(page, "Classic Matcha");
    await expect(item.getByTestId("custom-components")).toHaveCount(0);
  });
});
