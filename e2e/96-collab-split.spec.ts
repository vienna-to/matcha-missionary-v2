import { autoAcceptDialogs, createEvent, expect, goTab, openApp, placeOrder, readState, test } from "./support";

/** Collab split on Event Summary: partner share of profit minus their ingredient contribution. */
const money = (n: number) => `$${n.toFixed(2)}`;

test.describe("collab split on an event", () => {
  test("add, edit and remove it; the numbers follow the formula and survive a reload", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Collab night" });
    await placeOrder(page, { items: [{ name: "Classic Matcha", qty: 3 }], name: "Three", pay: "Cash", declineCombo: true });
    await goTab(page, "Event Summary");

    const main = page.locator("main");
    const panel = main.getByTestId("collab-split");
    const event = async () => (await readState(page)).events.find((e: any) => e.name === "Collab night");

    // profit = revenue - costs, taken from what was actually stamped on the order
    const st = await readState(page);
    const ev = st.events.find((e: any) => e.name === "Collab night");
    const items = st.orders.filter((o: any) => o.eventId === ev.id).flatMap((o: any) => o.items);
    const revenue = items.reduce((s: number, i: any) => s + i.priceCharged * i.quantity, 0);
    const cost = items.reduce((s: number, i: any) => s + i.costSnap * i.quantity, 0);
    const fixed = ev.fixedCosts.reduce((s: number, f: any) => s + f.amount, 0);
    const profit = revenue - cost - fixed;
    expect(revenue).toBeGreaterThan(0);

    await expect(panel).toContainText("Collab split: none");
    expect((await event()).collabProfitPct).toBeUndefined();

    // validation: share over 100, negative contribution, and nothing filled in
    await main.getByRole("button", { name: "Add collab split" }).click();
    const pct = main.getByLabel("Partner profit share %");
    const contrib = main.getByLabel("Partner ingredient contribution $");
    const save = panel.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    await pct.fill("101");
    await expect(save).toBeDisabled();
    await pct.fill("40");
    await contrib.fill("-5");
    await expect(save).toBeDisabled();

    // 40% split, $1.50 contribution typed as dollars
    await contrib.fill("1.5");
    await save.click();
    const partner = profit * 0.4 - 1.5;
    await expect(panel.getByTestId("collab-profit")).toHaveText(money(profit));
    await expect(panel.getByTestId("collab-share")).toHaveText(money(profit * 0.4));
    await expect(panel.getByTestId("collab-contribution")).toHaveText(money(1.5));
    await expect(panel.getByTestId("collab-partner")).toHaveText(money(partner));
    await expect(panel.getByTestId("collab-you")).toHaveText(money(profit - partner));
    expect(await event()).toMatchObject({ collabProfitPct: 40, collabContribution: 1.5 });

    // the legacy revenue share is a separate thing and untouched
    expect((await event()).donationPct).toBeUndefined();

    // survives a reload, then edit
    await page.reload();
    await goTab(page, "Event Summary");
    await expect(panel.getByTestId("collab-partner")).toHaveText(money(partner));
    await panel.getByRole("button", { name: "Edit collab split" }).click();
    await expect(pct).toHaveValue("40");
    await expect(contrib).toHaveValue("1.5");
    await pct.fill("25");
    await contrib.fill("0");
    await save.click();
    await expect(panel.getByTestId("collab-partner")).toHaveText(money(profit * 0.25));
    await expect(panel.getByTestId("collab-you")).toHaveText(money(profit * 0.75));

    // remove it completely
    await panel.getByRole("button", { name: "Edit collab split" }).click();
    await panel.getByRole("button", { name: "Remove collab" }).click();
    await expect(panel).toContainText("Collab split: none");
    const gone = await event();
    expect(gone.collabProfitPct).toBeUndefined();
    expect(gone.collabContribution).toBeUndefined();
  });

  test("a contribution alone (no split %) is a collab with a 0% share", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Contribution only" });
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "One", pay: "Cash", declineCombo: true });
    await goTab(page, "Event Summary");
    const main = page.locator("main");
    const panel = main.getByTestId("collab-split");
    await main.getByRole("button", { name: "Add collab split" }).click();
    await main.getByLabel("Partner ingredient contribution $").fill("2");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel.getByTestId("collab-contribution")).toHaveText(money(2));
    await expect(panel.getByTestId("collab-share")).toHaveText(money(0));
    await expect(panel).toContainText("take-home is negative"); // contribution exceeds a 0% share
  });
});
