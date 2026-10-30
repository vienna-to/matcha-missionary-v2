import type { Locator } from "@playwright/test";
import { goTab } from "../support";
import { modal, openMenuEditor } from "../extra";
import { acceptDialogs, expect, pairNewWorkspace, seedMenu, sql, test } from "./sb";

/**
 * Menu Manager "Uses milk?" against a live database. Turning it OFF used to save
 * default_milk_id unchanged (an undefined patch value was skipped), so the old default
 * came back on the next sync, the box ticked itself again and the choices stayed disabled: it looked dead.
 */
const box = (dlg: Locator, label: string) =>
  dlg.locator("div.space-y-1\\.5", { hasText: label }).locator("input[type=checkbox]");

const row = (ws: string, name: string) =>
  sql(
    `select default_milk_id is not null as has_milk, coalesce(jsonb_array_length(allowed_milk_ids),0)::int as milks
       from public.menu_items where workspace_id='${ws}' and name='${name}'`,
  )[0];

test("turning Uses milk? off and on is saved in the database and survives a reload", async ({ page }) => {
  acceptDialogs(page);
  const { workspaceId: ws } = await pairNewWorkspace(page);
  await seedMenu(page, ws);
  // pick a drink that has a default milk
  const name = sql(
    `select name from public.menu_items where workspace_id='${ws}' and default_milk_id is not null order by sort_order limit 1`,
  )[0]?.name as string;
  expect(name).toBeTruthy();
  const start = row(ws, name);
  expect(start.has_milk).toBe(true);

  // OFF, save
  let dlg = await openMenuEditor(page, name);
  await box(dlg, "Uses milk?").click();
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect.poll(() => row(ws, name)).toEqual({ has_milk: false, milks: 0 });

  // the app agrees after the database echo and after a reload (it used to tick itself again)
  await page.waitForTimeout(1500);
  await page.reload();
  dlg = await openMenuEditor(page, name);
  await expect(box(dlg, "Uses milk?")).not.toBeChecked();

  // ON again: saved with a default and the allowed lists
  await box(dlg, "Uses milk?").click();
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect.poll(() => row(ws, name)).toMatchObject({ has_milk: true });
  expect((row(ws, name)).milks).toBeGreaterThan(0);
  await page.reload();
  dlg = await openMenuEditor(page, name);
  await expect(box(dlg, "Uses milk?")).toBeChecked();
  void goTab;
  void modal;
});
