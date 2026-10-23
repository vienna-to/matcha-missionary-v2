import { autoAcceptDialogs, createEvent, expect, goTab, openApp, placeOrder, readState, STATE_KEY, test } from "./support";

/**
 * The revenue share % is retired: nothing offers it any more, but an event that
 * already has one keeps its stored value and its numbers do not change.
 */
const money = (n: number) => `$${n.toFixed(2)}`;

test.describe("revenue share is no longer offered", () => {
  test("not in New event, not on Event Summary", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await page.getByRole("button", { name: /new event/i }).first().click();
    const dlg = page.locator("div.fixed.inset-0", { has: page.getByRole("heading", { name: "New event" }) });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByText(/revenue share/i)).toHaveCount(0);
    await dlg.getByRole("button", { name: "Cancel" }).click();
    await createEvent(page, { name: "No rev share" });
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "One", pay: "Cash", declineCombo: true });
    await goTab(page, "Event Summary");
    const main = page.locator("main");
    await expect(main.getByText(/revenue share/i)).toHaveCount(0);
    await expect(main.getByRole("button", { name: /revenue share/i })).toHaveCount(0);
    expect((await readState(page)).events.find((e: any) => e.name === "No rev share").donationPct).toBeUndefined();
  });
});

test.describe("an event that already has a revenue share keeps its numbers", () => {
  test("stored value is read-only on its summary, still in the all-events totals, and survives other edits", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Old charity" });
    await placeOrder(page, { items: [{ name: "Classic Matcha", qty: 3 }], name: "Three", pay: "Cash", declineCombo: true });

    // make it a historical event: 10% revenue share stored on it
    await page.evaluate((key) => {
      const st = JSON.parse(localStorage.getItem(key) ?? "null");
      st.events.find((e: any) => e.name === "Old charity").donationPct = 10;
      localStorage.setItem(key, JSON.stringify(st));
    }, STATE_KEY);
    await page.reload();

    const st = await readState(page);
    const ev = st.events.find((e: any) => e.name === "Old charity");
    const items = st.orders.filter((o: any) => o.eventId === ev.id).flatMap((o: any) => o.items);
    const revenue = items.reduce((s: number, i: any) => s + i.priceCharged * i.quantity, 0);
    const cost = items.reduce((s: number, i: any) => s + i.costSnap * i.quantity, 0);
    const share = revenue * 0.1;

    await goTab(page, "Event Summary");
    const main = page.locator("main");
    // the same tiles as before: revenue share, and Net profit = profit - share
    await expect(main.getByText("10% of revenue")).toBeVisible();
    await expect(main.getByText("Net profit").first()).toBeVisible();
    await expect(main).toContainText(money(share));
    await expect(main).toContainText(money(revenue - cost - share));
    // but no way to add, edit or remove it
    await expect(main.getByRole("button", { name: /revenue share/i })).toHaveCount(0);
    await expect(main.getByLabel(/revenue share/i)).toHaveCount(0);

    // another edit to the event (a collab split) leaves the stored value alone
    await main.getByRole("button", { name: "Add collab split" }).click();
    await main.getByLabel("Partner profit share %").fill("40");
    await main.getByTestId("collab-split").getByRole("button", { name: "Save" }).click();
    await expect(main.getByTestId("collab-partner")).toBeVisible();
    await expect(main.getByText("A revenue share is also set")).toHaveCount(0);
    expect((await readState(page)).events.find((e: any) => e.name === "Old charity").donationPct).toBe(10);

    // the all-events totals still count it
    await main.locator("select").first().selectOption({ index: 0 });
    await expect(main.getByText("Revenue share", { exact: true }).first()).toBeVisible();
    await expect(main).toContainText(money(share));
  });
});
