// Shared by every SDK app: keep this file identical across repos. Routes and known bugs come from
// app.config.ts.
import * as config from "../../app.config";
import { CREDENTIALED_ROUTES, ENTRY_PAGE, ENTRY_PAGE_KNOWN_BUGS } from "../../app.config";
import { APP_PORT, INTERACTIVE_SECRET } from "../../constants";
import { expect, test } from "../../fixtures";
import { callRoute } from "./callRoute";

// SDK controller objects and SDK errors carry the interactive secret (topia.interactiveSecret,
// params.interactiveSecret) and a signed InteractiveJWT. Returning one from a route without
// stripping those fields hands them to every player. Tracked across apps in EXP-429.
const LEAK_MARKERS = [INTERACTIVE_SECRET, "interactiveSecret", "InteractiveJWT"];
// Read through the namespace so an app.config.ts from before these settings existed still works.
const ENTRY_PAGE_SCAN = config.ENTRY_PAGE_SCAN ?? "api";
const ENTRY_PAGE_ACTION = config.ENTRY_PAGE_ACTION;
// getCredentials' error for credentials it didn't find ("Missing required parameters", or variants such as
// "Missing required body parameters" in apps that changed it).
const MISSING_CREDENTIALS = /missing required (\w+ )*parameters/i;

for (const route of CREDENTIALED_ROUTES) {
  // A route that never answers can't be scanned: answersNever marks the test (it fails on the timeout).
  const bug = route.knownBugs?.answersNever ?? route.knownBugs?.leaksSecret;

  test(`${route.method.toUpperCase()} ${route.basePath ?? "/api"}${route.path} never returns the interactive secret or a signed JWT`, async ({
    request,
    world,
  }) => {
    test.fail(!!bug, bug);
    await world.seed({ isAdmin: true });

    const response = await callRoute(request, route, world.credentials());

    const body = await response.text();
    // Credentials sent where the route doesn't read them (see credentialsIn) would make the scan vacuous.
    expect(body, "the route didn't get the credentials").not.toMatch(MISSING_CREDENTIALS);
    for (const marker of LEAK_MARKERS) expect(body, `response contains "${marker}"`).not.toContain(marker);
  });
}

test("loading the app never sends the interactive secret to the browser", async ({ page, world }) => {
  test.skip(ENTRY_PAGE === null, "the app has no page");
  test.fail(!!ENTRY_PAGE_KNOWN_BUGS.leaksSecret, ENTRY_PAGE_KNOWN_BUGS.leaksSecret);
  await world.seed({ isAdmin: true });
  // What the app sent the browser: /api responses ("api"), or every response from the app plus WebSocket
  // frames ("all", see ENTRY_PAGE_SCAN). Collected as promises: a body read after the test ends is lost.
  // Server-sent-event streams never end, so their bodies can't be read: they're left out.
  const bodies: Array<Promise<string>> = [];
  const fromApp = (url: string) => new URL(url).port === String(APP_PORT);
  page.on("response", (response) => {
    const scanned = ENTRY_PAGE_SCAN === "all" ? fromApp(response.url()) : response.url().includes("/api/");
    const stream = (response.headers()["content-type"] ?? "").includes("text/event-stream");
    if (scanned && !stream) bodies.push(response.text().catch(() => ""));
  });
  if (ENTRY_PAGE_SCAN === "all") {
    page.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => bodies.push(Promise.resolve(String(payload))));
    });
  }

  await page.goto(world.url(ENTRY_PAGE!));
  await ENTRY_PAGE_ACTION?.(page, world);
  await page.waitForLoadState("networkidle");

  const scanned = await Promise.all(bodies);
  if (ENTRY_PAGE_SCAN === "api") expect(scanned.length, "the page made no /api call (see ENTRY_PAGE_SCAN)").toBeGreaterThan(0);
  for (const body of scanned) {
    for (const marker of LEAK_MARKERS) expect(body, `a response to the page contains "${marker}"`).not.toContain(marker);
  }
});
