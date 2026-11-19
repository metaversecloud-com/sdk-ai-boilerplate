import type { Locator } from "@playwright/test";

/**
 * Clicks an element by dispatching the click event, without Playwright's visibility and size checks. For
 * icon-only buttons whose icon (an SDK-style CDN image, aborted in tests) leaves them 0x0. Prefer
 * test.use({ stubSdkIcons: true }) (fixtures.ts) so a real click works; use this when that isn't enough.
 */
export const press = (locator: Locator) => locator.dispatchEvent("click");
