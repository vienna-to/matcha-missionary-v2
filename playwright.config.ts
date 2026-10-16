import { defineConfig } from "@playwright/test";

/**
 * QA harness. Everything runs against the app's built-in local-storage adapter:
 * the Supabase env vars are forced to empty strings for BOTH the build (they are
 * inlined at build time) and the server, so .env.local (which points at the
 * hosted project) can never be used. e2e/00-isolation.spec.ts proves it.
 */
const PORT = 3101;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "e2e/.results.json" }]],
  outputDir: "e2e/.artifacts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: "chrome", // system Chrome; no browser download needed
    viewport: { width: 1280, height: 900 },
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node e2e/serve.mjs",
    url: `http://127.0.0.1:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    },
  },
});
