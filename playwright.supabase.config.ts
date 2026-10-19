import { defineConfig } from "@playwright/test";

/**
 * Supabase-mode harness. Same app, built against a LOCAL Supabase started with
 * `supabase start` (API on 127.0.0.1:54321). e2e/serve-supabase.mjs refuses any
 * non-local URL, and e2e/supabase/sb.ts aborts any request to a hosted Supabase
 * host and fails the test if one was attempted.
 *
 *   E2E_SB_ANON=<local anon key> npx playwright test -c playwright.supabase.config.ts
 */
const PORT = 3102;

export default defineConfig({
  testDir: "./e2e/supabase",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "e2e/.sb-results.json" }]],
  outputDir: "e2e/.sb-artifacts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: "chrome",
    viewport: { width: 1280, height: 900 },
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node e2e/serve-supabase.mjs",
    url: `http://127.0.0.1:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
