// Shared by every SDK app: keep this file identical across repos. App-specific tests go in tests/app.
import * as config from "../../app.config";
import { INTERACTIVE_SECRET } from "../../constants";
import { expect, test } from "../../fixtures";
import { withPrivateServer } from "../../helpers/privateServer";

const { APP_SHELL_MARKER, ENTRY_PAGE } = config;
// Read through the namespace so an app.config.ts from before these settings existed still works.
const HEALTH_KNOWN_BUGS = config.HEALTH_KNOWN_BUGS ?? {};
const PROCESS_KNOWN_BUGS = config.PROCESS_KNOWN_BUGS ?? {};
const APP_SHELL_FALLBACK = config.APP_SHELL_FALLBACK ?? true;

test("health endpoint keeps the contract monitoring relies on", async ({ request }) => {
  test.fail(!!HEALTH_KNOWN_BUGS.incompleteContract, HEALTH_KNOWN_BUGS.incompleteContract);
  const response = await request.get("/api/system/health");

  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body).toMatchObject({
    status: "OK",
    appVersion: expect.any(String),
    serverStartDate: expect.any(String),
    envs: expect.objectContaining({
      COMMIT_HASH: expect.any(String),
      BUILD_TIME: expect.any(String),
      NODE_ENV: "test",
    }),
  });
});

test("health endpoint never returns the interactive secret", async ({ request }) => {
  const response = await request.get("/api/system/health");

  expect(await response.text()).not.toContain(INTERACTIVE_SECRET);
});

test("a promise rejection nobody handles doesn't take the server down", async () => {
  test.slow();

  const { alive } = await withPrivateServer(async () => {}, { unhandledRejection: true });

  // Marked only now: an instance that didn't start must fail the test, not count as the known bug.
  test.fail(!!PROCESS_KNOWN_BUGS.exitsOnUnhandledRejection, PROCESS_KNOWN_BUGS.exitsOnUnhandledRejection);
  expect(alive, "the app process exited").toBe(true);
});

test("unknown pages fall back to the app shell", async ({ request }) => {
  test.skip(ENTRY_PAGE === null, "the app has no page");
  test.skip(!APP_SHELL_FALLBACK, "the app answers unknown pages with a real 404 (APP_SHELL_FALLBACK = false)");
  const response = await request.get("/some/deep/link");

  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("text/html");
  expect(await response.text()).toContain(APP_SHELL_MARKER);
});
