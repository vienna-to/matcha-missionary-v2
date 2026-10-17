import { autoAcceptDialogs, createEvent, expect, field, goTab, openApp, placeOrder, test } from "./support";
import { baristaCard, eventOrders, modal } from "./extra";

test.describe("5.1 required fields and validation", () => {
  test("new-event dialog blocks empty date, zero cup size, and incomplete contract", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /new event/i }).first().click();
    const dlg = modal(page, "New event");
    const create = dlg.getByRole("button", { name: "Create event" });
    await expect(create).toBeEnabled();
    await field(dlg, "Cup size (oz)").fill("0");
    await expect(create).toBeDisabled();
    await field(dlg, "Cup size (oz)").fill("16");
    await field(dlg, "Event type").selectOption("contract");
    await expect(create).toBeDisabled(); // no client, no payout
    await field(dlg, "Client name").fill("Acme");
    await expect(create).toBeDisabled(); // payout still 0
    await field(dlg, /Contracted payout/).fill("250");
    await expect(create).toBeEnabled();
  });

  test("event end time before (or equal to) start time is rejected with a clear message (QA-3, fixed)", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /new event/i }).first().click();
    const dlg = modal(page, "New event");
    await field(dlg, "Start time").fill("16:00");
    await field(dlg, "End time").fill("09:00");
    await expect(dlg.getByText("End time must be after the start time.")).toBeVisible();
    await expect(dlg.getByRole("button", { name: "Create event" })).toBeDisabled();
    await field(dlg, "End time").fill("16:00"); // equal is also rejected
    await expect(dlg.getByRole("button", { name: "Create event" })).toBeDisabled();
    await field(dlg, "End time").fill("17:00");
    await expect(dlg.getByText("End time must be after the start time.")).toHaveCount(0);
    await expect(dlg.getByRole("button", { name: "Create event" })).toBeEnabled();
  });

  test("log-past-event dialog also rejects an inverted time window", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /log past event/i }).click();
    const dlg = page.locator("div.fixed.inset-0").filter({ has: page.locator("h3") }).last();
    await field(dlg, "start time").fill("18:00");
    await field(dlg, "end time").fill("10:00");
    await expect(dlg.getByText("End time must be after the start time.")).toBeVisible();
  });

  test("order cannot be confirmed without an item or without a payment method", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Validation" });
    const panel = page.locator("aside").last();
    await expect(panel.getByRole("button", { name: /Next: Adjustments/ })).toBeDisabled();
    await page.locator("main").getByRole("button", { name: /^Classic Matcha/ }).first().click();
    await page.locator("aside ol").getByRole("button", { name: /Payment/ }).click();
    await panel.getByRole("button", { name: /Confirm order/ }).click();
    await expect(page.getByText("Pick a payment method to confirm.")).toBeVisible();
    expect((await eventOrders(page, "Validation")).orders).toHaveLength(0);
  });

  test("an order with no customer name saves, and can still be edited", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "NoName" });
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], pay: "Cash" });
    const { orders } = await eventOrders(page, "NoName");
    expect(orders).toHaveLength(1);
    await goTab(page, "Barista Queue");
    await baristaCard(page, 1).getByTitle("Edit").click();
    const dlg = modal(page, /Edit order #1/);
    await expect(dlg.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

test.describe("5.2 quantities and rapid orders", () => {
  test("quantity cannot go below 1; a very large quantity prices and saves correctly", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Qty" });
    await page.locator("main").getByRole("button", { name: /^Classic Matcha/ }).first().click();
    const panel = page.locator("aside").last();
    await panel.getByRole("button", { name: "Fewer" }).click();
    await expect(panel.locator("div.tabular-nums", { hasText: /^1$/ }).first()).toBeVisible();
    for (let i = 0; i < 59; i++) await panel.getByRole("button", { name: "More" }).click();
    await expect(panel.getByText("$402.00").first()).toBeVisible(); // 60 x 6.70
    await page.locator("aside ol").getByRole("button", { name: /Payment/ }).click();
    await panel.getByRole("button", { name: "Cash", exact: true }).click();
    await panel.getByRole("button", { name: /Confirm order/ }).click();
    const { orders } = await eventOrders(page, "Qty");
    expect(orders[0].items[0].quantity).toBe(60);
    expect(orders[0].items[0].priceSnap * 60).toBeCloseTo(402, 2);
  });

  test("eight orders submitted back to back get unique, gap-free numbers", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Rapid" });
    for (let i = 0; i < 8; i++) await placeOrder(page, { items: [{ name: "Hojicha Latte" }], name: `R${i}`, pay: "Venmo" });
    await expect.poll(async () => (await eventOrders(page, "Rapid")).orders.length).toBe(8);
    const nums = (await eventOrders(page, "Rapid")).orders.map((o: { orderNumber: number }) => o.orderNumber);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

test.describe("5.4 edit, delete, void", () => {
  test("editing quantity self-corrects totals; deleting an order drops it from revenue", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "EditDel" });
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "A", pay: "Cash" });
    await placeOrder(page, { items: [{ name: "Strawberry Matcha" }], name: "B", pay: "Venmo" });
    await placeOrder(page, { items: [{ name: "Hojicha Latte" }], name: "C", pay: "Zelle" });
    await goTab(page, "Barista Queue");
    // edit #1: 1 -> 3 classic
    await baristaCard(page, 1).getByTitle("Edit").click();
    const dlg = modal(page, /Edit order #1/);
    const plus = dlg.locator("button").filter({ has: page.locator("svg.lucide-plus") });
    await plus.last().click();
    await plus.last().click();
    await expect(dlg.getByText("$20.10").first()).toBeVisible();
    await dlg.getByRole("button", { name: "Save" }).click();
    let r = await eventOrders(page, "EditDel");
    expect(r.orders[0].items[0].quantity).toBe(3);
    // delete #2 -> numbers close the gap
    await baristaCard(page, 2).getByTitle("Remove").click();
    r = await eventOrders(page, "EditDel");
    expect(r.orders.map((o: { customerName: string }) => o.customerName)).toEqual(["A", "C"]);
    // NOTE: orderRevisions (audit trail) is only written by the Supabase store; local mode records none.
    await goTab(page, "Event Summary");
    await expect(page.locator("main").locator("dl > div").filter({ hasText: "Sales revenue" }).first()).toContainText("$26.60"); // 20.10 + 6.50
  });

  test("deleting an order keeps the other orders' numbers (QA-4, fixed)", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Renumber" });
    for (const n of ["A", "B", "C"]) await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: n, pay: "Cash" });
    await goTab(page, "Barista Queue");
    await baristaCard(page, 2).getByTitle("Remove").click();
    const r = await eventOrders(page, "Renumber");
    expect(r.orders.map((o: { orderNumber: number }) => o.orderNumber)).toEqual([1, 3]);
  });
});
