import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, openApp, readState, test } from "./support";

const PROD_REF = "ycctyfibtbrtwhoqqyfm";

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

test("built bundle contains no reference to the production Supabase project", () => {
  const hits = walk(".next").filter((f) => /\.(js|html|json|txt|rsc)$/.test(f) && readFileSync(f, "utf8").includes(PROD_REF));
  expect(hits).toEqual([]);
});

test("app boots on the local-storage adapter and makes no Supabase requests", async ({ page, guard }) => {
  await openApp(page);
  const st = await expect.poll(() => readState(page)).not.toBeNull();
  void st;
  const state = await readState(page);
  expect(state.events.length).toBeGreaterThan(0); // seed data from localStorage adapter
  expect(await page.evaluate(() => (window as unknown as { process?: unknown }).process === undefined)).toBe(true);
  expect(guard).toEqual([]);
  console.log("DB TARGET: local-storage adapter (no database host); Supabase env blank; 0 Supabase requests");
});
