import { defineConfig, devices } from "@playwright/test";

const port = process.env.PORT || "3000";
const baseURL = process.env.UI_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: process.env.UI_URL ? undefined : {
    command: `node server.js`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
    env: {
      PORT: port,
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
