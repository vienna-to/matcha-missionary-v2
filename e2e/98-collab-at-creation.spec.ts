import type { Locator, Page } from "@playwright/test";
import { computeCollabSplit } from "../src/lib/collab-split";
import { autoAcceptDialogs, createEvent, expect, field, goTab, money, openApp, placeOrder, readState, test } from "./support";

/** Collab terms entered when the event is created (New event, Log past event). */
const newEventDialog = (page: Page) =>
  page.locator("div.fixed.inset-0", { has: page.getByRole("heading", { name: "New event" }) });

async function profitOf(page: Page, eventName: string) {
  const st = await readState(page);
  const ev = st.events.find((e: any) => e.name === eventName);
  const items = st.orders.filter((o: any) => o.eventId === ev.id).flatMap((o: any) => o.items);
  const revenue = items.reduce((s: number, i: any) => s + i.priceCharged * i.quantity, 0);
  const cost = items.reduce((s: number, i: any) => s + i.costSnap * i.quantity, 0);
  const fixed = ev.fixedCosts.reduce((s: number, f: any) => s + f.amount, 0);
  return { ev, profit: Math.round((revenue - cost - fixed) * 100) / 100 };
}

const cents = async (panel: Locator, id: string) =>
  Math.round(parseFloat((await panel.getByTestId(id).innerText()).replace(/[^0-9.\-]/g, "")) * 100);

test.describe("collab terms at event creation", () => {
  test("New event: terms are stored, the panel shows them at once and follows the orders", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Upfront collab", collab: { pct: "40", contribution: "1.5" } });
    expect((await readState(page)).events.find((e: any) => e.name === "Upfront collab")).toMatchObject({
      collabProfitPct: 40,
      collabContribution: 1.5,
    });

    // no orders yet: the panel is already there with the agreed terms and $0 profit
    await goTab(page, "Event Summary");
    const main = page.locator("main");
    const panel = main.getByTestId("collab-split");
    await expect(panel.getByTestId("collab-profit")).toHaveText(money(0));
    await expect(panel.getByTestId("collab-contribution")).toHaveText(money(1.5));
    await expect(panel).toContainText("Partner profit share (40%)");

    // orders come in: the split is the same calculation as the panel, and adds up
    await goTab(page, "Live Orders");
    await placeOrder(page, { items: [{ name: "Classic Matcha", qty: 3 }], name: "Three", pay: "Cash", declineCombo: true });
    await goTab(page, "Event Summary");
    const { profit } = await profitOf(page, "Upfront collab");
    expect(profit).toBeGreaterThan(0);
    const expected = computeCollabSplit(profit, 40, 1.5);
    await expect(panel.getByTestId("collab-profit")).toHaveText(money(expected.profit));
    await expect(panel.getByTestId("collab-share")).toHaveText(money(expected.partnerShare));
    await expect(panel.getByTestId("collab-partner")).toHaveText(money(expected.partnerTakeHome));
    await expect(panel.getByTestId("collab-you")).toHaveText(money(expected.yourTakeHome));
    expect((await cents(panel, "collab-partner")) + (await cents(panel, "collab-you"))).toBe(await cents(panel, "collab-profit"));

    // the panel editing is unchanged: it shows the creation values, and edit / remove still work
    await panel.getByRole("button", { name: "Edit collab split" }).click();
    await expect(main.getByLabel("Partner profit share %")).toHaveValue("40");
    await expect(main.getByLabel("Partner ingredient contribution $")).toHaveValue("1.5");
    await main.getByLabel("Partner profit share %").fill("25");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel.getByTestId("collab-share")).toHaveText(money(computeCollabSplit(profit, 25, 1.5).partnerShare));
    await panel.getByRole("button", { name: "Edit collab split" }).click();
    await panel.getByRole("button", { name: "Remove collab" }).click();
    await expect(panel).toContainText("Collab split: none");
  });

  test("blank fields: an ordinary event exactly as before; a contribution alone is a collab", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Plain event" });
    const plain = (await readState(page)).events.find((e: any) => e.name === "Plain event");
    expect(plain.collabProfitPct).toBeUndefined();
    expect(plain.collabContribution).toBeUndefined();
    await goTab(page, "Event Summary");
    await expect(page.locator("main").getByTestId("collab-split")).toContainText("Collab split: none");

    await createEvent(page, { name: "Contribution only", collab: { contribution: "20" } });
    expect((await readState(page)).events.find((e: any) => e.name === "Contribution only")).toMatchObject({
      collabProfitPct: 0,
      collabContribution: 20,
    });
  });

  test("validation matches the panel: bad values block Create event", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /new event/i }).first().click();
    const dlg = newEventDialog(page);
    await expect(dlg).toBeVisible();
    const create = dlg.getByRole("button", { name: "Create event" });
    await expect(create).toBeEnabled();
    const pct = field(dlg, "Partner profit share");
    const contribution = field(dlg, "Partner ingredient contribution");
    await pct.fill("101");
    await expect(create).toBeDisabled();
    await expect(dlg).toContainText("Profit share must be 0 to 100");
    await pct.fill("40");
    await expect(create).toBeEnabled();
    await contribution.fill("-5");
    await expect(create).toBeDisabled();
    await expect(dlg).toContainText("dollar amount of 0 or more");
    await contribution.fill("50");
    await expect(create).toBeEnabled();
    await pct.fill("");
    await contribution.fill("");
    await expect(create).toBeEnabled();
    // contract events have no collab fields
    await dlg.locator("select").first().selectOption("contract");
    await expect(dlg.getByText(/Partner profit share/i)).toHaveCount(0);
  });

  test("Log past event: terms are stored and shown on Event Summary", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await page.getByRole("button", { name: "log past event" }).click();
    const dlg = page.locator("div.fixed.inset-0", { has: page.getByRole("heading", { name: "Log past event" }) });
    await expect(dlg).toBeVisible();
    await field(dlg, "event name").fill("Past collab");
    await field(dlg, "partner profit share").fill("40");
    await field(dlg, "partner ingredient contribution").fill("1.5");
    await dlg.locator("div.grid", { hasText: "Classic Matcha" }).filter({ has: page.locator("input") }).last().locator("input").fill("4");
    await dlg.getByRole("button", { name: "Create past event" }).click();
    await expect(dlg).toBeHidden();
    expect((await readState(page)).events.find((e: any) => e.name === "Past collab")).toMatchObject({
      collabProfitPct: 40,
      collabContribution: 1.5,
    });

    await goTab(page, "Event Summary");
    const { ev, profit } = await profitOf(page, "Past collab");
    await page.locator("main select").first().selectOption(ev.id);
    const panel = page.locator("main").getByTestId("collab-split");
    const expected = computeCollabSplit(profit, 40, 1.5);
    await expect(panel.getByTestId("collab-partner")).toHaveText(money(expected.partnerTakeHome));
    await expect(panel.getByTestId("collab-you")).toHaveText(money(expected.yourTakeHome));
  });
});
