// Shared by every SDK app: keep this file identical across repos. App-specific tests go in tests/app.
import * as config from "../../app.config";
import { HEALTH_PATH } from "../../appEnv";
import { INTERACTIVE_SECRET } from "../../constants";
import { expect, test } from "../../fixtures";
import { withPrivateServer } from "../../helpers/privateServer";

const { APP_SHELL_MARKER, CREDENTIALED_ROUTES, ENTRY_PAGE } = config;
// Read through the namespace so an app.config.ts from before these settings existed still works.
const HEALTH_KNOWN_BUGS = config.HEALTH_KNOWN_BUGS ?? {};
const PROCESS_KNOWN_BUGS = config.PROCESS_KNOWN_BUGS ?? {};
const APP_SHELL_FALLBACK = config.APP_SHELL_FALLBACK ?? true;
const ERROR_KNOWN_BUGS: { malformedJson?: string } = config.ERROR_KNOWN_BUGS ?? {};
const ENTRY_PAGE_KNOWN_BUGS: { callsOtherOrigin?: string } = config.ENTRY_PAGE_KNOWN_BUGS ?? {};
const ENTRY_PAGE_SCAN = config.ENTRY_PAGE_SCAN ?? "api";
const ENTRY_PAGE_ACTION = config.ENTRY_PAGE_ACTION;
// The first route that takes a JSON body, else a path only an app-wide express.json() parses.
const bodyRoute = CREDENTIALED_ROUTES.find((r) => r.method === "post" || r.method === "put");
const MALFORMED_JSON_REQUEST =
  config.MALFORMED_JSON_REQUEST !== undefined
    ? config.MALFORMED_JSON_REQUEST
    : bodyRoute
      ? { method: bodyRoute.method as "post" | "put", path: `${bodyRoute.basePath ?? "/api"}${bodyRoute.path}` }
      : { method: "post" as const, path: "/api/e2e-malformed-json" };
// A stack frame ("at fn (/app/server/x.js:1:2)", "at /app/x.js:1:2", "at file:///...") or a server file path.
const STACK_OR_PATH = /\bat (?:\S+ )?\(?(?:\/|file:|[A-Za-z]:\\)|node_modules|\.[cm]?[jt]s:\d+:\d+/;

test("health endpoint keeps the contract monitoring relies on", async ({ request }) => {
  test.fail(!!HEALTH_KNOWN_BUGS.incompleteContract, HEALTH_KNOWN_BUGS.incompleteContract);
  const response = await request.get(HEALTH_PATH);

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
  const response = await request.get(HEALTH_PATH);

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

test("a malformed JSON body gets a 400 without a stack trace or server paths", async ({ request }) => {
  test.skip(MALFORMED_JSON_REQUEST === null, "the app parses no JSON bodies (MALFORMED_JSON_REQUEST = null)");
  test.fail(!!ERROR_KNOWN_BUGS.malformedJson, ERROR_KNOWN_BUGS.malformedJson);
  const { method, path } = MALFORMED_JSON_REQUEST!;

  const response = await request[method](path, { headers: { "content-type": "application/json" }, data: '{"oops": ' });

  const body = await response.text();
  // A 404 means no JSON parser saw the body: point MALFORMED_JSON_REQUEST at a route that parses one.
  expect(response.status(), `${method.toUpperCase()} ${path} answered ${response.status()}`).toBe(400);
  expect(body, "the error body shows a stack trace or server file paths").not.toMatch(STACK_OR_PATH);
  expect(body, "the error body is Express' default HTML error page").not.toContain("<pre>");
});

test("the page calls its own server, not a hardcoded origin", async ({ page, world, baseURL }) => {
  test.skip(ENTRY_PAGE === null, "the app has no page");
  test.fail(!!ENTRY_PAGE_KNOWN_BUGS.callsOtherOrigin, ENTRY_PAGE_KNOWN_BUGS.callsOtherOrigin);
  await world.seed({ isAdmin: true });
  // Anything aimed at /api or at localhost (sockets included) must go to the origin the page came from.
  // Other hosts (CDNs) are aborted by fixtures.ts and left alone here.
  const own = new URL(baseURL!).host;
  const elsewhere: string[] = [];
  let ownApiCalls = 0;
  const check = (method: string, raw: string) => {
    const url = new URL(raw);
    if (!/^(https?|wss?):$/.test(url.protocol)) return;
    const api = url.pathname === "/api" || url.pathname.startsWith("/api/");
    if (url.host === own) ownApiCalls += api ? 1 : 0;
    else if (api || ["localhost", "127.0.0.1"].includes(url.hostname)) elsewhere.push(`${method} ${url.origin}${url.pathname}`);
  };
  page.on("request", (r) => check(r.method(), r.url()));
  page.on("websocket", (socket) => check("WS", socket.url()));

  await page.goto(world.url(ENTRY_PAGE!));
  await ENTRY_PAGE_ACTION?.(page, world);
  await page.waitForLoadState("networkidle");

  expect(elsewhere, "requests to another origin (a hardcoded API base such as http://localhost:3000?)").toEqual([]);
  if (ENTRY_PAGE_SCAN === "api") expect(ownApiCalls, "the page made no /api call to its own server").toBeGreaterThan(0);
});
