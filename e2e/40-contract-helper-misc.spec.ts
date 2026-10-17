import { autoAcceptDialogs, createEvent, expect, field, goTab, openApp, placeOrder, readState, test } from "./support";
import { baristaCard, eventOrders, modal } from "./extra";

const line = (page: import("@playwright/test").Page, l: string) =>
  page.locator("main").locator("dl > div, tr").filter({ hasText: l }).first();

test.describe("5.5 contract events", () => {
  test("flat payout minus ingredient cost, separate from per-drink standard math", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Con", type: "contract", client: "Acme", payout: 500 });
    await goTab(page, "Event Summary");
    // zero-results state: payout intact, no NaN
    await expect(page.locator("main")).toContainText("$500.00");
    await expect(page.locator("main")).not.toContainText(/NaN|Infinity|undefined/);
    await page.getByRole("button", { name: /Enter results/ }).click();
    const dlg = modal(page, /Enter contract results/i);
    const inputs = dlg.locator("input[type=number]");
    await inputs.nth(0).fill("10"); // Classic Matcha
    await inputs.nth(8).fill("4"); //  Matcha Cheesecake
    await dlg.getByRole("button", { name: /Save results/i }).click();
    await expect(dlg).toBeHidden();
    // hand calc: cost = 10 x 2.2342 + 4 x 0.80 = 25.54 ; margin = 500 - 25.54 = 474.46
    const main = page.locator("main");
    await expect(main).toContainText("$25.54");
    await expect(main).toContainText("$474.46");
    // avg margin / drink = 474.46 / 10 ; per item = 474.46 / 14
    await expect(main).toContainText("$47.45");
    await expect(main).toContainText("$33.89");
    // the standard event math must not leak in: revenue-based fields stay absent
    await expect(main).not.toContainText("Revenue (paid)");
    const st = await readState(page);
    const ev = st.events.find((e: { name: string }) => e.name === "Con");
    expect(ev.contractPayout).toBe(500);
  });

  test("All events view includes the contract payout as revenue", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Con2", type: "contract", client: "Acme", payout: 500 });
    await goTab(page, "Event Summary");
    await page.locator("main select").first().selectOption("__all__");
    await expect(page.locator("main h1")).toContainText("All Events");
    // seed event 257.10 + contract payout 500.00 = 757.10 ; costs 170.61 (seed only, no results entered)
    await expect(page.locator("main")).toContainText("Total revenue$757.10");
    await expect(page.locator("main")).toContainText("$586.49");
    await expect(page.locator("main")).not.toContainText(/NaN|Infinity|undefined/);
  });
});

test.describe("5.5 helper mode", () => {
  test("share link enables helper mode: restricted tabs, param stripped, survives reload, cannot be turned off from the URL", async ({ page }) => {
    await page.goto("/?workspace=MATCHA-DEMO42&helper=1");
    await expect(page.getByRole("heading", { name: "Live Orders" })).toBeVisible();
    await expect(page).not.toHaveURL(/helper=/); // param stripped
    const nav = page.locator("aside nav");
    await expect(nav.getByRole("button", { name: "Live Orders" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Barista Queue" })).toBeVisible();
    for (const hidden of ["Menu Manager", "Finance", "Event Summary"]) await expect(nav.getByRole("button", { name: hidden })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /new event/i })).toHaveCount(0);
    // reload keeps it; ?helper=0 must not switch it off
    await page.goto("/?helper=0");
    await expect(page.locator("aside nav").getByRole("button", { name: "Finance" })).toHaveCount(0);
    // helper can still place an order and see it in the barista queue
    await placeOrder(page, { items: [{ name: "Hojicha Latte" }], name: "Helper", pay: "Cash" });
    await goTab(page, "Barista Queue");
    await expect(page.getByText("Helper").first()).toBeVisible();
  });

  test("fresh helper-link join in a brand-new browser context (local adapter only: owner's event is NOT shared)", async ({ browser, page }) => {
    // The owner creates an event in their context...
    await openApp(page);
    await createEvent(page, { name: "Owner Event" });
    // ...a helper opens the share link on another device (new context = empty storage).
    const helperCtx = await browser.newContext();
    const blocked: string[] = [];
    await helperCtx.route(/supabase\.(co|in)|ycctyfibtbrtwhoqqyfm/, (r) => {
      blocked.push(r.request().url());
      return r.abort();
    });
    const hp = await helperCtx.newPage();
    await hp.goto("/?workspace=MATCHA-DEMO42&helper=1");
    await expect(hp.getByRole("heading", { name: "Live Orders" })).toBeVisible();
    await expect(hp.locator("aside nav").getByRole("button", { name: "Finance" })).toHaveCount(0);
    // Documented limitation: without Supabase there is no workspace to join, so the helper
    // lands on its own seed data and cannot see "Owner Event". The Supabase join path
    // (?workspace=CODE auto-pairing) could not be tested here (see REPORT.md).
    await expect(hp.locator("aside").getByText("Owner Event")).toHaveCount(0);
    expect(blocked).toEqual([]);
    await helperCtx.close();
  });

  test("exiting helper mode needs the workspace code", async ({ page }) => {
    await page.goto("/?helper=1");
    await page.locator("aside").getByRole("button", { name: "Settings" }).click();
    const exit = page.getByRole("button", { name: /Exit helper mode/i });
    await field(page.locator("main"), "workspace code").fill("WRONG-CODE");
    await exit.click();
    await expect(page.getByText(/not the workspace code/i)).toBeVisible();
    await expect(page.locator("aside nav").getByRole("button", { name: "Finance" })).toHaveCount(0);
    await field(page.locator("main"), "workspace code").fill("MATCHA-DEMO42");
    await exit.click();
    await expect(page.locator("aside nav").getByRole("button", { name: "Finance" })).toBeVisible();
  });

  test("helper hides discounts and revenue (no discount button, no Event Summary)", async ({ page }) => {
    await page.goto("/?helper=1");
    await page.locator("main").getByRole("button", { name: /^Classic Matcha/ }).first().click();
    await expect(page.getByTitle("Discount")).toHaveCount(0);
  });
});

test.describe("5.5 concurrency and persistence (local adapter: tabs share localStorage + BroadcastChannel)", () => {
  test("two devices submitting at the same moment: both orders survive with unique numbers", async ({ context, page }) => {
    await openApp(page);
    await createEvent(page, { name: "Race" });
    const b = await context.newPage();
    await b.goto("/");
    await expect(b.getByRole("heading", { name: "Live Orders" })).toBeVisible();
    await expect(b.locator("aside").getByText("Race")).toBeVisible();
    await Promise.all([
      placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Tab A", pay: "Cash" }),
      placeOrder(b, { items: [{ name: "Hojicha Latte" }], name: "Tab B", pay: "Venmo" }),
    ]);
    await page.waitForTimeout(1200); // let both broadcasts settle
    const a = await eventOrders(page, "Race");
    const bb = await eventOrders(b, "Race");
    const names = (o: { orders: Array<{ customerName: string }> }) => o.orders.map((x) => x.customerName).sort();
    expect(names(a)).toEqual(["Tab A", "Tab B"]);
    expect(names(bb)).toEqual(["Tab A", "Tab B"]);
    expect(a.orders.map((o: { orderNumber: number }) => o.orderNumber).sort()).toEqual([1, 2]);
  });

  test("barista on a second device sees the order live and a claim shows on both", async ({ context, page }) => {
    await openApp(page);
    await createEvent(page, { name: "Live2" });
    const barista = await context.newPage();
    await barista.goto("/");
    await barista.locator("aside nav").getByRole("button", { name: "Barista Queue" }).click();
    await expect(barista.getByText("0 active")).toBeVisible();
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Live", pay: "Cash" });
    await expect(barista.getByText("1 active · 0 completed")).toBeVisible();
    await baristaCard(barista, 1).getByRole("button", { name: "Start" }).click();
    await goTab(page, "Barista Queue");
    await expect(page.getByText(/IN PROGRESS/).first()).toBeVisible();
  });

  test("reload keeps events and submitted orders; an unsent cart is lost", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Persist" });
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Kept", pay: "Cash" });
    await page.locator("main").getByRole("button", { name: /^Hojicha Latte/ }).first().click(); // unsent cart
    await expect(page.locator("aside").last().getByText("Hojicha Latte")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Live Orders" })).toBeVisible();
    expect((await eventOrders(page, "Persist")).orders).toHaveLength(1);
    await expect(page.locator("aside").last().getByText("No items yet")).toBeVisible(); // cart is React state only
  });

  test("browser back leaves the app (single URL, no history entries)", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Back" });
    await goTab(page, "Barista Queue");
    await page.goBack();
    // documents current behaviour: back exits the app instead of returning to Live Orders
    expect(page.url()).not.toContain("127.0.0.1:3101");
  });
});

test.describe("5.5 active event handling and empty states", () => {
  test("a previously active event can be made active again (QA-6, fixed)", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "First" });
    await createEvent(page, { name: "Second" });
    await goTab(page, "Event Summary");
    await expect(page.getByRole("button", { name: "Make active" })).toHaveCount(0); // Second is active
    const value = await page.locator("main select option", { hasText: /^First/ }).first().getAttribute("value");
    await page.locator("main select").first().selectOption(value!);
    await page.getByRole("button", { name: "Make active" }).click();
    await expect(page.getByRole("button", { name: "Make active" })).toHaveCount(0);
    const st = await readState(page);
    expect(st.events.filter((e: { isActive: boolean }) => e.isActive).map((e: { name: string }) => e.name)).toEqual(["First"]);
    // orders now go to First
    await goTab(page, "Live Orders");
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Back", pay: "Cash" });
    expect((await eventOrders(page, "First")).orders).toHaveLength(1);
    expect((await eventOrders(page, "Second")).orders).toHaveLength(0);
  });

  test("after deleting the active event, an earlier one can be resumed", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Early" });
    await createEvent(page, { name: "Late" });
    await goTab(page, "Event Summary");
    await page.getByRole("button", { name: "Delete event" }).click(); // deletes Late (active)
    await goTab(page, "Live Orders");
    await expect(page.getByText("No active event")).toBeVisible();
    await goTab(page, "Event Summary");
    await page.getByRole("button", { name: "Make active" }).click();
    await goTab(page, "Live Orders");
    await expect(page.getByRole("heading", { name: "Live Orders" })).toBeVisible();
    await expect(page.getByText("No active event")).toHaveCount(0);
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Resumed", pay: "Cash" });
    expect((await eventOrders(page, "Early")).orders).toHaveLength(1);
  });

  test("brand-new event with zero orders: every screen shows clean zeros, no NaN", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Empty" });
    for (const tab of ["Barista Queue", "Event Summary", "Finance"]) {
      await goTab(page, tab);
      const text = await page.locator("main").innerText();
      expect(text, tab).not.toMatch(/NaN|Infinity|undefined|\[object/);
    }
    await goTab(page, "Event Summary");
    await expect(line(page, "Sales revenue")).toContainText("$0.00");
    await expect(page.getByText("No sales yet.").first()).toBeVisible();
    await goTab(page, "Barista Queue");
    await expect(page.getByText("No active orders")).toBeVisible();
  });

  test("deleting the active event leaves a clear 'No active event' state, not a crash", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Doomed" });
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "X", pay: "Cash" });
    await goTab(page, "Event Summary");
    await page.getByRole("button", { name: "Delete event" }).click();
    await goTab(page, "Live Orders");
    await expect(page.getByText("No active event")).toBeVisible();
    const st = await readState(page);
    expect(st.events.some((e: { name: string }) => e.name === "Doomed")).toBe(false);
    expect(st.orders.some((o: { customerName: string }) => o.customerName === "X")).toBe(false); // cascade
  });
});

test.describe("exports", () => {
  test("event CSV downloads and its revenue matches the screen", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Csv" });
    await placeOrder(page, { items: [{ name: "Classic Matcha", qty: 2 }], name: "C", pay: "Cash" });
    await goTab(page, "Event Summary");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export CSV/ }).click()]);
    const fs = await import("node:fs");
    const csv = fs.readFileSync(await dl.path(), "utf8");
    expect(csv).toContain("Classic Matcha");
    expect(csv).toContain("13.40");
  });
});
