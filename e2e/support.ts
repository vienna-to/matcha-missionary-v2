import { expect, test as base, type Locator, type Page } from "@playwright/test";

export const STATE_KEY = "matcha-missionary:state:v1";

/**
 * Every test gets a fresh browser context (empty localStorage -> seed data) and
 * a network guard: any request to a Supabase host fails the test. This is the
 * second line of defence behind the blanked env vars.
 */
export const test = base.extend<{ guard: string[] }>({
  guard: [
    async ({ context }, use) => {
      const hits: string[] = [];
      await context.route(/supabase\.(co|in)|ycctyfibtbrtwhoqqyfm/, (route) => {
        hits.push(route.request().url());
        return route.abort();
      });
      await use(hits);
      expect(hits, "app attempted to reach Supabase").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

/** Confirm dialogs (delete order / event) auto-accept unless a test overrides. */
export function autoAcceptDialogs(page: Page, log: string[] = []) {
  page.on("dialog", (d) => {
    log.push(`${d.type()}: ${d.message()}`);
    void d.accept();
  });
  return log;
}

/** Field() renders <Label> and the control as siblings with no htmlFor, so
 *  getByLabel can't see them (a11y note in REPORT.md). Find the control by its label text. */
export function field(scope: Locator | Page, label: string | RegExp): Locator {
  return scope
    .locator('div[class~="space-y-1.5"]')
    .filter({ hasText: label })
    .locator("input, select, textarea")
    .first();
}

export async function openApp(page: Page, query = "") {
  await page.goto("/" + query);
  await expect(page.getByRole("heading", { name: "Live Orders" })).toBeVisible();
}

// biome-ignore lint: test helper, shape checked by assertions
export async function readState(page: Page): Promise<any> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), STATE_KEY);
}

export async function goTab(page: Page, label: string) {
  await page.locator("aside nav").getByRole("button", { name: label }).click();
}

export async function createEvent(
  page: Page,
  opts: { name: string; type?: "standard" | "contract"; client?: string; payout?: number; cup?: number; collab?: { pct?: string; contribution?: string } } = { name: "QA Event" },
) {
  await page.getByRole("button", { name: /new event/i }).first().click();
  // Modal has no role=dialog (a11y note in REPORT.md), so find it by its heading.
  const dlg = page.locator("div.fixed.inset-0", { has: page.getByRole("heading", { name: "New event" }) });
  await expect(dlg).toBeVisible();
  if (opts.type === "contract") {
    await field(dlg, "Event type").selectOption("contract");
    await field(dlg, "Client name").fill(opts.client ?? "Acme");
    await field(dlg, /Contracted payout/).fill(String(opts.payout ?? 500));
  }
  if (opts.cup) await field(dlg, "Cup size (oz)").fill(String(opts.cup));
  if (opts.collab?.pct !== undefined) await field(dlg, "Partner profit share").fill(opts.collab.pct);
  if (opts.collab?.contribution !== undefined) await field(dlg, "Partner ingredient contribution").fill(opts.collab.contribution);
  await field(dlg, "Event name").fill(opts.name);
  await dlg.getByRole("button", { name: "Create event" }).click();
  await expect(dlg).toBeHidden();
}

export type Pay = "Zelle" | "Venmo" | "Cash" | "Other";

/** Place one order through the Live Orders flow (desktop side panel). */
export async function placeOrder(
  page: Page,
  o: { items: Array<{ name: string; qty?: number }>; name?: string; pay?: Pay; declineCombo?: boolean },
) {
  const grid = page.locator("main");
  for (const it of o.items) {
    await grid.getByRole("button", { name: new RegExp(`^${it.name}`) }).first().click();
  }
  // bump quantities in the side panel
  for (const it of o.items) {
    const extra = (it.qty ?? 1) - 1;
    if (extra > 0) {
      const line = page.locator("aside").locator("div.rounded-xl", { hasText: it.name }).first();
      for (let i = 0; i < extra; i++) await line.getByRole("button", { name: "More" }).click();
    }
  }
  await page.locator("aside ol").getByRole("button", { name: /Name/ }).click();
  if (o.declineCombo) {
    const no = page.getByRole("button", { name: /no thanks/i });
    if (await no.isVisible().catch(() => false)) await no.click();
  }
  if (o.name !== undefined) await page.getByPlaceholder("who's it for?").fill(o.name);
  await page.locator("aside ol").getByRole("button", { name: /Payment/ }).click();
  if (o.pay) await page.locator("aside").getByRole("button", { name: o.pay, exact: true }).click();
  await page.locator("aside").getByRole("button", { name: /Confirm order/ }).click();
}

export const money = (n: number) => `$${n.toFixed(2)}`;
