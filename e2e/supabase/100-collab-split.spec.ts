import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createEvent, goTab, placeOrder } from "../support";
import { acceptDialogs, exec, expect, LOCAL_API, pairNewWorkspace, seedMenu, sql, test } from "./sb";

/**
 * Collab split against the LOCAL Supabase, with and without
 * migration-add-collab-split.sql: with it the split is stored in events and
 * survives a reload; without it ordinary events still work, the split is
 * reported (not silently lost) and nothing else breaks.
 */
const DB = process.env.E2E_SB_DB_CONTAINER ?? "supabase_db_sbwork";
const MIGRATION = path.join(process.cwd(), "supabase", "migration-add-collab-split.sql");
const money = (n: number) => `$${n.toFixed(2)}`;

async function restKnows(): Promise<boolean> {
  const anon = process.env.E2E_SB_ANON ?? "";
  const r = await fetch(`${LOCAL_API}/rest/v1/events?select=collab_profit_pct,collab_contribution&limit=0`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  return r.ok;
}

async function setMigration(applied: boolean) {
  exec("alter table public.events drop column if exists collab_profit_pct, drop column if exists collab_contribution; notify pgrst, 'reload schema'");
  if (applied) {
    execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
      input: readFileSync(MIGRATION, "utf8"),
    });
  }
  await expect.poll(restKnows, { timeout: 20_000 }).toBe(applied);
}

const evRow = (ws: string, name: string) =>
  sql(`select collab_profit_pct::float pct, collab_contribution::float c from public.events where workspace_id='${ws}' and name='${name}'`)[0];

test.describe("collab split (local Supabase)", () => {
  test("migration applied: stored, survives reload, edits and removal reach the database; the constraints hold", async ({ page }) => {
    acceptDialogs(page);
    await setMigration(true); // and it is safe to run a second time:
    execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
      input: readFileSync(MIGRATION, "utf8"),
    });
    const { workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws);
    await createEvent(page, { name: "Collab db" });
    await placeOrder(page, { items: [{ name: "Classic Matcha", qty: 3 }], name: "Three", pay: "Cash", declineCombo: true });
    expect(evRow(ws, "Collab db")).toEqual({ pct: null, c: null }); // an ordinary event is not a collab

    await goTab(page, "Event Summary");
    const main = page.locator("main");
    const panel = main.getByTestId("collab-split");
    await main.getByRole("button", { name: "Add collab split" }).click();
    await main.getByLabel("Partner profit share %").fill("40");
    await main.getByLabel("Partner ingredient contribution $").fill("1.5");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => evRow(ws, "Collab db")).toEqual({ pct: 40, c: 1.5 });
    await expect(page.getByRole("alert").filter({ hasText: "migration-add-collab-split.sql" })).toHaveCount(0);

    // the amounts shown follow the formula using the database's own order numbers
    const [t] = sql(
      `select coalesce(sum(oi.price_charged*oi.quantity),0)::float rev, coalesce(sum(oi.cost_snap*oi.quantity),0)::float cost
         from public.order_items oi join public.orders o on o.id=oi.order_id where o.workspace_id='${ws}'`,
    );
    const profit = t.rev - t.cost;
    await expect(panel.getByTestId("collab-partner")).toHaveText(money(profit * 0.4 - 1.5));
    await expect(panel.getByTestId("collab-you")).toHaveText(money(profit - (profit * 0.4 - 1.5)));

    // reload: the split comes back from the database
    await page.reload();
    await goTab(page, "Event Summary");
    await expect(panel.getByTestId("collab-partner")).toHaveText(money(profit * 0.4 - 1.5));

    // edit, then remove
    await panel.getByRole("button", { name: "Edit collab split" }).click();
    await main.getByLabel("Partner profit share %").fill("25");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => evRow(ws, "Collab db")).toEqual({ pct: 25, c: 1.5 });
    await panel.getByRole("button", { name: "Edit collab split" }).click();
    await panel.getByRole("button", { name: "Remove collab" }).click();
    await expect.poll(() => evRow(ws, "Collab db")).toEqual({ pct: null, c: null });

    // the database refuses nonsense even if the app were bypassed
    const bad = (set: string) => {
      try {
        exec(`update public.events set ${set} where workspace_id='${ws}'`);
        return false;
      } catch {
        return true;
      }
    };
    expect(bad("collab_profit_pct = 101")).toBe(true);
    expect(bad("collab_profit_pct = -1")).toBe(true);
    expect(bad("collab_contribution = -5")).toBe(true);
    expect(bad("collab_profit_pct = 100, collab_contribution = 0")).toBe(false);
  });

  test("migration NOT applied: ordinary events work, the split is reported and never silently dropped", async ({ page }) => {
    acceptDialogs(page);
    await setMigration(false);
    const { workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws);
    await createEvent(page, { name: "No migration" });
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "One", pay: "Cash", declineCombo: true });
    expect(sql(`select count(*)::int n from public.events where workspace_id='${ws}' and name='No migration'`)[0].n).toBe(1);

    // a historical event with the retired revenue share stored on it
    exec(`update public.events set donation_pct = 10 where workspace_id='${ws}' and name='No migration'`);
    await page.reload();

    await goTab(page, "Event Summary");
    const main = page.locator("main");
    await expect(main.getByText("10% of revenue").first()).toBeVisible();
    await expect(main.getByRole("button", { name: /revenue share/i })).toHaveCount(0); // read-only
    const panel = main.getByTestId("collab-split");
    await main.getByRole("button", { name: "Add collab split" }).click();
    await main.getByLabel("Partner profit share %").fill("40");
    await main.getByLabel("Partner ingredient contribution $").fill("1.5");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "migration-add-collab-split.sql" }).first()).toBeVisible();
    await expect(panel.getByTestId("collab-partner")).toBeVisible(); // still works on this device

    // the stored revenue share is untouched, in the database and on screen
    expect(sql(`select donation_pct::float d from public.events where workspace_id='${ws}' and name='No migration'`)[0].d).toBe(10);
    await expect(main.getByText("10% of revenue").first()).toBeVisible();
  });

  test("terms entered at creation are stored with the migration", async ({ page }) => {
    acceptDialogs(page);
    await setMigration(true);
    const { workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws);
    await createEvent(page, { name: "Plain db" });
    await expect.poll(() => sql(`select count(*)::int n from public.events where workspace_id='${ws}' and name='Plain db'`)[0].n).toBe(1);
    expect(evRow(ws, "Plain db")).toEqual({ pct: null, c: null });
    await createEvent(page, { name: "Upfront db", collab: { pct: "40", contribution: "50" } }); // newest = shown on Event Summary
    await expect.poll(() => evRow(ws, "Upfront db")).toEqual({ pct: 40, c: 50 });
    await goTab(page, "Event Summary");
    await page.reload();
    await goTab(page, "Event Summary");
    await expect(page.locator("main").getByTestId("collab-contribution")).toHaveText(money(50));

  });

  test("terms entered at creation without the migration: the event is still created (orders point at it), the terms are reported", async ({ page }) => {
    acceptDialogs(page);
    await setMigration(false);
    const second = await pairNewWorkspace(page);
    await seedMenu(page, second.workspaceId);
    await createEvent(page, { name: "Upfront no migration", collab: { pct: "40", contribution: "50" } });
    await expect
      .poll(() => sql(`select count(*)::int n from public.events where workspace_id='${second.workspaceId}' and name='Upfront no migration'`)[0].n)
      .toBe(1);
    await expect(page.getByRole("alert").filter({ hasText: "migration-add-collab-split.sql" }).first()).toBeVisible();
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "One", pay: "Cash", declineCombo: true });
    await expect
      .poll(() => sql(`select count(*)::int n from public.orders o join public.events e on e.id=o.event_id where e.workspace_id='${second.workspaceId}' and e.name='Upfront no migration'`)[0].n)
      .toBe(1);
  });
});
