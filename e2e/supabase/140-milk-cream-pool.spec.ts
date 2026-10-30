import type { Locator } from "@playwright/test";
import { goTab } from "../support";
import { openMenuEditor } from "../extra";
import { acceptDialogs, exec, expect, pairNewWorkspace, seedMenu, sql, test } from "./sb";

/**
 * The reported case, against a live database: the milk and cream ingredients exist (typed in by hand, so they have
 * no pool), but "Uses milk?" / "Uses cream?" cannot be ticked because the app only treats an ingredient with
 * pool = milk / cream as a milk or cream, and no screen could set the pool.
 */
const box = (dlg: Locator, label: string) =>
  dlg.locator("div.space-y-1\\.5", { hasText: label }).locator("input[type=checkbox]");
const select = (dlg: Locator, label: string) =>
  dlg.locator("div.space-y-1\\.5", { hasText: label }).locator("select");

const ing = (ws: string, name: string) =>
  sql(`select id, pool from public.ingredients where workspace_id='${ws}' and name='${name}'`)[0];
const menu = (ws: string, name: string) =>
  sql(
    `select default_milk_id, default_cream_id, allowed_milk_ids, allowed_cream_ids from public.menu_items where workspace_id='${ws}' and name='${name}'`,
  )[0];

async function itemsTab(page: import("@playwright/test").Page) {
  await goTab(page, "Menu Manager");
  await page.getByRole("button", { name: "Items", exact: true }).click();
}

test("hand-made milks: designate them, then Uses milk? works and persists; cream is only a recipe ingredient", async ({ page }) => {
  acceptDialogs(page);
  const { workspaceId: ws } = await pairNewWorkspace(page);
  await seedMenu(page, ws);

  // the user's data: no ingredient is in a pool, their drinks have no milk / cream choices, plus a heavy cream
  exec(`update public.ingredients set pool = null where workspace_id='${ws}'`);
  exec(
    `update public.menu_items set default_milk_id = null, default_cream_id = null, allowed_milk_ids = '[]', allowed_cream_ids = '[]' where workspace_id='${ws}'`,
  );
  exec(
    `insert into public.ingredients (workspace_id, name, package_price, package_amount, unit) values ('${ws}', 'Heavy cream', 9, 500, 'ml')`,
  );
  await page.reload();

  // the symptom: ticking does nothing
  await itemsTab(page);
  let dlg = await openMenuEditor(page, "Matcha Cheesecake");
  await box(dlg, "Uses milk?").click();
  await expect(box(dlg, "Uses milk?")).not.toBeChecked();
  await dlg.getByRole("button", { name: "Cancel" }).click();

  // the fix: the Ingredients tab recognises them and marks them, stored in the database
  await goTab(page, "Menu Manager");
  await page.getByRole("button", { name: /Ingredients/ }).first().click();
  const milkBanner = page.getByTestId("suggest-milk");
  await expect(milkBanner).toContainText("Lactose-free milk");
  await milkBanner.getByRole("button", { name: "Mark as milk" }).click();
  // cream is not offered for designation: no banner, no selector value
  await expect(page.getByTestId("suggest-cream")).toHaveCount(0);
  await expect.poll(() => ing(ws, "Lactose-free milk").pool).toBe("milk");
  await expect.poll(() => ing(ws, "Whole milk").pool).toBe("milk");
  expect(ing(ws, "Heavy cream").pool).toBeNull();

  // a recipe that already used Whole milk keeps costing the same: it became that item's default milk
  await expect.poll(() => menu(ws, "Classic Matcha").default_milk_id).toBe(ing(ws, "Whole milk").id);

  // now the boxes tick, the dropdowns hold the milks and creams, and the choices persist through a reload
  await itemsTab(page);
  dlg = await openMenuEditor(page, "Matcha Cheesecake");
  await box(dlg, "Uses milk?").click();
  await expect(box(dlg, "Uses milk?")).toBeChecked();
  expect(await select(dlg, "Default milk").locator("option").allTextContents()).toEqual(
    expect.arrayContaining(["Whole milk", "Lactose-free milk"]),
  );
  await select(dlg, "Default milk").selectOption({ label: "Lactose-free milk" });
  for (const t of ["Uses cream?", "Default cream"]) await expect(dlg.getByText(t)).toHaveCount(0);
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();

  await expect.poll(() => menu(ws, "Matcha Cheesecake").default_milk_id).toBe(ing(ws, "Lactose-free milk").id);
  expect(menu(ws, "Matcha Cheesecake").default_cream_id).toBeNull();
  expect(menu(ws, "Matcha Cheesecake").allowed_milk_ids).toContain(ing(ws, "Whole milk").id);

  await page.reload();
  await itemsTab(page);
  dlg = await openMenuEditor(page, "Matcha Cheesecake");
  await expect(box(dlg, "Uses milk?")).toBeChecked();
  await expect(select(dlg, "Default milk")).toHaveValue(ing(ws, "Lactose-free milk").id);
});
