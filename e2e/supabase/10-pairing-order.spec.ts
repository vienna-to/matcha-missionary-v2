import { createEvent, goTab, placeOrder } from "../support";
import { appReady, expect, joinWorkspace, LOCAL_API, pairNewWorkspace, seedMenu, sql, test, assertLocalDb } from "./sb";

test.describe("isolation", () => {
  test("the app talks to the LOCAL stack only", async ({ page }) => {
    const info = assertLocalDb();
    console.log(`[local DB] ${LOCAL_API}  server=${info.addr} db=${info.db}`);
    const hosts = new Set<string>();
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.port === "54321") hosts.add(u.origin);
    });
    await pairNewWorkspace(page);
    expect([...hosts]).toEqual([LOCAL_API]);
  });
});

test.describe("workspace pairing", () => {
  test("create a workspace, reload (remembered), then join it from a second device", async ({ page, newPage }) => {
    const { code, workspaceId } = await pairNewWorkspace(page);
    // a brand-new workspace starts empty (no menu) until sample data is loaded
    const [m0] = sql(`select count(*)::int n from public.menu_items where workspace_id='${workspaceId}'`);
    expect(m0.n).toBe(0);
    await seedMenu(page, workspaceId);

    await page.reload();
    await appReady(page);

    const other = await newPage();
    await joinWorkspace(other, code);
  });

  test("joining a code that does not exist shows an error and stays on the pairing screen", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "join with code" }).click();
    await page.getByPlaceholder("enter the 6-char code").fill("ZZZZZZ");
    await page.getByRole("button", { name: "join workspace" }).click();
    await expect(page.getByText(/could not find workspace/)).toBeVisible();
  });

  test("a duplicate code on create is rejected with the 'already taken' message", async ({ page, newPage }) => {
    const { code } = await pairNewWorkspace(page);
    const other = await newPage();
    await other.goto("/");
    await other.getByPlaceholder("e.g. MATCHA").fill(code);
    await other.getByRole("button", { name: "create workspace" }).click();
    await expect(other.getByText(/already taken/)).toBeVisible();
  });

  test("helper link ?workspace=CODE&helper=1 auto-joins in helper mode with no pairing screen", async ({ page, newPage }) => {
    const { code } = await pairNewWorkspace(page);
    const helper = await newPage();
    await helper.goto(`/?workspace=${code}&helper=1`);
    await expect(helper.locator("aside nav").getByRole("button", { name: "Barista Queue" })).toBeVisible({ timeout: 20_000 });
    // the params are stripped from the address bar
    await expect.poll(() => new URL(helper.url()).search).toBe("");
    // helper mode hides the finance / menu tabs
    await expect(helper.locator("aside nav").getByRole("button", { name: "Menu Manager" })).toHaveCount(0);
    await expect(helper.locator("aside nav").getByRole("button", { name: "Barista Queue" })).toBeVisible();
    // and the pairing persisted for the device
    const pairing = await helper.evaluate(() => localStorage.getItem("matcha-missionary:pairing:v1"));
    expect(JSON.parse(pairing!).code).toBe(code);
  });

  test("a bad ?workspace= code lands on the join tab with an error", async ({ page }) => {
    await page.goto("/?workspace=NOPE99");
    await expect(page.getByText("Workspace not found.")).toBeVisible();
  });
});

test.describe("order submission (submit_order RPC)", () => {
  test("a placed order is written with its items, snapshots and a number", async ({ page }) => {
    const { workspaceId } = await pairNewWorkspace(page);
    await seedMenu(page, workspaceId);
    await createEvent(page, { name: "SB Pop-up" });
    await placeOrder(page, { items: [{ name: "Classic Matcha", qty: 2 }], name: "Ada", pay: "Venmo" });
    await expect(page.getByRole("status")).toContainText("Ada");

    const orders = sql(
      `select o.order_number, o.customer_name, o.payment_method, o.payment_status
         from public.orders o join public.events e on e.id=o.event_id
        where o.workspace_id='${workspaceId}' and e.name='SB Pop-up'`,
    );
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ order_number: 1, customer_name: "Ada", payment_method: "venmo" });
    const items = sql(
      `select menu_item_name_snap, quantity, price_snap::float, list_price::float, price_charged::float, cost_snap::float
         from public.order_items where workspace_id='${workspaceId}'`,
    );
    expect(items).toHaveLength(1);
    expect(items[0].menu_item_name_snap).toBe("Classic Matcha");
    expect(items[0].quantity).toBe(2);
    expect(items[0].price_snap).toBeGreaterThan(0);
    expect(items[0].cost_snap).toBeGreaterThan(0);

    // a second order gets number 2
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Bo", pay: "Cash" });
    await expect(page.getByRole("status")).toContainText("Bo");
    const nums = sql(`select order_number from public.orders where workspace_id='${workspaceId}' order by 1`);
    expect(nums.map((r) => r.order_number)).toEqual([1, 2]);
    await goTab(page, "Barista Queue");
    await expect(page.getByText("2 active · 0 completed")).toBeVisible();
  });
});
