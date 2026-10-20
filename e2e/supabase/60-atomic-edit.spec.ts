import { spawn } from "node:child_process";
import type { Page } from "@playwright/test";
import { createEvent, goTab, placeOrder } from "../support";
import { baristaCard, modal } from "../extra";
import { acceptDialogs, exec, expect, joinWorkspace, pairNewWorkspace, seedMenu, sql, test } from "./sb";

/**
 * Edit Order replaces an order's items atomically (public.replace_order_items):
 * no reader ever sees the order with no items or with a mix of old and new rows.
 */
const DB = process.env.E2E_SB_DB_CONTAINER ?? "supabase_db_sbwork";

/** The whole order card (baristaCard() is only its header row, which has no item list). */
const orderCard = (page: Page, n: number) => baristaCard(page, n).locator("xpath=..");

test.describe("atomic item replacement", () => {
  test("database: while the replacement transaction is open readers see the complete OLD set; after commit the complete NEW set", async ({ page }) => {
    acceptDialogs(page);
    const { workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws);
    await createEvent(page, { name: "Atomic DB" });
    await placeOrder(page, {
      items: [{ name: "Classic Matcha" }, { name: "Matcha Cheesecake" }],
      name: "Atomic",
      pay: "Cash",
      declineCombo: true,
    });
    await expect.poll(() => sql(`select count(*)::int n from public.order_items where workspace_id='${ws}'`)[0].n).toBe(2);
    const [{ order_id }] = sql(`select order_id from public.order_items where workspace_id='${ws}' limit 1`);
    const names = () =>
      sql(`select menu_item_name_snap n from public.order_items where order_id='${order_id}' order by 1`).map((r) => r.n);
    expect(names()).toEqual(["Classic Matcha", "Matcha Cheesecake"]);

    // new set: just the cheesecake row (same id), applied in ONE transaction that stays open for 4s
    const sqlText = `
      begin;
      select public.replace_order_items(
        '${order_id}'::uuid, '${ws}'::uuid,
        (select jsonb_agg(to_jsonb(oi)) from public.order_items oi
          where oi.order_id = '${order_id}' and oi.menu_item_name_snap = 'Matcha Cheesecake'));
      select pg_sleep(4);
      commit;`;
    const writerProc = spawn("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-q"], { stdio: ["pipe", "ignore", "ignore"] });
    const finished = new Promise<void>((res) => writerProc.on("exit", () => res()));
    writerProc.stdin.end(sqlText);

    // sample from other connections while the transaction is open (it sleeps 4s)
    const seen: string[][] = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 2500) {
      seen.push(names());
      await new Promise((r) => setTimeout(r, 250));
    }
    await finished;
    const after = names();

    // every read taken mid-transaction was the full old set (never empty, never partial)
    expect(seen.length).toBeGreaterThan(3);
    for (const s of seen) expect(s).toEqual(["Classic Matcha", "Matcha Cheesecake"]);
    expect(after).toEqual(["Matcha Cheesecake"]);
  });

  test("two devices: device B never renders an empty or mixed order while A replaces its lines", async ({ page, newPage }) => {
    acceptDialogs(page);
    const { code, workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws);
    await createEvent(page, { name: "Atomic UI" });
    await placeOrder(page, {
      items: [{ name: "Classic Matcha" }, { name: "Matcha Cheesecake" }],
      name: "Flash",
      pay: "Cash",
      declineCombo: true,
    });

    const b = await newPage();
    acceptDialogs(b);
    await joinWorkspace(b, code);
    await goTab(b, "Barista Queue");
    await expect(orderCard(b, 1)).toContainText("Classic Matcha", { timeout: 15_000 });
    await expect(orderCard(b, 1)).toContainText("Matcha Cheesecake");

    // Record every distinct item list B ever renders. "C1K2" would be the old classic +
    // old cheesecake + a new cheesecake all on screen together (the reported flash).
    await b.evaluate(() => {
      const w = window as unknown as { __snaps: string[] };
      w.__snaps = [];
      // one order in this workspace, so the barista page's <main> text is the order's render
      const main = () => document.querySelector("main") as HTMLElement | null;
      const record = () => {
        const m = main();
        if (!m) return;
        const t = m.innerText;
        const n = (re: RegExp) => (t.match(re) ?? []).length;
        const has = "C" + n(/classic matcha/gi) + "K" + n(/matcha cheesecake/gi);
        if (w.__snaps[w.__snaps.length - 1] !== has) w.__snaps.push(has);
      };
      record();
      new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true });
    });

    // Slow every order_items INSERT on the LOCAL test database by 0.5s to widen any gap.
    exec(`create or replace function public.zz_slow_insert() returns trigger language plpgsql as $$ begin perform pg_sleep(0.5); return new; end $$;
          drop trigger if exists zz_slow on public.order_items;
          create trigger zz_slow before insert on public.order_items for each row execute function public.zz_slow_insert();`);
    try {
      // A REPLACES both lines: removes them and adds a fresh cheesecake. The new line has a
      // new id, so B must not show it next to the old rows.
      await goTab(page, "Barista Queue");
      await baristaCard(page, 1).getByTitle("Edit").click();
      const dlg = modal(page, /Edit order #1/);
      const row = (name: string) => dlg.locator("div.rounded-xl.p-2\\.5", { hasText: name });
      await row("Classic Matcha").getByRole("button", { name: "Fewer" }).click();
      await row("Matcha Cheesecake").getByRole("button", { name: "Fewer" }).click();
      await dlg.getByRole("button", { name: /Add item/ }).click();
      const add = modal(page, "Add item");
      await add.getByRole("button", { name: /Matcha Cheesecake/ }).click();
      await add.getByRole("button", { name: "Done" }).click();
      await dlg.getByRole("button", { name: "Save" }).click();
      await expect(dlg).toBeHidden();

      await expect.poll(() => sql(`select count(*)::int n from public.order_items where workspace_id='${ws}'`)[0].n).toBe(1);
      await expect(orderCard(b, 1)).not.toContainText("Classic Matcha", { timeout: 15_000 });
      await expect(orderCard(b, 1)).toContainText("Matcha Cheesecake");
      await b.waitForTimeout(7_000); // past a poll cycle, so a late resync cannot hide a flash
    } finally {
      exec(`drop trigger if exists zz_slow on public.order_items; drop function if exists public.zz_slow_insert();`);
    }
    const snaps = await b.evaluate(() => (window as unknown as { __snaps: string[] }).__snaps);
    expect(snaps).toEqual(["C1K1", "C0K1"]);
  });
});
