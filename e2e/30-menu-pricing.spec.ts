import { autoAcceptDialogs, createEvent, expect, goTab, openApp, placeOrder, test } from "./support";
import { addMenuItem, archiveMenuItem, baristaCard, eventOrders, modal, setMenuPrice } from "./extra";

/**
 * 5.5 "change price / availability mid-event, orders keep their original price
 * and cost (priceSnap / costSnap)". Menu edits flow into Live Orders from the
 * master menu (LiveOrders.tsx builds its picker from state.menuItems), while the
 * event keeps a frozen snapshot used by Edit Order and reporting.
 */
test.describe("5.5 mid-event menu changes", () => {
  test("a price change applies to new orders only; placed orders keep priceSnap", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "PriceChg" });
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Before", pay: "Cash" });
    await setMenuPrice(page, "Classic Matcha", 8);
    await goTab(page, "Live Orders");
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "After", pay: "Venmo" });
    const { orders } = await eventOrders(page, "PriceChg");
    expect(orders.map((o: { items: Array<{ priceSnap: number }> }) => o.items[0].priceSnap)).toEqual([6.7, 8]);
    await goTab(page, "Event Summary");
    await expect(page.locator("main").locator("dl > div").filter({ hasText: "Sales revenue" }).first()).toContainText("$14.70");
  });

  test("an ingredient price change applies to new orders only; placed orders keep costSnap", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "CostChg" });
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Before", pay: "Cash" });
    await goTab(page, "Menu Manager");
    await page.getByRole("button", { name: "Ingredients", exact: true }).click();
    const row = page.locator('tr:has(input[value="Matcha powder"])');
    const price = row.locator("input").nth(1);
    await price.fill("318"); // doubles matcha cost: +4.5 g * 159/500 = +$1.431 per Classic
    await price.blur();
    await goTab(page, "Live Orders");
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "After", pay: "Cash" });
    const { orders } = await eventOrders(page, "CostChg");
    const [before, after] = orders.map((o: { items: Array<{ costSnap: number }> }) => o.items[0].costSnap);
    expect(before).toBeCloseTo(2.2342, 3);
    expect(after).toBeCloseTo(2.2342 + 1.431, 3);
  });

  test("BUG-QA-1 (fixed): editing an order after a price change keeps the price it was sold at", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "EditPrice" });
    await setMenuPrice(page, "Classic Matcha", 8);
    await goTab(page, "Live Orders");
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Sold at 8", pay: "Cash" });
    expect((await eventOrders(page, "EditPrice")).orders[0].items[0].priceSnap).toBe(8);
    await goTab(page, "Barista Queue");
    await baristaCard(page, 1).getByTitle("Edit").click();
    const dlg = modal(page, /Edit order #1/);
    await dlg.locator("textarea").fill("just a note, no item change");
    await dlg.getByRole("button", { name: "Save" }).click();
    expect((await eventOrders(page, "EditPrice")).orders[0].items[0].priceSnap).toBe(8);
  });

  test("BUG-QA-1b (fixed): a menu item added after the event was created survives an order edit", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "NewItem" });
    await addMenuItem(page, "Pop Special", 5);
    await goTab(page, "Live Orders");
    await placeOrder(page, { items: [{ name: "Pop Special" }], name: "Sp", pay: "Cash" });
    let o = (await eventOrders(page, "NewItem")).orders[0];
    expect(o.items[0].priceSnap).toBe(5);
    await goTab(page, "Barista Queue");
    await baristaCard(page, 1).getByTitle("Edit").click();
    const dlg = modal(page, /Edit order #1/);
    await dlg.locator("textarea").fill("note only");
    await dlg.getByRole("button", { name: "Save" }).click();
    o = (await eventOrders(page, "NewItem")).orders[0];
    expect(o.items[0].menuItemNameSnap).toBe("Pop Special");
    expect(o.items[0].priceSnap).toBe(5);
  });

  test("an archived (unavailable) item disappears from Live Orders; earlier orders and reporting keep it", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Avail" });
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Early", pay: "Cash" });
    await archiveMenuItem(page, "Classic Matcha");
    await goTab(page, "Live Orders");
    await expect(page.locator("main").getByRole("button", { name: /^Classic Matcha/ })).toHaveCount(0);
    await expect(page.locator("main").getByRole("button", { name: /^Hojicha Latte/ })).toBeVisible();
    await goTab(page, "Event Summary");
    await expect(page.locator("main").locator("dl > div").filter({ hasText: "Sales revenue" }).first()).toContainText("$6.70");
    // the combo picker must not offer it either
    await goTab(page, "Live Orders");
    await page.locator("main").getByRole("button", { name: /Combo deal/ }).first().click();
    await expect(page.getByRole("option", { name: /Classic Matcha/ })).toHaveCount(0);
  });
});
