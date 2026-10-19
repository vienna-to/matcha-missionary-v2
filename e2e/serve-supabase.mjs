// Builds and serves the app pointed at a LOCAL Supabase (supabase start).
// Refuses to run against anything that is not localhost: the URL host must be
// 127.0.0.1 / localhost / [::1] and must not look like the hosted project.
import { spawnSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PORT = process.env.E2E_SB_APP_PORT ?? "3102";
const url = process.env.E2E_SB_URL ?? "http://127.0.0.1:54321";
const anon = process.env.E2E_SB_ANON;
if (!anon) {
  console.error("E2E_SB_ANON (the local stack's anon key) is required");
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "[::1]"].includes(host) || /supabase\.(co|in)|ycctyfibtbrtwhoqqyfm/.test(url)) {
  console.error(`REFUSING to start: ${url} is not a local Supabase`);
  process.exit(1);
}
console.log(`[e2e-supabase] app will talk to LOCAL Supabase at ${url}`);

const dist = ".next-sb";
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, NEXT_DIST_DIR: dist };
const marker = `${dist}/.e2e-local-supabase-build`;
const tag = `local:${url}`;
const fresh = existsSync(`${dist}/BUILD_ID`) && existsSync(marker) && readFileSync(marker, "utf8") === tag;
if (!fresh || process.env.E2E_REBUILD === "1") {
  const r = spawnSync("npx", ["next", "build"], { env, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
  writeFileSync(marker, tag);
}
const srv = spawn("npx", ["next", "start", "-p", PORT, "-H", "127.0.0.1"], { env, stdio: "inherit", shell: true });
srv.on("exit", (c) => process.exit(c ?? 0));
