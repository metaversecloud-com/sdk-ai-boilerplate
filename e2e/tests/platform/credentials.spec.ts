// Shared by every SDK app: keep this file identical across repos. Routes and known bugs come from
// app.config.ts.
import type { APIResponse } from "@playwright/test";
import { CREDENTIALED_ROUTES } from "../../app.config";
import { expect, test, type TopiaWorld } from "../../fixtures";
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

    /**
     * Sends foreign credentials and runs `check` on the response, against a private instance for crashesServer
     * routes: an instance that went down counts as that bug, otherwise `bug` marks the test as usual.
     */
    const withForeignCredentials = async (
      { request, world }: { request: Parameters<typeof callRoute>[0]; world: TopiaWorld },
      bug: string | undefined,
      check: (response: APIResponse) => Promise<void>,
    ) => {
      await world.seed();
      const credentials = world.credentials({ interactivePublicKey: "someone-else" });
      if (!bugs.crashesServer) {
        test.fail(!!bug, bug);
        return check(await callRoute(request, route, credentials));
      }
      test.slow();
      const { result, error, alive } = await withPrivateServer(async (origin) => {
        const response = await callRoute(request, route, credentials, origin);
        await response.body();
        return response;
      });
      // Marked only now: an instance that didn't start must fail the test, not count as the known bug.
      const crashed = !alive || !!error;
      test.fail(crashed || !!bug, crashed ? bugs.crashesServer : bug);
      expect(alive, "the app process exited").toBe(true);
      expect(error).toBeUndefined();
      await check(result!);
    };

    test("rejects credentials signed for another app's public key", async ({ request, world }) => {
      await withForeignCredentials({ request, world }, bugs.acceptsForeignCredentials, async (response) => {
        expect(response.ok()).toBe(false);
        expect((await response.json()).success).toBe(false);
      });
    });

    test("names the credential problem instead of failing further down", async ({ request, world }) => {
      await withForeignCredentials({ request, world }, bugs.unnamedCredentialError, async (response) => {
        expect(JSON.stringify(await response.json())).toContain("public key does not match");
      });
    });
  });
}
