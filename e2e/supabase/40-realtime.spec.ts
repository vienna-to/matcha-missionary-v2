import { createEvent, goTab, placeOrder } from "../support";
import { baristaCard } from "../extra";
import { acceptDialogs, expect, joinWorkspace, pairNewWorkspace, seedMenu, sql, test } from "./sb";

/**
 * Two browsers (two contexts = two devices) in the same workspace: changes on one
 * show up on the other with no reload, via Supabase Realtime.
 */
test.describe("realtime sync between two devices", () => {
  test("an order placed on device A appears on B's barista queue; B starting it and A removing it both propagate", async ({ page, newPage }) => {
    acceptDialogs(page);
    const { code, workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws);
    await createEvent(page, { name: "Sync" });

    const b = await newPage();
    acceptDialogs(b);
    await joinWorkspace(b, code);
    await goTab(b, "Barista Queue");
    await expect(b.getByText("0 active · 0 completed")).toBeVisible();

    // A rings up an order; B sees it without reloading
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Realtime Rae", pay: "Zelle" });
    await expect(b.getByText("1 active · 0 completed")).toBeVisible({ timeout: 15_000 });
    await expect(b.getByText("Realtime Rae")).toBeVisible();

    // B starts the order; A's Barista Queue reflects it
    await baristaCard(b, 1).getByRole("button", { name: /Start/ }).click();
    await expect
      .poll(() => sql(`select status from public.order_items where workspace_id='${ws}'`)[0].status)
      .not.toBe("pending");
    await goTab(page, "Barista Queue");
    await expect(baristaCard(page, 1).getByRole("button", { name: /Start/ })).toHaveCount(0, { timeout: 15_000 });

    // A removes the order; B's queue empties
    await baristaCard(page, 1).getByTitle("Remove").click();
    await expect(b.getByText("0 active · 0 completed")).toBeVisible({ timeout: 15_000 });
    await expect(b.getByText("Realtime Rae")).toHaveCount(0);
  });

  test("a menu price change on A reaches B", async ({ page, newPage }) => {
    acceptDialogs(page);
    const { code, workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws);
    await createEvent(page, { name: "Menu sync" });
    const b = await newPage();
    await joinWorkspace(b, code);

    const { setMenuPrice } = await import("../extra");
    await setMenuPrice(page, "Classic Matcha", 11);
    await expect
      .poll(() => sql(`select price::float p from public.menu_items where workspace_id='${ws}' and name='Classic Matcha'`)[0].p)
      .toBe(11);
    await goTab(b, "Live Orders");
    await expect(b.locator("main").getByRole("button", { name: /^Classic Matcha/ }).first()).toContainText("$11", { timeout: 15_000 });
  });
});
