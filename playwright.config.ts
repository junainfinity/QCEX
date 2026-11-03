import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  reporter: [
    ["list"],
    ["json", { outputFile: "artifacts/playwright-results.json" }],
  ],
  use: {
    baseURL: process.env.TEST_URL || "http://127.0.0.1:3100",
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
