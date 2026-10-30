import { field, goTab } from "../support";
import { modal, openMenuEditor } from "../extra";
import { acceptDialogs, expect, pairNewWorkspace, seedMenu, sql, test } from "./sb";

/** Duplicate a menu item against a live database: an identical, independent row, no migration. */
const row = (ws: string, name: string) =>
  sql(
    `select id, name, category, price::float price, size, active, description, ingredient_lines, default_milk_id, default_cream_id,
            allowed_milk_ids, allowed_cream_ids, taxable
       from public.menu_items where workspace_id='${ws}' and name='${name.replace(/'/g, "''")}'`,
  )[0];

test("Duplicate writes an identical, independent menu_items row", async ({ page }) => {
  acceptDialogs(page);
  const { workspaceId: ws } = await pairNewWorkspace(page);
  await seedMenu(page, ws);
  const name = "Classic Matcha";
  const original = row(ws, name);
  expect(original.ingredient_lines.length).toBeGreaterThan(0);

  const rowCount = () => sql(`select count(*)::int n from public.menu_items where workspace_id='${ws}'`)[0].n as number;
  const before = rowCount();

  // Duplicate + Cancel: nothing is written, not even briefly
  await goTab(page, "Menu Manager");
  await page.getByRole("button", { name: `Duplicate ${name}`, exact: true }).click();
  let dlg = modal(page, /Duplicate menu item/);
  await expect(dlg).toBeVisible();
  await page.waitForTimeout(1500);
  expect(rowCount()).toBe(before); // an open draft is not in the database
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(1500);
  expect(rowCount()).toBe(before);
  expect(row(ws, `${name} (copy)`)).toBeUndefined();

  // Duplicate + Save: the copy is written
  await page.getByRole("button", { name: `Duplicate ${name}`, exact: true }).click();
  dlg = modal(page, /Duplicate menu item/);
  await dlg.getByRole("button", { name: "Save" }).click(); // keep the copy unchanged
  await expect.poll(() => row(ws, `${name} (copy)`)?.id).toBeTruthy();
  expect(rowCount()).toBe(before + 1);

  const copy = row(ws, `${name} (copy)`);
  expect(copy.id).not.toBe(original.id);
  for (const k of ["category", "price", "size", "description", "ingredient_lines", "default_milk_id", "default_cream_id", "allowed_milk_ids", "allowed_cream_ids", "taxable"]) {
    expect(copy[k], k).toEqual(original[k]);
  }
  expect(copy.active).toBe(true);

  // edit the copy in the app: only the copy's row changes
  const editor = await openMenuEditor(page, String.raw`${name} \(copy\)`);
  await field(editor, "Price ($)").fill("11.25");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
  await expect.poll(() => row(ws, `${name} (copy)`).price).toBe(11.25);
  expect(row(ws, name)).toEqual(original);

  // and after a reload the two are still two different, correct items
  await page.reload();
  await goTab(page, "Menu Manager");
  expect(row(ws, name)).toEqual(original);
  expect(row(ws, `${name} (copy)`).ingredient_lines).toEqual(original.ingredient_lines);
});
