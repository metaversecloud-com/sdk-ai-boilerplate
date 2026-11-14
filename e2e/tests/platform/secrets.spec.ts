// Shared by every SDK app: keep this file identical across repos. Routes come from app.config.ts.
import { CREDENTIALED_ROUTES, ENTRY_PAGE } from "../../app.config";
import { INTERACTIVE_SECRET } from "../../constants";
import { expect, test } from "../../fixtures";

// SDK controller objects carry the Topia client (with interactiveSecret) and a signed InteractiveJWT.
// Returning one from a route without stripping those fields hands them to every player.
const LEAK_MARKERS = [INTERACTIVE_SECRET, "interactiveSecret", "InteractiveJWT"];

// Known bug in the boilerplate (see e2e/README.md, "Known bugs"): server/index.ts registers the
// cleanReturnPayload scrubber after the API routes, so it never runs and /api/game-state returns the
// raw DroppedAsset, secret included. Apps that don't leak must delete this line (the test then
// fails with "expected to fail but passed" until they do).
const KNOWN_LEAK = "cleanReturnPayload is registered after the routes (server/index.ts)";

for (const route of CREDENTIALED_ROUTES) {
  test(`${route.method.toUpperCase()} ${route.path} never returns the interactive secret or a signed JWT`, async ({
    request,
    world,
  }) => {
    test.fail(true, KNOWN_LEAK);
    await world.seed({ isAdmin: true });

    const response = await request[route.method](world.api(route.path), { data: route.data });

    const body = await response.text();
    for (const marker of LEAK_MARKERS) expect(body, `response contains "${marker}"`).not.toContain(marker);
  });
}

test("loading the app never sends the interactive secret to the browser", async ({ page, world }) => {
  test.fail(true, KNOWN_LEAK);
  await world.seed({ isAdmin: true });
  const bodies: string[] = [];
  page.on("response", async (response) => {
    if (response.url().includes("/api/")) bodies.push(await response.text().catch(() => ""));
  });

  await page.goto(world.url(ENTRY_PAGE));
  await page.waitForLoadState("networkidle");

  expect(bodies.length).toBeGreaterThan(0);
  for (const body of bodies) {
    for (const marker of LEAK_MARKERS) expect(body, `an /api response contains "${marker}"`).not.toContain(marker);
  }
});
