// Tests for the boilerplate's example page. Each app replaces this folder with tests for its own
// pages and rules (see sdk-quiz/e2e/tests for a full example).
import { KEY_ASSET_ID, expect, test } from "../../fixtures";

test("shows the dropped asset the app was opened from", async ({ page, world }) => {
  await world.seed();
  await page.goto(world.url("/"));

  await expect(page.getByRole("heading", { name: "Server side example using interactive parameters" })).toBeVisible();
  await expect(page.getByText("You have successfully retrieved the dropped asset details for E2E Asset!")).toBeVisible();
  await expect(page.getByRole("img", { name: "preview" })).toHaveAttribute("src", "https://example.invalid/e2e-asset.png");
});

test("initializes the asset's data object and records the visit", async ({ page, world }) => {
  await world.seed();
  await page.goto(world.url("/"));
  await expect(page.getByText(/successfully retrieved/)).toBeVisible();

  expect(await world.assetData(KEY_ASSET_ID)).toEqual({ leaderboard: {} });
  expect(Object.values(await world.visitorData())).toContainEqual({ dateStarted: expect.any(Number) });
  expect(await world.events("world-toast")).toContainEqual(expect.objectContaining({ title: "Nice Work!" }));
  expect(await world.events("leaderboard-stats")).toContainEqual(
    expect.objectContaining({ profileId: world.profileId, incrementBy: 1, hasSecret: true }),
  );
});

test("asks to open the app inside a Topia world when credentials are missing", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Missing Interactive Parameters" })).toBeVisible();
});

test("only admins see the settings button", async ({ page, world }) => {
  await world.seed({ isAdmin: false });
  await page.goto(world.url("/"));
  await expect(page.getByText(/successfully retrieved/)).toBeVisible();
  await expect(page.locator("button.icon-with-rounded-border")).toHaveCount(0);

  await world.seed({ isAdmin: true });
  await page.reload();
  await expect(page.locator("button.icon-with-rounded-border")).toBeVisible();
});

test("shows an error when the asset can't be loaded", async ({ page, world }) => {
  await world.seed({ withAsset: false });
  await page.goto(world.url("/"));

  await expect(page.locator(".text-error")).toContainText("Error");
});
