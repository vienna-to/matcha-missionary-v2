import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { createEvent, goTab, placeOrder } from "../support";
import { baristaCard, modal } from "../extra";
import { acceptDialogs, exec, expect, LOCAL_API, pairNewWorkspace, seedMenu, sql, test } from "./sb";

/**
 * Custom drinks against the LOCAL Supabase, with and without the new
 * ingredients.custom_role column (supabase/migration-add-ingredient-custom-role.sql):
 *  - before the migration the builder works (names are guessed), orders save, and
 *    setting a role reports the missing migration without losing other edits;
 *  - after it, the backfill sets roles, a role persists across a reload, and
 *    custom / combo / edited orders are stored and read back.
 */
const DB = process.env.E2E_SB_DB_CONTAINER ?? "supabase_db_sbwork";
const MIGRATION = path.join(process.cwd(), "supabase", "migration-add-ingredient-custom-role.sql");

const addBase = (dlg: Locator, name: string) => dlg.getByLabel("Add base").selectOption({ label: name });
const addTopping = (dlg: Locator, name: string) => dlg.getByLabel("Add topping").selectOption({ label: name });
const optionTexts = async (sel: Locator) => (await sel.locator("option").allTextContents()).map((t) => t.trim());

/** Does the REST API (schema cache) know ingredients.custom_role? */
async function restKnowsRole(): Promise<boolean> {
  const anon = process.env.E2E_SB_ANON ?? "";
  const r = await fetch(`${LOCAL_API}/rest/v1/ingredients?select=custom_role&limit=0`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  return r.ok;
}

async function dropRoleColumn() {
  exec("alter table public.ingredients drop column if exists custom_role; notify pgrst, 'reload schema'");
  await expect.poll(restKnowsRole, { timeout: 20_000 }).toBe(false);
}

async function applyMigration() {
  execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
    input: readFileSync(MIGRATION, "utf8"),
  });
  await expect.poll(restKnowsRole, { timeout: 20_000 }).toBe(true);
}

test.describe("custom drink on Supabase", () => {
  test("before the migration: builder works, orders save, a role reports the missing migration", async ({ page }) => {
    acceptDialogs(page);
    await dropRoleColumn();
    const { workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws);
    await createEvent(page, { name: "Pre migration" });

    // the dropdowns still work, from the name guess
    await page.locator("main header").getByRole("button", { name: "+ Custom drink" }).click();
    const dlg = modal(page, "Custom drink");
    expect(await optionTexts(dlg.getByLabel("Add base"))).toContain("Hojicha powder");
    await addBase(dlg, "Hojicha powder");
    await addTopping(dlg, "Banana cream");
    await dlg.getByRole("button", { name: "Add custom drink" }).click();
    await placeOrder(page, { items: [], name: "Pre", pay: "Cash" });
    await expect
      .poll(() => sql(`select count(*)::int n from public.order_items where workspace_id='${ws}'`)[0].n)
      .toBe(1);

    // setting a role fails on the database but says why, and the other edit in the patch survives
    await goTab(page, "Menu Manager");
    await page.getByRole("button", { name: /Ingredients/ }).first().click();
    await page.getByLabel("Custom drink role for Earl Grey leaves").selectOption("none");
    await expect(page.getByRole("alert").filter({ hasText: "migration-add-ingredient-custom-role.sql" })).toBeVisible();
    // ordinary ingredient edits are unaffected
    const price = page.locator(`tr:has(input[value="Agave"])`).locator("input").nth(1);
    await price.fill("9.5");
    await price.blur();
    await expect
      .poll(() => sql(`select package_price::float p from public.ingredients where workspace_id='${ws}' and name='Agave'`)[0]?.p)
      .toBe(9.5);
  });

  test("after the migration: backfill, role persists, custom / combo / edited orders are stored and read back", async ({ page }) => {
    acceptDialogs(page);
    await dropRoleColumn();
    const { workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws); // inserted while the column does not exist
    await applyMigration();

    const roles = () =>
      Object.fromEntries(
        sql(`select name, custom_role from public.ingredients where workspace_id='${ws}'`).map((r) => [r.name, r.custom_role]),
      );
    const r = roles();
    expect(r["Hojicha powder"]).toBe("base");
    expect(r["Matcha powder"]).toBe("base");
    expect(r["Earl Grey leaves"]).toBe("base");
    expect(r["Ube cream"]).toBe("topping");
    expect(r["Strawberry purée"]).toBe("topping");
    expect(r["Whole milk"]).toBeNull(); // milk is automatic, never a base
    expect(r["Agave"]).toBeNull();
    expect(r["16oz cup"]).toBeNull();

    await page.reload();
    await createEvent(page, { name: "Post migration" });
    await goTab(page, "Menu Manager");
    await page.getByRole("button", { name: /Ingredients/ }).first().click();
    await expect(page.getByLabel("Custom drink role for Hojicha powder")).toHaveValue("base");
    await page.getByLabel("Custom drink role for Earl Grey leaves").selectOption("none");
    await expect.poll(() => roles()["Earl Grey leaves"]).toBe("none");
    await expect(page.getByRole("alert").filter({ hasText: "migration-add-ingredient-custom-role" })).toHaveCount(0);
    await page.reload();
    await goTab(page, "Menu Manager");
    await page.getByRole("button", { name: /Ingredients/ }).first().click();
    await expect(page.getByLabel("Custom drink role for Earl Grey leaves")).toHaveValue("none");

    // the dropdown follows the stored flag
    await goTab(page, "Live Orders");
    await page.locator("main header").getByRole("button", { name: "+ Custom drink" }).click();
    let dlg = modal(page, "Custom drink");
    expect(await optionTexts(dlg.getByLabel("Add base"))).toEqual(["Add a base…", "Hojicha powder", "Matcha powder", "Milk only"]);
    await addBase(dlg, "Hojicha powder");
    await addBase(dlg, "Matcha powder");
    await addTopping(dlg, "Banana cream");
    await addTopping(dlg, "Strawberry purée");
    await expect(dlg.getByTestId("custom-price")).toHaveText("$7.10");
    await dlg.getByRole("button", { name: "Add custom drink" }).click();
    await placeOrder(page, { items: [], name: "Custom", pay: "Cash" });

    const oi = () =>
      sql(`select menu_item_id, menu_item_name_snap n, price_snap::float p, cost_snap::float c, is_combo, milk_name_snap m
             from public.order_items where workspace_id='${ws}' order by menu_item_name_snap`);
    await expect.poll(() => oi().length).toBe(1);
    const [row] = oi();
    expect(row.menu_item_id).toMatch(/^custom:/);
    expect(row.n).toBe("Custom: Hojicha powder + Matcha powder + Banana cream + Strawberry purée");
    expect(row.p).toBe(7.1);
    expect(row.c).toBeGreaterThan(2.5); // tea + milk + toppings + packaging
    expect(row.m).toBe("Whole milk");

    // a custom combo: $10 + 0.20 for each topping after the first
    await page.locator("main header").getByRole("button", { name: /Combo deal/ }).click();
    dlg = modal(page, /Combo deal/);
    await dlg.getByRole("combobox").first().selectOption({ label: "CUSTOM DRINK…" });
    await addBase(dlg, "Hojicha powder");
    await addTopping(dlg, "Banana cream");
    await addTopping(dlg, "Strawberry purée");
    await addTopping(dlg, "Ube cream");
    await expect(dlg.getByTestId("custom-price")).toHaveText("$10.40");
    await dlg.getByRole("button", { name: "Add combo" }).click();
    await placeOrder(page, { items: [], name: "Combo", pay: "Venmo" });
    await expect.poll(() => oi().length).toBe(2);
    const combo = oi().find((x) => x.is_combo)!;
    expect(combo.p).toBe(10.4);
    expect(combo.c).toBeGreaterThan(3);

    // Edit Order: add a custom drink to an existing order (atomic replace_order_items path)
    await goTab(page, "Barista Queue");
    await baristaCard(page, 1).getByTitle("Edit").click();
    const edit = modal(page, /Edit order #1/);
    await edit.getByRole("button", { name: /Add item/ }).click();
    await modal(page, "Add item").getByRole("button", { name: /Custom drink/ }).click();
    dlg = modal(page, "Custom drink");
    await addBase(dlg, "Milk only");
    await addTopping(dlg, "Ube cream");
    await dlg.getByRole("button", { name: "Add custom drink" }).click();
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(edit).toBeHidden();
    await expect.poll(() => oi().length).toBe(3);
    expect(oi().some((x) => x.n === "Custom: Milk + Ube cream" && x.p === 6.9)).toBe(true);
    // the original custom line kept its sale-time price and cost through the edit
    const kept = oi().find((x) => x.n.startsWith("Custom: Hojicha powder + Matcha"))!;
    expect(kept.p).toBe(7.1);
    expect(kept.c).toBeCloseTo(row.c, 6);

    // read back from the database after a full reload
    await page.reload();
    await goTab(page, "Event Summary");
    const main = page.locator("main");
    await expect(main).toContainText("Custom: Hojicha powder");
    await expect(main).toContainText("Revenue (paid)");
    await goTab(page, "Barista Queue");
    await expect(page.locator("main")).toContainText("Custom: Milk + Ube cream");
  });
});
