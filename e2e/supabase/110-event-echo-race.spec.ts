import type { WebSocketRoute } from "@playwright/test";
import { createEvent, goTab } from "../support";
import { acceptDialogs, exec, expect, pairNewWorkspace, seedMenu, sql, test } from "./sb";

/**
 * "Wrong event deleted" (REPORT.md): hold back the Realtime messages about the
 * events table that follow the first event's INSERT, release only that first
 * INSERT after the second event exists. This is delivery latency, not a different
 * order: the frames still arrive in the order the server sent them. Before the fix
 * the late INSERT echo (is_active = true) made the older event active again on this
 * device, Event Summary opened on it, and Delete removed it from the database.
 */
const names = (ws: string) => sql(`select name from public.events where workspace_id='${ws}' order by created_at`).map((r) => r.name);
const activeNames = (ws: string) => sql(`select name from public.events where workspace_id='${ws}' and is_active`).map((r) => r.name);

test("late echo of the first event's INSERT: what is active, what Event Summary selects, what Delete removes", async ({ page }) => {
  acceptDialogs(page);
  let holding = false;
  const held: string[] = [];
  let pageSide: WebSocketRoute | undefined;
  await page.routeWebSocket(/realtime/, (ws) => {
    pageSide = ws;
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      const text = typeof m === "string" ? m : m.toString();
      if (holding && text.includes('"table":"events"')) held.push(text);
      else ws.send(m);
    });
  });

  const { workspaceId: ws } = await pairNewWorkspace(page);
  await seedMenu(page, ws);
  await page.waitForTimeout(1500);

  holding = true; // from here on, events-table echoes are delayed
  await createEvent(page, { name: "Early" });
  await createEvent(page, { name: "Late" });
  await expect.poll(() => names(ws)).toEqual(["Early", "Late"]);
  await expect.poll(() => activeNames(ws)).toEqual(["Late"]); // the database is right
  await expect.poll(() => held.length).toBeGreaterThanOrEqual(3);
  console.log("HELD FRAMES", held.length, held.map((h) => (/"type":"(\w+)"/.exec(h) ?? [])[1] + ":" + ((/"name":"([^"]+)"/.exec(h) ?? [])[1])).join(", "));

  const sidebarActive = async () => (await page.locator("aside").first().innerText()).replace(/\s+/g, " ");
  await expect(page.locator("aside").first()).toContainText(/Active event\s*Late/i);

  // Release only the echo of Early's INSERT. It carries is_active = true (true when Early was created),
  // but Early has since been deactivated by creating Late, so it must not make Early active again.
  const first = held.findIndex((h) => h.includes('"INSERT"') && h.includes('"Early"'));
  expect(first).toBeGreaterThanOrEqual(0);
  pageSide!.send(held[first]);
  await page.waitForTimeout(400);
  expect(await sidebarActive(), "a late INSERT echo must not re-activate the older event").toContain("ACTIVE EVENT LATE");

  // Event Summary opens on the event that is really active, and Delete removes that one
  await goTab(page, "Event Summary");
  const selected = await page.locator("main select").first().evaluate((el: HTMLSelectElement) => el.options[el.selectedIndex].text);
  expect(selected).toMatch(/^Late/);

  // the rest of the delayed frames (Late INSERT, Early UPDATE is_active=false) arrive: everything converges
  for (let i = 0; i < held.length; i++) if (i !== first) pageSide!.send(held[i]);
  await page.waitForTimeout(400);
  expect(await sidebarActive()).toContain("ACTIVE EVENT LATE");
  expect(activeNames(ws)).toEqual(["Late"]);

  await page.getByRole("button", { name: "Delete event" }).click();
  await expect.poll(() => names(ws)).toEqual(["Early"]); // Late (the one shown) was deleted, Early untouched
});

test("a genuine activation from another device still reaches this one (UPDATE echoes are not ignored)", async ({ page, newPage }) => {
  acceptDialogs(page);
  const { workspaceId: ws } = await pairNewWorkspace(page);
  await seedMenu(page, ws);
  await createEvent(page, { name: "Alpha" });
  await createEvent(page, { name: "Beta" });
  await expect.poll(() => activeNames(ws)).toEqual(["Beta"]);
  await expect(page.locator("aside").first()).toContainText(/Active event\s*Beta/i);
  exec(`update public.events set is_active = true where workspace_id='${ws}' and name='Alpha'`);
  await expect(page.locator("aside").first()).toContainText(/Active event\s*Alpha/i);
  void newPage;
});
