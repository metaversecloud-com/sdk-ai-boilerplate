// Shared by every SDK app: keep this file identical across repos. Routes and known bugs come from
// app.config.ts.
import { CREDENTIALED_ROUTES } from "../../app.config";
import { expect, test } from "../../fixtures";
import { withPrivateServer } from "../../helpers/privateServer";
import { callRoute } from "./callRoute";

for (const route of CREDENTIALED_ROUTES) {
  const bugs = route.knownBugs ?? {};

  test.describe(`${route.method.toUpperCase()} ${route.basePath ?? "/api"}${route.path}`, () => {
    test("rejects a request without session credentials", async ({ request, world }) => {
      await world.seed();

      if (bugs.crashesServer) {
        // Against a private instance, so the crash can't take the shared server down.
        test.slow();
        const { result, error, alive } = await withPrivateServer((origin) =>
          callRoute(request, route, undefined, origin),
        );
        // Marked only now: an instance that didn't start must fail the test, not count as the known bug.
        test.fail(true, bugs.crashesServer);
        expect(alive, "the app process exited").toBe(true);
        expect(error).toBeUndefined();
        expect(result!.ok()).toBe(false);
        expect((await result!.json()).success).toBe(false);
        return;
      }

      test.fail(!!bugs.acceptsMissingCredentials, bugs.acceptsMissingCredentials);
      const response = await callRoute(request, route);

      expect(response.ok()).toBe(false);
      expect((await response.json()).success).toBe(false);
    });

    test("rejects credentials signed for another app's public key", async ({ request, world }) => {
      test.fail(!!bugs.acceptsForeignCredentials, bugs.acceptsForeignCredentials);
      await world.seed();

      const response = await callRoute(request, route, world.credentials({ interactivePublicKey: "someone-else" }));

      expect(response.ok()).toBe(false);
      expect((await response.json()).success).toBe(false);
    });

    test("names the credential problem instead of failing further down", async ({ request, world }) => {
      test.fail(!!bugs.unnamedCredentialError, bugs.unnamedCredentialError);
      await world.seed();

      const response = await callRoute(request, route, world.credentials({ interactivePublicKey: "someone-else" }));

      expect(JSON.stringify(await response.json())).toContain("public key does not match");
    });
  });
}
