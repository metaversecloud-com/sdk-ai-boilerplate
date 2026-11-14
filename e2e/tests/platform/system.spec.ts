// Shared by every SDK app: keep this file identical across repos. App-specific tests go in tests/app.
import { INTERACTIVE_SECRET } from "../../constants";
import { expect, test } from "../../fixtures";

test("health endpoint keeps the contract monitoring relies on", async ({ request }) => {
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
  expect(JSON.stringify(body)).not.toContain(INTERACTIVE_SECRET);
});

test("unknown pages fall back to the app shell", async ({ request }) => {
  const response = await request.get("/some/deep/link");

  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("text/html");
  expect(await response.text()).toContain('id="root"');
});
