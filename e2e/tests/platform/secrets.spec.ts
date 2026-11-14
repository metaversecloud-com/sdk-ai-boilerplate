// Shared by every SDK app: keep this file identical across repos. Routes and known bugs come from
// app.config.ts.
import { CREDENTIALED_ROUTES, ENTRY_PAGE, ENTRY_PAGE_KNOWN_BUGS } from "../../app.config";
import { INTERACTIVE_SECRET } from "../../constants";
import { expect, test } from "../../fixtures";

// SDK controller objects and SDK errors carry the interactive secret (topia.interactiveSecret,
// params.interactiveSecret) and a signed InteractiveJWT. Returning one from a route without
// stripping those fields hands them to every player. Tracked across apps in EXP-429.
const LEAK_MARKERS = [INTERACTIVE_SECRET, "interactiveSecret", "InteractiveJWT"];

for (const route of CREDENTIALED_ROUTES) {
  const leak = route.knownBugs?.leaksSecret;

  test(`${route.method.toUpperCase()} ${route.path} never returns the interactive secret or a signed JWT`, async ({
    request,
    world,
  }) => {
    test.fail(!!leak, leak);
    await world.seed({ isAdmin: true });

    const response = await request[route.method](world.api(route.path), { data: route.data });

    const body = await response.text();
    for (const marker of LEAK_MARKERS) expect(body, `response contains "${marker}"`).not.toContain(marker);
  });
}

test("loading the app never sends the interactive secret to the browser", async ({ page, world }) => {
  test.fail(!!ENTRY_PAGE_KNOWN_BUGS.leaksSecret, ENTRY_PAGE_KNOWN_BUGS.leaksSecret);
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
