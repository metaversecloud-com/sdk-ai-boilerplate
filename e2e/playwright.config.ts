import { defineConfig, devices } from "@playwright/test";
import { APP_IMAGE, appEnv } from "./appEnv";
import { APP_PORT, INTERACTIVE_KEY, MOCK_TOPIA_PORT } from "./constants";

// E2E_APP_IMAGE=<image> runs the app from a Docker image (what ships, e.g. to test a Node upgrade)
// instead of local Node. The real app (production build) talks to an in-memory fake of the Topia public
// API; its environment comes from appEnv.ts plus APP_ENV in app.config.ts.
const imageEnvFlags = Object.entries(appEnv(3000))
  // Single-quoted so JSON values survive the shell.
  .map(([key, value]) => `-e ${key}='${value}'`)
  .join(" ");

const appServer = APP_IMAGE
  ? {
      command: `docker run --rm --init --name sdk-app-e2e --add-host=host.docker.internal:host-gateway -p ${APP_PORT}:3000 ${imageEnvFlags} ${APP_IMAGE}`,
      // Never reuse a server already on the port: it wouldn't be the image under test.
      reuseExistingServer: false,
    }
  : {
      command: "npm run build --prefix .. && npm start --prefix ..",
      env: appEnv(APP_PORT),
      reuseExistingServer: !process.env.CI,
    };

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The app runs in UTC (TZ in appEnv.ts, and the image), so the browser does too: dates render the same on
    // every machine. A test can still pick another zone on purpose with test.use({ timezoneId }).
    timezoneId: "UTC",
  },
  // Topia opens apps in a drawer about 400px wide, so pages render at that width. Unstyled pages (CDN
  // stylesheets are aborted, see fixtures.ts) would otherwise sprawl and overlap at desktop width. A page
  // opened as a full-screen modal can take test.use({ viewport: { width: 1280, height: 720 } }).
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 400, height: 900 } } }],
  webServer: [
    {
      command: "node mock-topia/server.mjs",
      url: `http://localhost:${MOCK_TOPIA_PORT}/__mock/health`,
      env: { MOCK_TOPIA_PORT: String(MOCK_TOPIA_PORT), INTERACTIVE_KEY },
      reuseExistingServer: !process.env.CI,
    },
    {
      ...appServer,
      url: `http://localhost:${APP_PORT}/api/system/health`,
      timeout: 180_000,
    },
  ],
});
