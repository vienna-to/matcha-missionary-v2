import { autoAcceptDialogs, createEvent, expect, goTab, openApp, placeOrder, readState, test } from "./support";
import { baristaCard, modal } from "./extra";

/**
 * Custom / off-menu drink: built from existing bases and toppings, priced
 * 6.70 + 0.20 per topping, and counted in totals like a menu item.
 */
const ORDER_NAME = "Custom Cam";

test.describe("custom drink", () => {
  test("entry flow: build, price preview, order, totals", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Custom entry" });

    await page.locator("main header").getByRole("button", { name: "+ Custom drink" }).click();
    const dlg = modal(page, "Custom drink");
    await expect(dlg.getByRole("button", { name: "Add custom drink" })).toBeDisabled();
    await expect(dlg.getByTestId("custom-price")).toHaveText("$6.70");

    await dlg.getByRole("group", { name: "Bases" }).getByRole("button", { name: "Hojicha powder" }).click();
    await dlg.getByRole("group", { name: "Bases" }).getByRole("button", { name: "Matcha powder" }).click();
    await dlg.getByRole("group", { name: "Toppings" }).getByRole("button", { name: "Banana cream" }).click();
    await expect(dlg.getByTestId("custom-price")).toHaveText("$6.90");
    await dlg.getByRole("group", { name: "Toppings" }).getByRole("button", { name: "Strawberry purée" }).click();
    // 2 bases + 2 toppings = 6.70 + 0.40
    await expect(dlg.getByTestId("custom-price")).toHaveText("$7.10");
    await expect(dlg.getByTestId("custom-cost")).toContainText("$");
    await dlg.getByRole("button", { name: "Add custom drink" }).click();
    await expect(dlg).toBeHidden();

    const line = page.locator("aside").locator("div.rounded-xl", { hasText: "Custom:" }).first();
    await expect(line).toContainText("Hojicha powder");
    await expect(line).toContainText("Banana cream");
    await expect(line).toContainText("$7.10");

    await placeOrder(page, { items: [], name: ORDER_NAME, pay: "Cash" });

    const state = await readState(page);
    const item = state.orders.at(-1).items[0];
    expect(item.menuItemNameSnap).toBe("Custom: Hojicha powder + Matcha powder + Banana cream + Strawberry purée");
    expect(item.priceSnap).toBe(7.1);
    expect(item.costSnap).toBeGreaterThan(0);
    expect(item.milkChoiceId).toBeUndefined();

    await goTab(page, "Barista Queue");
    await expect(page.locator("main")).toContainText("Custom: Hojicha powder");

    await goTab(page, "Event Summary");
    const main = page.locator("main");
    await expect(main).toContainText("Revenue (paid)");
    await expect(main).toContainText("$7.10");
    await expect(main).toContainText("Custom: Hojicha powder");
    await expect(main).toContainText("Cups poured");
  });

  test("edit flow: add a custom drink to an existing order", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Custom edit" });
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Editor", pay: "Cash", declineCombo: true });
    await goTab(page, "Barista Queue");
    await baristaCard(page, 1).getByTitle("Edit").click();
    const edit = modal(page, /Edit order #1/);
    await edit.getByRole("button", { name: /Add item/ }).click();
    await modal(page, "Add item").getByRole("button", { name: /Custom drink/ }).click();

    const dlg = modal(page, "Custom drink");
    await dlg.getByRole("group", { name: "Bases" }).getByRole("button", { name: "Hojicha powder" }).click();
    await dlg.getByRole("group", { name: "Toppings" }).getByRole("button", { name: "Banana cream" }).click();
    await expect(dlg.getByTestId("custom-price")).toHaveText("$6.90");
    await dlg.getByRole("button", { name: "Add custom drink" }).click();
    await expect(edit).toContainText("Custom: Hojicha powder + Banana cream");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(edit).toBeHidden();

    const state = await readState(page);
    const items = state.orders.at(-1).items;
    expect(items).toHaveLength(2);
    const custom = items.find((i: any) => i.menuItemNameSnap.startsWith("Custom:"));
    expect(custom.priceSnap).toBe(6.9);
    expect(custom.costSnap).toBeGreaterThan(0);
    // the original line was not re-priced
    expect(items.find((i: any) => i.menuItemNameSnap === "Classic Matcha").priceSnap).toBe(6.7);
  });

  test("a base is required", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Custom guard" });
    await page.locator("main header").getByRole("button", { name: "+ Custom drink" }).click();
    const dlg = modal(page, "Custom drink");
    await dlg.getByRole("group", { name: "Toppings" }).getByRole("button", { name: "Banana cream" }).click();
    await expect(dlg.getByRole("button", { name: "Add custom drink" })).toBeDisabled();
    await expect(dlg.getByRole("alert")).toContainText("at least one base");
  });
});
