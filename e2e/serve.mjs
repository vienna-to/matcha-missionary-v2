// Builds (only when needed) and serves the app with Supabase env forced blank.
// The marker file records that the existing .next build was made by this script,
// so a stale build made with real env vars is never reused. E2E_REBUILD=1 forces.
import { spawnSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PORT = process.env.E2E_PORT ?? "3101";
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" };
const marker = ".next/.e2e-local-build";
const fresh = existsSync(".next/BUILD_ID") && existsSync(marker) && readFileSync(marker, "utf8") === "blank-env";
if (!fresh || process.env.E2E_REBUILD === "1") {
  const r = spawnSync("npx", ["next", "build"], { env, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
  writeFileSync(marker, "blank-env");
}
const srv = spawn("npx", ["next", "start", "-p", PORT, "-H", "127.0.0.1"], { env, stdio: "inherit", shell: true });
srv.on("exit", (c) => process.exit(c ?? 0));
