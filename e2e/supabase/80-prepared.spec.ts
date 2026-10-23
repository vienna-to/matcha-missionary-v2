import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { createEvent, goTab, placeOrder } from "../support";
import { modal, openMenuEditor } from "../extra";
import { acceptDialogs, exec, expect, LOCAL_API, pairNewWorkspace, seedMenu, sql, test } from "./sb";

/**
 * Prepared ingredients against the LOCAL Supabase, with and without the new
 * ingredients.kind / sub_recipe columns (supabase/migration-add-prepared-ingredients.sql).
 */
const DB = process.env.E2E_SB_DB_CONTAINER ?? "supabase_db_sbwork";
const MIGRATION = path.join(process.cwd(), "supabase", "migration-add-prepared-ingredients.sql");
const AGAVE_ML = 8.99 / 660;
const PUREE_ML = 7 / 500;
const batch = (agavePerMl = AGAVE_ML) => 100 * agavePerMl + 50 * PUREE_ML;

async function restKnowsColumns(): Promise<boolean> {
  const anon = process.env.E2E_SB_ANON ?? "";
  const r = await fetch(`${LOCAL_API}/rest/v1/ingredients?select=kind,sub_recipe&limit=0`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  return r.ok;
}
async function dropColumns() {
  exec("alter table public.ingredients drop column if exists kind, drop column if exists sub_recipe; notify pgrst, 'reload schema'");
  await expect.poll(restKnowsColumns, { timeout: 20_000 }).toBe(false);
}
async function applyMigration() {
  execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
    input: readFileSync(MIGRATION, "utf8"),
  });
  await expect.poll(restKnowsColumns, { timeout: 20_000 }).toBe(true);
}

async function openIngredients(page: Page) {
  await goTab(page, "Menu Manager");
  await page.getByRole("button", { name: /Ingredients/ }).first().click();
}

/** "Test Syrup": yield 500 ml, one batch = 100 ml agave + 50 ml strawberry purée. */
async function createSyrup(page: Page) {
  await openIngredients(page);
  await page.getByRole("button", { name: /New ingredient/ }).click();
  const form = modal(page, "New ingredient");
  await form.getByRole("textbox").first().fill("Test Syrup");
  await form.getByLabel("Type").selectOption("prepared");
  await form.locator("input[type=number]").first().fill("500");
  await form.locator("select").nth(1).selectOption("ml");
  await form.getByRole("button", { name: "Add" }).click();
  await expect(form).toBeHidden();
  await page.getByRole("button", { name: "Recipe for Test Syrup" }).click();
  const dlg = modal(page, "Recipe: Test Syrup");
  const addLine = async (n: number, ingredient: string, amount: number) => {
    await dlg.getByRole("button", { name: /Add ingredient/ }).click();
    await dlg.locator("select").nth(2 * n).selectOption({ label: ingredient });
    await dlg.locator("input").nth(n).fill(String(amount));
    await dlg.locator("select").nth(2 * n + 1).selectOption("ml");
  };
  await addLine(0, "Agave", 100);
  await addLine(1, "Strawberry purée", 50);
  await dlg.getByRole("button", { name: "Save recipe" }).click();
  await expect(dlg).toBeHidden();
}

async function addSyrupToClassic(page: Page) {
  await goTab(page, "Menu Manager");
  await page.getByRole("button", { name: "Items", exact: true }).click();
  const editor = await openMenuEditor(page, "Classic Matcha");
  await editor.getByRole("button", { name: /Add line/ }).click();
  const row = editor.locator("div.grid").filter({ has: page.locator("option", { hasText: "Test Syrup" }) }).last();
  await row.locator("select").first().selectOption({ label: "Test Syrup" });
  await row.locator("input").fill("30");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
}

test.describe("prepared ingredients on Supabase", () => {
  test("before the migration: raw ingredients work as ever, a prepared one is refused loudly and never saved as raw", async ({ page }) => {
    acceptDialogs(page);
    await dropColumns();
    const { workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws); // raw ingredients insert fine without the columns

    await createSyrup(page);
    await expect(page.getByRole("alert").filter({ hasText: "migration-add-prepared-ingredients.sql" }).first()).toBeVisible();
    // it was not stored as a raw ingredient with a $0 price
    expect(sql(`select count(*)::int n from public.ingredients where workspace_id='${ws}' and name='Test Syrup'`)[0].n).toBe(0);

    // ordinary raw edits are unaffected
    const price = page.locator(`tr:has(input[value="Agave"])`).locator("input").nth(1);
    await price.fill("9.5");
    await price.blur();
    await expect
      .poll(() => sql(`select package_price::float p from public.ingredients where workspace_id='${ws}' and name='Agave'`)[0]?.p)
      .toBe(9.5);
  });

  test("after the migration: stored, used in a drink, follows a raw price change, placed orders keep their cost", async ({ page }) => {
    acceptDialogs(page);
    await dropColumns();
    const { workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws);
    await applyMigration();
    // every existing ingredient is raw
    expect(sql(`select count(*)::int n from public.ingredients where workspace_id='${ws}' and kind <> 'raw'`)[0].n).toBe(0);
    await page.reload();

    await createSyrup(page);
    const [syrup] = sql(
      `select kind, sub_recipe, package_amount::float amt, unit, package_price::float price from public.ingredients where workspace_id='${ws}' and name='Test Syrup'`,
    );
    expect(syrup.kind).toBe("prepared");
    expect(syrup.amt).toBe(500);
    expect(syrup.unit).toBe("ml");
    expect(syrup.price).toBe(0);
    expect(syrup.sub_recipe).toHaveLength(2);
    const rawIds = sql(`select id from public.ingredients where workspace_id='${ws}' and name in ('Agave','Strawberry purée')`).map((r) => r.id);
    expect(syrup.sub_recipe.map((l: { ingredientId: string }) => l.ingredientId).sort()).toEqual([...rawIds].sort());

    await addSyrupToClassic(page);
    const [mi] = sql(`select ingredient_lines from public.menu_items where workspace_id='${ws}' and name='Classic Matcha'`);
    const [{ id: syrupId }] = sql(`select id from public.ingredients where workspace_id='${ws}' and name='Test Syrup'`);
    expect(mi.ingredient_lines).toContainEqual({ ingredientId: syrupId, amount: 30, unit: "ml" }); // one line, like any ingredient

    await createEvent(page, { name: "Prep sb" });
    await goTab(page, "Live Orders");
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Before", pay: "Cash", declineCombo: true });
    const cost = (name: string) =>
      sql(
        `select oi.cost_snap::float c from public.order_items oi join public.orders o on o.id = oi.order_id
          where o.workspace_id='${ws}' and o.customer_name='${name}'`,
      )[0]?.c as number | undefined;
    await expect.poll(() => cost("Before")).toBeGreaterThan(2);
    const classicBase =
      4.5 * (159 / 500) + 180 * (5.49 / 3785) + 5 * AGAVE_ML + 50 * (4 / 4000) + 28 / 100 + 12 / 100 + 6 / 250;
    expect(cost("Before")!).toBeCloseTo(classicBase + 30 * (batch() / 500), 4);
    // the event's frozen menu snapshot carries the prepared definition
    expect(sql(`select (menu_snapshot::text like '%Test Syrup%') as has from public.events where workspace_id='${ws}'`)[0].has).toBe(true);

    // survives a reload: still prepared, same computed cost
    await page.reload();
    await openIngredients(page);
    await expect(page.getByLabel("Type of Test Syrup")).toHaveValue("prepared");
    await expect(page.getByTestId("batch-cost-Test Syrup")).toContainText(`$${batch().toFixed(2)}`);

    // raw price change flows up; the placed order keeps its cost
    const price = page.locator(`tr:has(input[value="Agave"])`).locator("input").nth(1);
    await price.fill("17.98");
    await price.blur();
    await expect.poll(() => sql(`select package_price::float p from public.ingredients where workspace_id='${ws}' and name='Agave'`)[0].p).toBe(17.98);
    await expect(page.getByTestId("batch-cost-Test Syrup")).toContainText(`$${batch(AGAVE_ML * 2).toFixed(2)}`);
    await goTab(page, "Live Orders");
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "After", pay: "Cash", declineCombo: true });
    await expect.poll(() => cost("After")).toBeGreaterThan(2);
    expect(cost("After")! - cost("Before")!).toBeCloseTo((5 + 6) * AGAVE_ML, 4);
    expect(cost("Before")!).toBeCloseTo(classicBase + 30 * (batch() / 500), 4); // unchanged in the database
  });
});
