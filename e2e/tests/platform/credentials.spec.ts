// Shared by every SDK app: keep this file identical across repos. Routes come from app.config.ts.
import { CREDENTIALED_ROUTES } from "../../app.config";
import { expect, test } from "../../fixtures";

for (const route of CREDENTIALED_ROUTES) {
  test.describe(`${route.method.toUpperCase()} ${route.path}`, () => {
    test("rejects a request without session credentials", async ({ request, world }) => {
      await world.seed();

      const response = await request[route.method](`/api${route.path}`, { data: route.data });

      expect(response.ok()).toBe(false);
      expect((await response.json()).success).toBe(false);
    });

    test("rejects credentials signed for another app's public key", async ({ request, world }) => {
      await world.seed();

      const response = await request[route.method](world.api(route.path, { interactivePublicKey: "someone-else" }), {
        data: route.data,
      });

      expect(response.ok()).toBe(false);
      expect((await response.json()).success).toBe(false);
    });

    test("names the credential problem instead of failing further down", async ({ request, world }) => {
      // Known bug, tracked in EXP-428 (#6): getCredentials returns { error } instead of throwing, so the
      // request carries on with empty credentials and only fails on a later Topia call. Remove this
      // line together with the fix in server/utils/getCredentials.ts.
      test.fail(true, "EXP-428 #6: getCredentials doesn't throw");
      await world.seed();

      const response = await request[route.method](world.api(route.path, { interactivePublicKey: "someone-else" }), {
        data: route.data,
      });

      expect(JSON.stringify(await response.json())).toContain("public key does not match");
    });
  });
}
