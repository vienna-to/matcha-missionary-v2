import { createEvent, goTab } from "../support";
import { acceptDialogs, expect, pairNewWorkspace, seedMenu, sql, test } from "./sb";

/**
 * FIXES.md item 2 against a live database: "Make active" writes is_active=true and
 * the tg_events_single_active trigger deactivates every other event, including
 * after the active event was deleted.
 */
const active = (ws: string): string[] =>
  sql(`select name from public.events where workspace_id='${ws}' and is_active order by name`).map((r) => r.name);

async function viewEvent(page: import("@playwright/test").Page, name: string) {
  await goTab(page, "Event Summary");
  const value = await page.locator("main select option", { hasText: new RegExp(`^${name}`) }).first().getAttribute("value");
  await page.locator("main select").first().selectOption(value!);
}

test.describe("item 2: Make active (Supabase)", () => {
  test("re-activating a non-active event: the DB trigger leaves exactly one active; orders then go to it", async ({ page }) => {
    acceptDialogs(page);
    const { workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws);
    await createEvent(page, { name: "First" });
    await createEvent(page, { name: "Second" });
    await expect.poll(() => active(ws)).toEqual(["Second"]); // creating deactivates the previous one

    await goTab(page, "Event Summary");
    await expect(page.getByRole("button", { name: "Make active" })).toHaveCount(0); // Second is shown and active
    await viewEvent(page, "First");
    await page.getByRole("button", { name: "Make active" }).click();
    await expect.poll(() => active(ws)).toEqual(["First"]);
    await expect(page.getByRole("button", { name: "Make active" })).toHaveCount(0);

    // the next order lands in First, not Second
    await goTab(page, "Live Orders");
    const { placeOrder } = await import("../support");
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Back", pay: "Cash" });
    await expect
      .poll(() =>
        sql(
          `select e.name, count(*)::int n from public.orders o join public.events e on e.id=o.event_id
            where o.workspace_id='${ws}' group by e.name`,
        ),
      )
      .toEqual([{ name: "First", n: 1 }]);
  });

  test("the database rule itself: activating any event in SQL deactivates the others", async ({ page }) => {
    const { workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws);
    await createEvent(page, { name: "A" });
    await createEvent(page, { name: "B" });
    await createEvent(page, { name: "C" });
    await expect.poll(() => active(ws)).toEqual(["C"]);
    sql(`update public.events set is_active = true where workspace_id='${ws}' and name='A' returning id`);
    expect(active(ws)).toEqual(["A"]);
  });

  test("after deleting the active event nothing is active; Make active resumes an earlier one", async ({ page }) => {
    acceptDialogs(page);
    const { workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws);
    await createEvent(page, { name: "Early" });
    await createEvent(page, { name: "Late" });
    await expect.poll(() => active(ws)).toEqual(["Late"]);

    await goTab(page, "Event Summary");
    await page.getByRole("button", { name: "Delete event" }).click(); // deletes Late (active)
    await expect
      .poll(() => sql(`select name from public.events where workspace_id='${ws}' order by name`).map((r) => r.name))
      .toEqual(["Early"]);
    expect(active(ws)).toEqual([]);
    await goTab(page, "Live Orders");
    await expect(page.getByText("No active event")).toBeVisible();

    await goTab(page, "Event Summary");
    await page.getByRole("button", { name: "Make active" }).click();
    await expect.poll(() => active(ws)).toEqual(["Early"]);
    await goTab(page, "Live Orders");
    await expect(page.getByText("No active event")).toHaveCount(0);
  });
});
