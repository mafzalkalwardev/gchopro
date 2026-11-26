import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    ignoreHTTPSErrors: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/e2e-serve.mjs",
    url: "https://admin.localhost:3001/login",
    ignoreHTTPSErrors: true,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
