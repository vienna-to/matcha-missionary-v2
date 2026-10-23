import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { createEvent, goTab, placeOrder } from "../support";
import { modal, openMenuEditor } from "../extra";
import { acceptDialogs, exec, expect, LOCAL_API, pairNewWorkspace, seedMenu, sql, test } from "./sb";

/**
 * custom-items + prepared-ingredients together against the LOCAL Supabase, for
 * every combination of the two independent migrations:
 *   custom_role                (migration-add-ingredient-custom-role.sql)
 *   kind + sub_recipe          (migration-add-prepared-ingredients.sql)
 * The same checks run with neither, one, the other, and both applied.
 */
const DB = process.env.E2E_SB_DB_CONTAINER ?? "supabase_db_sbwork";
const MIGRATIONS = {
  role: path.join(process.cwd(), "supabase", "migration-add-ingredient-custom-role.sql"),
  prepared: path.join(process.cwd(), "supabase", "migration-add-prepared-ingredients.sql"),
};
const AGAVE_ML = 8.99 / 660;
const PUREE_ML = 7 / 500;
const batch = (agavePerMl = AGAVE_ML) => 100 * agavePerMl + 50 * PUREE_ML;
const PACKAGING = 28 / 100 + 12 / 100 + 6 / 250 + (4 / 4000) * 50 + AGAVE_ML * 5;
const customCost = (agavePerMl = AGAVE_ML) =>
  4 * (32 / 100) + 180 * (5.49 / 3785) + 30 * (batch(agavePerMl) / 500) + (PACKAGING - 5 * AGAVE_ML + 5 * agavePerMl);

async function restKnows(select: string): Promise<boolean> {
  const anon = process.env.E2E_SB_ANON ?? "";
  const r = await fetch(`${LOCAL_API}/rest/v1/ingredients?select=${select}&limit=0`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  return r.ok;
}

/** Put the local database in exactly this state: each migration's columns present or absent. */
async function setColumns({ role, prepared }: { role: boolean; prepared: boolean }) {
  exec(
    "alter table public.ingredients drop column if exists custom_role, drop column if exists kind, drop column if exists sub_recipe; notify pgrst, 'reload schema'",
  );
  const run = (file: string) =>
    execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
      input: readFileSync(file, "utf8"),
    });
  if (role) run(MIGRATIONS.role);
  if (prepared) run(MIGRATIONS.prepared);
  await expect.poll(() => restKnows("custom_role"), { timeout: 20_000 }).toBe(role);
  await expect.poll(() => restKnows("kind,sub_recipe"), { timeout: 20_000 }).toBe(prepared);
}

const addBase = (dlg: Locator, name: string) => dlg.getByLabel("Add base").selectOption({ label: name });
const addTopping = (dlg: Locator, name: string) => dlg.getByLabel("Add topping").selectOption({ label: name });
const banner = (page: Page, file: string) => page.getByRole("alert").filter({ hasText: file });

async function openIngredients(page: Page) {
  await goTab(page, "Menu Manager");
  await page.getByRole("button", { name: /Ingredients/ }).first().click();
}

async function createSyrup(page: Page) {
  await openIngredients(page);
  await page.getByRole("button", { name: /New ingredient/ }).click();
  const form = modal(page, "New ingredient");
  await form.getByRole("textbox").first().fill("Test Syrup");
  await form.getByLabel("Type", { exact: true }).selectOption("prepared");
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

const row = (ws: string, name: string) =>
  sql(`select package_price::float p, package_amount::float a, unit from public.ingredients where workspace_id='${ws}' and name='${name}'`)[0];

/** The same scenario in every database state: nothing ever corrupts a raw row, and each missing migration is reported. */
async function commonChecks(page: Page, ws: string, cols: { role: boolean; prepared: boolean }) {
  await createEvent(page, { name: "Combo of migrations" });
  const dubaiBefore = row(ws, "Dubai chocolate spread");
  const earlBefore = row(ws, "Earl Grey leaves");

  // 1. a prepared ingredient: stored when the prepared columns exist; otherwise refused loudly and NOT stored as raw
  await createSyrup(page);
  const stored = sql(`select count(*)::int n from public.ingredients where workspace_id='${ws}' and name='Test Syrup'`)[0].n;
  if (cols.prepared) {
    expect(stored).toBe(1);
    expect(sql(`select kind, sub_recipe from public.ingredients where workspace_id='${ws}' and name='Test Syrup'`)[0].kind).toBe("prepared");
    await expect(banner(page, "migration-add-prepared-ingredients.sql")).toHaveCount(0);
  } else {
    expect(stored).toBe(0);
    await expect(banner(page, "migration-add-prepared-ingredients.sql").first()).toBeVisible();
  }

  // 2. a custom drink role: stored when custom_role exists; otherwise reported, and the rest of the edit still saved
  await page.getByLabel("Custom drink role for Earl Grey leaves").selectOption("none");
  if (cols.role) {
    await expect.poll(() => sql(`select custom_role from public.ingredients where workspace_id='${ws}' and name='Earl Grey leaves'`)[0].custom_role).toBe("none");
    await expect(banner(page, "migration-add-ingredient-custom-role.sql")).toHaveCount(0);
  } else {
    await expect(banner(page, "migration-add-ingredient-custom-role.sql").first()).toBeVisible();
  }
  expect(row(ws, "Earl Grey leaves")).toEqual(earlBefore);

  // 3. turn a raw ingredient (Dubai chocolate spread, in one drink only) into a prepared one and edit its recipe and yield
  await page.getByLabel("Type of Dubai chocolate spread").selectOption("prepared");
  const recipe = modal(page, "Recipe: Dubai chocolate spread");
  await recipe.getByRole("button", { name: /Add ingredient/ }).click();
  await recipe.locator("input").first().fill("10");
  await recipe.getByRole("button", { name: "Save recipe" }).click();
  await expect(recipe).toBeHidden();
  await page.waitForTimeout(2000); // writes are asynchronous
  const dubaiAfter = sql(`select package_price::float p, package_amount::float a, unit, ${cols.prepared ? "kind" : "'raw' as kind"} from public.ingredients where workspace_id='${ws}' and name='Dubai chocolate spread'`)[0];
  if (cols.prepared) {
    expect(dubaiAfter.kind).toBe("prepared");
  } else {
    // never zeroed, never overwritten with the prepared yield or unit
    expect({ p: dubaiAfter.p, a: dubaiAfter.a, unit: dubaiAfter.unit }).toEqual(dubaiBefore);
  }
  // ordinary raw edits are unaffected in every state
  const price = page.locator(`tr:has(input[value="Agave"])`).locator("input").nth(1);
  await price.fill("9.5");
  await price.blur();
  await expect.poll(() => row(ws, "Agave").p).toBe(9.5);
}

const STATES: Array<[string, { role: boolean; prepared: boolean }]> = [
  ["neither migration applied", { role: false, prepared: false }],
  ["only the custom role migration applied", { role: true, prepared: false }],
  ["only the prepared ingredients migration applied", { role: false, prepared: true }],
];

test.describe("both features against every migration state (local Supabase)", () => {
  for (const [label, cols] of STATES) {
    test(`${label}: nothing is corrupted, each missing migration is reported`, async ({ page }) => {
      acceptDialogs(page);
      await setColumns(cols);
      const { workspaceId: ws } = await pairNewWorkspace(page);
      await seedMenu(page, ws);
      await commonChecks(page, ws, cols);
    });
  }

  test("both migrations applied: role + prepared stored, a prepared ingredient costs from its recipe in a custom drink and follows a raw price change", async ({ page }) => {
    acceptDialogs(page);
    await setColumns({ role: false, prepared: false });
    const { workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws); // seeded with neither column
    await setColumns({ role: true, prepared: true }); // then both migrations (role backfill included)
    expect(sql(`select count(*)::int n from public.ingredients where workspace_id='${ws}' and kind <> 'raw'`)[0].n).toBe(0);
    expect(sql(`select custom_role from public.ingredients where workspace_id='${ws}' and name='Hojicha powder'`)[0].custom_role).toBe("base");
    await page.reload();
    await commonChecks(page, ws, { role: true, prepared: true });

    // flag the syrup a topping (stored), use it in a recipe, build a custom drink with it
    await goTab(page, "Menu Manager");
    await page.getByRole("button", { name: /Ingredients/ }).first().click();
    await page.getByLabel("Custom drink role for Test Syrup").selectOption("topping");
    await expect.poll(() => sql(`select custom_role from public.ingredients where workspace_id='${ws}' and name='Test Syrup'`)[0].custom_role).toBe("topping");

    await page.getByRole("button", { name: "Items", exact: true }).click();
    const editor = await openMenuEditor(page, "Classic Matcha");
    await editor.getByRole("button", { name: /Add line/ }).click();
    const lineRow = editor.locator("div.grid").filter({ has: page.locator("option", { hasText: "Test Syrup" }) }).last();
    await lineRow.locator("select").first().selectOption({ label: "Test Syrup" });
    await lineRow.locator("input").fill("30");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).toBeHidden();

    // after a reload: still prepared + topping, and offered in the builder
    await page.reload();
    await openIngredients(page);
    await expect(page.getByLabel("Type of Test Syrup")).toHaveValue("prepared");
    await expect(page.getByLabel("Custom drink role for Test Syrup")).toHaveValue("topping");
    await goTab(page, "Live Orders");
    const cost = (name: string) =>
      sql(
        `select oi.cost_snap::float c, oi.price_snap::float p, oi.menu_item_id id from public.order_items oi
           join public.orders o on o.id = oi.order_id where o.workspace_id='${ws}' and o.customer_name='${name}'`,
      )[0];

    const build = async (name: string) => {
      await page.locator("main header").getByRole("button", { name: "+ Custom drink" }).click();
      const dlg = modal(page, "Custom drink");
      await addBase(dlg, "Hojicha powder");
      await addTopping(dlg, "Test Syrup");
      await expect(dlg.getByTestId("custom-price")).toHaveText("$6.90");
      await dlg.getByRole("button", { name: "Add custom drink" }).click();
      await placeOrder(page, { items: [], name, pay: "Cash" });
    };
    await build("Before");
    await expect.poll(() => cost("Before")?.c).toBeGreaterThan(2);
    const before = cost("Before");
    expect(before.id).toMatch(/^custom:/);
    expect(before.p).toBe(6.9);
    // the agave price edited in commonChecks is part of the expectation: agave is $9.50/660 ml now
    const agave = 9.5 / 660;
    expect(before.c).toBeCloseTo(customCost(agave), 4);

    // raw price change flows raw -> prepared -> custom drink; the placed order keeps its cost
    await openIngredients(page);
    const price = page.locator(`tr:has(input[value="Agave"])`).locator("input").nth(1);
    await price.fill("19");
    await price.blur();
    await expect.poll(() => row(ws, "Agave").p).toBe(19);
    await goTab(page, "Live Orders");
    await build("After");
    await expect.poll(() => cost("After")?.c).toBeGreaterThan(2);
    expect(cost("After").c).toBeCloseTo(customCost(19 / 660), 4);
    expect(cost("Before").c).toBeCloseTo(before.c, 10);

    // read back from the database after a full reload
    await page.reload();
    await goTab(page, "Event Summary");
    await expect(page.locator("main")).toContainText("Custom: Hojicha powder + Test Syrup");
  });
});
