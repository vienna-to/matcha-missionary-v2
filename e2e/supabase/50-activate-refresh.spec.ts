import { createEvent, goTab, placeOrder } from "../support";
import { acceptDialogs, expect, pairNewWorkspace, seedMenu, sql, test } from "./sb";

/**
 * Make active must leave the UI fully current without a reload: the sidebar's
 * active-event card shows the activated event's real order count, and the
 * Event Summary shows the event as active (no Make active button, live layout).
 */
test("after Make active the sidebar card and summary are current without a reload", async ({ page }) => {
  acceptDialogs(page);
  const { workspaceId: ws } = await pairNewWorkspace(page);
  await seedMenu(page, ws);

  await createEvent(page, { name: "Old event" });
  await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "One", pay: "Cash" });
  await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Two", pay: "Zelle" });
  await expect
    .poll(() => sql(`select count(*)::int n from public.orders where workspace_id='${ws}'`)[0].n)
    .toBe(2);

  await createEvent(page, { name: "New event" }); // deactivates Old event
  const card = page.locator("aside").getByRole("button", { name: /^Active event/ });
  await expect(card).toContainText("New event");
  await expect(card).toContainText("0 orders");

  await goTab(page, "Event Summary");
  const value = await page.locator("main select option", { hasText: /^Old event/ }).first().getAttribute("value");
  await page.locator("main select").first().selectOption(value!);
  await page.getByRole("button", { name: "Make active" }).click();

  // database is right...
  await expect
    .poll(() => sql(`select name from public.events where workspace_id='${ws}' and is_active`).map((r) => r.name))
    .toEqual(["Old event"]);
  // ...and so is the UI, with no reload
  await expect(card).toContainText("Old event");
  await expect(card).toContainText("2 orders");
  await expect(page.getByRole("button", { name: "Make active" })).toHaveCount(0);

  // stays right across the next background polls (5s) and a full resync
  await page.waitForTimeout(7_000);
  await expect(card).toContainText("Old event");
  await expect(card).toContainText("2 orders");

  // and identical after a reload
  const before = (await card.innerText()).replace(/\s+/g, " ");
  await page.reload();
  const cardAfter = page.locator("aside").getByRole("button", { name: /^Active event/ });
  await expect(cardAfter).toContainText("2 orders");
  expect((await cardAfter.innerText()).replace(/\s+/g, " ")).toBe(before);
});
