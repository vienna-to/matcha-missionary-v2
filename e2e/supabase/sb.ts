import { execFileSync } from "node:child_process";
import { expect, test as base, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Helpers for the Supabase-mode specs. Everything here talks to the LOCAL stack
 * only: the database container is `supabase_db_sbwork` (supabase start) and the
 * browser guard aborts any request to a hosted Supabase host.
 */
const DB_CONTAINER = process.env.E2E_SB_DB_CONTAINER ?? "supabase_db_sbwork";
export const LOCAL_API = process.env.E2E_SB_URL ?? "http://127.0.0.1:54321";

/** Run SQL in the local database, return rows as parsed JSON. */
// biome-ignore lint: test helper, shape checked by assertions
export function sql(query: string): any[] {
  const wrapped = `select coalesce(json_agg(t), '[]'::json) from (${query.replace(/;\s*$/, "")}) t`;
  const out = execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", wrapped],
    { encoding: "utf8" },
  );
  return JSON.parse(out.trim());
}

/** Run a statement that cannot be wrapped as a subquery (UPDATE / DELETE ...). */
export function exec(statement: string): void {
  execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-q", "-c", statement], {
    encoding: "utf8",
  });
}

/** Fail fast if this is not the local stack. */
export function assertLocalDb() {
  const [r] = sql("select inet_server_addr()::text as addr, current_database() as db");
  const host = new URL(LOCAL_API).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) throw new Error(`not a local API: ${LOCAL_API}`);
  return r;
}

async function guardContext(context: BrowserContext, hits: string[]) {
  await context.route(/supabase\.(co|in)|ycctyfibtbrtwhoqqyfm/, (route) => {
    hits.push(route.request().url());
    return route.abort();
  });
}

export const test = base.extend<{ guard: string[]; newPage: (ctx?: BrowserContext) => Promise<Page> }>({
  guard: [
    async ({ context }, use) => {
      const hits: string[] = [];
      await guardContext(context, hits);
      await use(hits);
      expect(hits, "app attempted to reach a hosted Supabase").toEqual([]);
    },
    { auto: true },
  ],
  newPage: async ({ browser, guard }, use) => {
    const made: BrowserContext[] = [];
    await use(async () => {
      const ctx = await browser.newContext();
      made.push(ctx);
      await guardContext(ctx, guard);
      return ctx.newPage();
    });
    for (const c of made) await c.close();
  },
});
export { expect };

/** App shell is up (a fresh workspace has no active event, so no Live Orders heading yet). */
export async function appReady(page: Page) {
  await expect(page.getByRole("button", { name: /new event/i }).first()).toBeVisible({ timeout: 20_000 });
}

/** Auto-accept confirm() dialogs; safe if another handler already accepted the same one. */
export function acceptDialogs(page: Page) {
  page.on("dialog", (d) => void d.accept().catch(() => {}));
}

export function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/** Open the app, create a brand-new workspace through the pairing screen, wait for Live Orders. */
export async function pairNewWorkspace(page: Page, code = randomCode()) {
  await page.goto("/");
  await expect(page.getByText("create a workspace or join an existing one with a code.")).toBeVisible();
  await page.getByPlaceholder("e.g. MATCHA").fill(code);
  await page.getByRole("button", { name: "create workspace" }).click();
  await appReady(page);
  const [ws] = sql(`select id, code from public.workspaces where code = '${code}'`);
  expect(ws, "workspace row exists in the local DB").toBeTruthy();
  return { code, workspaceId: ws.id as string };
}

/**
 * A new Supabase workspace has no menu. Use the app's own Settings > "Load sample
 * data" (accepting its confirm dialog) to get the default menu + ingredients, then
 * "Clear sample data" to drop the sample event and its 30 orders, keeping the menu.
 */
export async function seedMenu(page: Page, workspaceId: string) {
  // Only handle our own two confirms (specs may also install a global auto-accept).
  const accept = (d: import("@playwright/test").Dialog) => void d.accept().catch(() => {});
  await page.locator("aside").getByRole("button", { name: "Settings" }).click();
  page.once("dialog", accept);
  await page.getByRole("button", { name: /Load sample data into Supabase/ }).click();
  await expect
    .poll(() => sql(`select count(*)::int n from public.orders where workspace_id='${workspaceId}'`)[0].n, { timeout: 30_000 })
    .toBe(30);
  page.once("dialog", accept);
  await page.getByRole("button", { name: /Clear sample event/ }).click();
  await expect
    .poll(() => sql(`select count(*)::int n from public.events where workspace_id='${workspaceId}'`)[0].n, { timeout: 30_000 })
    .toBe(0);
  const [m] = sql(`select count(*)::int n from public.menu_items where workspace_id='${workspaceId}'`);
  expect(m.n).toBeGreaterThan(0);
  // The DB has the menu; wait until the app does too, or an event created next gets an empty menu.
  await page.locator("aside nav").getByRole("button", { name: "Menu Manager" }).click();
  await expect(page.getByText("Classic Matcha").first()).toBeVisible({ timeout: 20_000 });
  await page.locator("aside nav").getByRole("button", { name: "Live Orders" }).click();
}

export async function joinWorkspace(page: Page, code: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "join with code" }).click();
  await page.getByPlaceholder("enter the 6-char code").fill(code);
  await page.getByRole("button", { name: "join workspace" }).click();
  await appReady(page);
}

export type { Browser };
