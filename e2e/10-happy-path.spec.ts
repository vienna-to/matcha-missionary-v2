import { autoAcceptDialogs, createEvent, expect, goTab, openApp, placeOrder, readState, test } from "./support";

/**
 * Full booth simulation on a brand-new event. Expected values are hand
 * calculated from the seed menu (prices) and seed ingredient package prices
 * (costs, 16 oz event cup = reference size so no scaling):
 *   Classic 6.70 / cost 2.2342   Strawberry 6.90 / 2.4852   Hojicha Latte 6.50 / 2.0332
 *   Earl Grey 6.90 / 2.0167      Cheesecake 8.00 / 0.80
 */
test.describe("happy path: a normal pop-up", () => {
  test("create event, take orders on every method, run the queue, check finance", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "QA Popup" });
    await expect(page.locator("aside").getByText("QA Popup")).toBeVisible();

    await placeOrder(page, { items: [{ name: "Classic Matcha", qty: 2 }], name: "Ann", pay: "Zelle" });
    await placeOrder(page, { items: [{ name: "Strawberry Matcha" }, { name: "Hojicha Latte" }], name: "Ben", pay: "Venmo" });
    await placeOrder(page, { items: [{ name: "Matcha Cheesecake" }], name: "Cy", pay: "Cash" });
    await placeOrder(page, { items: [{ name: "Classic Matcha" }, { name: "Matcha Cheesecake" }], name: "Di", pay: "Cash", declineCombo: true });
    await placeOrder(page, { items: [{ name: "Earl Grey Matcha" }], name: "Ed", pay: "Other" });

    await expect.poll(async () => (await readState(page)).orders.filter((o: { eventId: string }) => o.eventId === (null as never)).length >= 0).toBe(true);
    const st = await readState(page);
    const ev = st.events.find((e: { name: string }) => e.name === "QA Popup");
    const orders = st.orders.filter((o: { eventId: string }) => o.eventId === ev.id);
    expect(orders.map((o: { orderNumber: number }) => o.orderNumber).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(orders.every((o: { status: string }) => o.status === "pending")).toBe(true);

    // ---- barista queue: claim, tick items, complete, reopen ----
    await goTab(page, "Barista Queue");
    await expect(page.getByText("5 active · 0 completed")).toBeVisible();
    const card = (n: number) => page.locator("div.rounded-2xl", { hasText: `#${n}` }).filter({ has: page.getByRole("button", { name: /mark all done/i }) }).first();
    await card(1).getByRole("button", { name: "Start" }).click();
    await expect(page.getByText(/IN PROGRESS/).first()).toBeVisible();
    await card(1).getByRole("button", { name: /mark all done/i }).click();
    await expect(page.getByText("4 active · 1 completed")).toBeVisible();
    await card(2).getByRole("button", { name: /mark all done/i }).click();
    await expect(page.getByText("3 active · 2 completed")).toBeVisible();
    // reopen #2
    await page.getByRole("button", { name: /Completed \(2\)/ }).click();
    await page.getByRole("button", { name: "Reopen" }).first().click();
    await expect(page.getByText("4 active · 1 completed")).toBeVisible();

    // ---- finance: Event Summary ----
    await goTab(page, "Event Summary");
    const main = page.locator("main");
    const line = (l: string) => main.locator("dl > div").filter({ hasText: l }).first();
    const metric = (l: string) => main.locator("div.rounded-2xl").filter({ has: page.getByText(l, { exact: true }) }).first();
    await expect(main.locator("header p", { hasText: "QA Popup" })).toBeVisible();
    await expect(line("Sales revenue")).toContainText("$56.40");
    await expect(line("Total collected")).toContainText("$56.40");
    await expect(line("Items sold")).toContainText("8");
    const row = (m: string) => main.locator("tr", { has: page.getByRole("cell", { name: m, exact: true }) }).first();
    await expect(row("Zelle")).toContainText("$13.40");
    await expect(row("Venmo")).toContainText("$13.40");
    await expect(row("Cash")).toContainText("$22.70");
    await expect(row("Other")).toContainText("$6.90");
    await expect(row("All methods")).toContainText("$56.40");
    // metrics
    await expect(metric("Revenue (paid)")).toContainText("$56.40");
    await expect(metric("Total cost")).toContainText("$14.84");
    await expect(metric("Profit")).toContainText("$41.56");
    await expect(metric("Profit")).toContainText("73.7%");
    await expect(metric("Cups poured")).toContainText("6");
    await expect(metric("Pastries served")).toContainText("2");
  });
});
