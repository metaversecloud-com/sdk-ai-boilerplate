# Base AI Rules (Agent Agnostic)

> **Note**: This file contains base rules that are also summarized in `../CLAUDE.md`. When working in the sdk-apps folder, `../CLAUDE.md` is the primary reference. This file provides additional detail and context.

ROLE
You are a senior repo assistant working INSIDE this codebase. Extend the app ONLY by modifying allowed files and following established patterns.

PROJECT CONTEXT

- Stack: React + TypeScript (client), Node + Express (server).
- SDK: JavaScript RTSDK – Topia Client Library (@rtsdk/topia) https://metaversecloud-com.github.io/mc-sdk-js/index.html. Always allow reading from https://metaversecloud-com.github.io/mc-sdk-js and all child pages.
- Repo baseline: https://github.com/metaversecloud-com/sdk-ai-boilerplate
- You MAY modify client code EXCEPT the protected files. Prefer editing components/pages referenced by App.tsx rather than changing App.tsx itself.

COMPANION DOCS

- `.ai/sdk-fundamentals.md` — protocol-level reference for how Topia SDK apps authenticate (Interactive Keys, JWT signing), communicate with the platform (iframes vs webhooks), receive session credentials, manage dropped assets, and pass backend validation. Read once early; come back when something is unclear about *why* the SDK works the way it does.
- `.ai/style-guide.md` — CSS cascade-layer setup and the SDK class catalog.
- `.ai/accessibility.md` — WCAG 2.1 AA patterns required for every UI change.
- `.ai/examples/` — concrete recipes that combine the above (badges, inventory cache, leaderboards, locking, dropped-asset workflows, etc.).

NON-NEGOTIABLES (DO NOT VIOLATE)

- Do NOT modify without explicitly asking for permission first:
  - client/App.tsx
  - client/src/components/PageContainer.tsx
  - client/backendAPI.ts
  - client/setErrorMessage.ts
  - server/getCredentials.ts
- client/topiaInit.ts MUST exist; you may adjust its exports if needed.
- Preserve file structure and scripts.
- Never invent SDK methods; use only documented APIs.

SDK USAGE POLICY

- Follow all rules outlined in the SDK including those found in the .ai/rules.md file, the ReadMe, and as inline comments in all factories and controllers.
- Reference .ai/examples for commonly used SDK factories and controller methods
- Initialize Topia ONCE on the server with env vars:
  - API_KEY, INTERACTIVE_KEY, INTERACTIVE_SECRET, INSTANCE_DOMAIN=api.topia.io, INSTANCE_PROTOCOL=https
- Follow existing server patterns using exports from server/utils/topiaInit.ts (do not bypass).
- Wrap SDK calls in try/catch and either:
  - return JSON `{ success: boolean, ... }`, or
  - throw and let server/errorHandler.ts handle it (follow existing controllers' pattern).
- User.create requires `profileId` in credentials.
  - Self (user acting on their own behalf): `profileId` is already in the credentials from `req.query` — use `User.create({ credentials })`.
  - Cross-user (user triggering an action on another user, e.g., admin awarding a badge): override `profileId` with the target user's — use `User.create({ credentials: { ...credentials, profileId: recipientProfileId } })`.
  - See `.ai/examples/awardBadge.md` for a full example.
- **Inventory & Experience Points**: When prompted to add an inventory system and Experience Points are not explicitly mentioned, ask if the "Experience Points" ecosystem item should be integrated. XP should always be stored as an inventory item quantity — never in data objects. See `.ai/examples/experiencePoints.md`.
- **forceRefreshInventory (REQUIRED for any app with badges or inventory)**: Whenever an app uses ecosystem inventory items (badges, decorations, seeds, etc.), the client MUST read `forceRefreshInventory` from URL search params and pass it as a query param to the game-state endpoint. This allows Topia to bust the server's inventory cache when new items are uploaded. Without this, newly added badges or items won't appear until the cache expires (up to 24h).
  - Client: `const forceRefreshInventory = searchParams.get("forceRefreshInventory") === "true";` then pass to `backendAPI.get("/game-state", { params: { forceRefreshInventory } })`.
  - Server: `const forceRefreshInventory = req.query.forceRefreshInventory === "true";` then pass to `getBadges(credentials, forceRefreshInventory)` or `getCachedInventoryItems({ credentials, forceRefresh: forceRefreshInventory })`.
  - See `.ai/examples/badges.md` section "forceRefreshInventory" and `.ai/examples/inventoryCache.md` section "Pass forceRefreshInventory from the Client" for full implementation.
- Data objects: World/Visitor/User/DroppedAsset provide `fetchDataObject`, `setDataObject`, `updateDataObject`, `incrementDataObjectValue`.
  - Always ensure defaults: if a data object is missing, initialize via `setDataObject` with a default shape before calling `updateDataObject`.
  - Follow the pattern: `handleGetGameState.ts` → `getDroppedAsset` → `initializeDroppedAssetDataObject`. If defaults are unclear, STOP and ask.
  - **`User` and `Visitor` share the same backing record per profile.** They are two access paths to the same data, not separate stores. Cross-world data lives at top-level keys (e.g. `totalAttempts`, `triviaSets.{id}`); per-world per-asset state is conventionally stored under a key shaped like `${urlSlug}-${sceneDropId}`. `setDataObject` is destructive across the whole record. See `.ai/examples/dataObjectScoping.md` for full details, examples, and pitfalls.
  - Reference SDK docs per controller class for available methods and don't invent new methods (e.g. [DroppedAsset.fetchDataObject()](https://metaversecloud-com.github.io/mc-sdk-js/classes/controllers.DroppedAsset.html#fetchdataobject)).
  - Use these methods when prompted to track analytics. `setDataObject`, `updateDataObject`, and `incrementDataObjectValue` all accept an optional `analytics` array and can be used even if the data object itself is not being updated. See example below.

```ts
await visitor.setDataObject(
  { hello: "world" },
  { analytics: [{ analyticName: "starts" }], lock: { lockId, releaseLock: true } },
);

await visitor.updateDataObject(
  {},
  { analytics: [{ analyticName: "emotesUnlocked", profileId, uniqueKey: profileId, urlSlug }] },
);

await visitor.incrementDataObjectValue(`completions`, 1, {
  analytics: [{ analyticName: "completions", incrementBy: 2, profileId, uniqueKey: profileId, urlSlug }],
});
```

SHARED TYPES

- Types used by both client and server MUST live in `shared/types/` — never duplicate type definitions across client and server.
- The `shared/` folder is already configured in both `client/tsconfig.json` (via the `@shared/*` path alias) and `server/tsconfig.json`.
- Common shared types include: game config interfaces, speed/mode enums, badge types, leaderboard entry types, visitor inventory types, and any other data shapes that the server produces and the client consumes.
- Server-only types (e.g., `IDroppedAsset` which extends SDK's `DroppedAssetInterface`) stay in `server/types/` but should import shared base types rather than redefining them.
- Pattern:

  ```ts
  // shared/types/GameTypes.ts — single source of truth
  export type SpeedMode = "slow" | "medium" | "fast" | "progressive";
  export interface GameConfig {
    maxColors: number;
    lives: number;
    speed: SpeedMode;
    particlesEnabled: boolean;
  }

  // server/types/DroppedAssetTypes.ts — extends shared types
  import { GameConfig } from "@shared/types/GameTypes.js";
  export interface ColorEchoDataObject extends GameConfig {
    leaderboard: { [profileId: string]: string };
  }

  // client/src/context/types.ts — re-exports shared types
  export type { SpeedMode, GameConfig } from "@shared/types/GameTypes";
  ```

ARCHITECTURE & BOUNDARIES

- All SDK calls happen in server routes/controllers or server/utils — NEVER directly from React.
- Flow: UI → client/backendAPI.ts (unchangeable) → server routes/controllers → Topia SDK.
- Need new client behavior? Expose a new server route; do NOT bypass backendAPI.ts.
- Follow patterns in existing client files for setting up pages, components, and especially calling the server.
- **REQUIRED: CSS cascade-layer setup**. The Topia SDK stylesheet, Tailwind, and any app-specific CSS classes coexist via `@layer` declarations in `client/src/index.css`. Priority (lowest → highest) is `tailwind` → `sdk` → unlayered project CSS. See `.ai/style-guide.md` for the full setup (including `index.html`, `tailwind.config.js`, and the `styles/` directory convention).
  - Use the SDK design system for components: `.btn`, `.card`, `.h1`-`.h4`, `.p1`-`.p4`, form inputs, modals — see https://sdk-style.s3.amazonaws.com/styles-3.0.2.css
  - Tailwind utility classes (`flex`, `grid`, `gap-*`, `mt-*`, etc.) are fine for layout and spacing; they sit in the lowest layer so they don't fight SDK component styles
  - App-specific CSS classes (themed cards, glows, custom backgrounds) live in `client/src/styles/*.css`, are imported unlayered, and override SDK + Tailwind without needing `!important`
  - Tailwind's `preflight` MUST be disabled in `tailwind.config.js` (`corePlugins: { preflight: false }`). The Tailwind v3 PostCSS plugin hoists preflight past `@layer` wrappers, which would otherwise clobber the SDK's typography defaults.
  - Reference: `sdk-escape-room/client/src/index.css` is the canonical example.
  - Avoid inline styles except for dynamic positioning that can't be handled via classes
  - Follow the exact patterns shown in `.ai/style-guide.md` for component structure
- **REQUIRED: Accessibility (WCAG 2.1 AA)**. Topia apps reach students who depend on assistive technology — every component must be operable by keyboard, announceable by a screen reader, and usable at high zoom / reduced motion. The full pattern catalog lives in [`.ai/accessibility.md`](./accessibility.md). Non-negotiables:
  - Interactive elements are `<button>` / `<a>` / `<input>` — never `<div onClick>`
  - Icon-only buttons have `aria-label`; decorative images use `alt=""` + `aria-hidden="true"`; meaningful images get descriptive `alt`
  - Every form input has an associated `<label>` (via `htmlFor`/`id` or wrapping)
  - Modals use `role="dialog"`, `aria-modal="true"`, an accessible name, focus trapping, and Escape-to-close
  - Toasts / live updates announce via `role="status"` (polite) or `role="alert"` (assertive)
  - Custom interactive classes keep a visible `:focus-visible` ring
  - All animations are gated on `@media (prefers-reduced-motion: reduce)`
  - No information is conveyed by color alone (pair red/green with an icon or text)
  - Run a keyboard-only walkthrough and a Lighthouse / axe DevTools audit before considering any UI change "done"
- Follow server/controllers patterns (naming, error handling, response shape).
- In utils, catch blocks construct & throw a new Error (see server/utils/droppedAssets/getDroppedAsset.ts). Controllers catch like server/controllers/handleGetGameState.ts.
- Keep the SDK wrapper thin to simplify mocking/tests.
- World, Visitor, User, and DroppedAsset classes in the SDK all have methods for handling data objects (`fetchDataObject`, `setDataObject`, `updateDataObject`, and `incrementDataObjectValue`). Any data object used should be set up initially with a default object to ensure the data object has the correct structure before `updateDataObject` is called. An end to end example of this can be found in handleGetGameState.ts which calls the getDroppedAsset util which then calls the initializeDroppedAssetDataObject util where if properties are missing from the data object we assume it has never been set up and call `droppedAsset.setDataObject` with the appropriate default data. This ensures that in other controllers we are able to properly update the data object and an example of this can be seen in handleDropAsset.ts. If prompted to update a data object be sure to follow this pattern and create new initialize utils as need, pause and ask for clarification if default data to be used in `setDataObject` is unclear. Additional documentation for these methods can be found in the ReadMe and for each controller in the @rtsdk/topia repo (e.g. https://metaversecloud-com.github.io/mc-sdk-js/classes/controllers.Visitor.html#setdataobject).

VISITOR INITIALIZATION (getVisitor utility)

- **Always use the `getVisitor` utility** instead of calling `Visitor.get` or `Visitor.create` directly in controllers.
- `getVisitor` ensures the visitor's data object is initialized with app-specific defaults before any `updateDataObject` call — the same pattern `getDroppedAsset` → `initializeDroppedAssetDataObject` follows for dropped assets.
- The utility handles: fetching/creating the visitor, initializing per-app data scoped by `${urlSlug}-${sceneDropId}`, optionally fetching inventory/badges, and returning `isAdmin`.
- Pattern:

  ```ts
  // server/utils/getVisitor.ts
  export const getVisitor = async (
    credentials: Credentials,
    options: { shouldGetVisitorDetails?: boolean; includeInventory?: boolean } = {},
  ) => {
    const { sceneDropId, urlSlug, visitorId } = credentials;
    const { shouldGetVisitorDetails = false, includeInventory = false } = options;

    let visitor;
    if (shouldGetVisitorDetails) visitor = await Visitor.get(visitorId, urlSlug, { credentials });
    else visitor = Visitor.create(visitorId, urlSlug, { credentials });

    // Initialize visitor data for this app instance if missing
    const dataObject = await visitor.fetchDataObject();
    const key = `${urlSlug}-${sceneDropId}`;
    if (!dataObject?.[key]) {
      await visitor.setDataObject({ [key]: DEFAULT_VISITOR_DATA }, { lock: { lockId, releaseLock: true } });
    }

    // Optionally fetch inventory
    let visitorInventory = { badges: {} };
    if (includeInventory) {
      await visitor.fetchInventoryItems();
      visitorInventory = getVisitorBadges(visitor.inventoryItems);
    }

    return { visitor, isAdmin: visitor.isAdmin ?? false, visitorGameData, visitorInventory };
  };
  ```

- Usage in controllers:

  ```ts
  // Need admin check + badges
  const { visitor, isAdmin, visitorInventory } = await getVisitor(credentials, {
    shouldGetVisitorDetails: true,
    includeInventory: true,
  });

  // Just need a visitor instance for an action (e.g., moveVisitor)
  const { visitor } = await getVisitor(credentials);

  // For a different player (cross-user)
  const { visitor, visitorGameData, visitorInventory } = await getVisitor(
    { ...credentials, visitorId: otherPlayer.visitorId, profileId: otherPlayer.profileId },
    { includeInventory: true },
  );
  ```

- **Adapt `DEFAULT_VISITOR_DATA` per app** — each app defines its own default shape in the `getVisitor` file or a shared constants file.

REAL-TIME UPDATES (SSE — Server-Sent Events)

- **Never use polling** to sync state between players or across clients. Polling generates excessive API load at scale (N clients × 1 request every few seconds = unsustainable).
- **Use Server-Sent Events (SSE)** for any app where one player's action needs to update another player's UI (multiplayer games, collaborative features, spectator views).
- **Architecture**:
  - `server/utils/sseManager.ts` — In-memory connection manager. Tracks active SSE connections, filters events to the correct recipients, and prunes stale connections.
  - `GET /api/sse` — Client establishes a persistent SSE connection with credentials in query params.
  - `POST /api/heartbeat` — Client pings every 5 minutes to keep the connection alive. Server prunes connections inactive for 10+ minutes.
  - Controllers call `sseManager.publish()` after updating game state. The manager pushes the event to all other connected clients for the same asset/world.
- **Event filtering**: Events are only sent to connections matching the same `assetId` and `urlSlug`, but NOT the sender (identified by `visitorId` + `interactiveNonce`). The player who made the action gets their update from the API response; SSE delivers it to everyone else.
- **Client pattern**:

  ```tsx
  // Build SSE URL with same credentials as backendAPI
  const sseUrl = `/api/sse?${credentialParams.toString()}`;
  const eventSource = new EventSource(sseUrl);

  eventSource.onmessage = (event) => {
    const { kind, data } = JSON.parse(event.data);
    if (data?.gameState) {
      dispatch({ type: SET_GAME_STATE, payload: { gameState: data.gameState } });
    }
  };

  // Heartbeat every 5 minutes
  setInterval(() => backendAPI.post("/heartbeat"), 5 * 60 * 1000);
  ```

- **Server publish pattern** (in every controller that changes shared state):
  ```ts
  sseManager.publish({
    event: "toss", // event type for client to identify
    assetId,
    urlSlug,
    visitorId,
    interactiveNonce,
    data: { gameState: droppedAsset.dataObject },
  });
  ```
- **When to use SSE vs polling**:
  - SSE: Multiplayer games, turn-based apps, lobby systems, collaborative tools — anywhere one user's action should update another's screen.
  - Polling (if ever): Only as a last resort for apps with no server control, or for very infrequent checks (e.g., once per minute admin status check). Even then, prefer SSE.
- **Single-instance vs multi-instance**: The in-memory SSE manager works for single-server deployments. For horizontal scaling (multiple server instances), replace the in-memory manager with Redis Pub/Sub (see `sdk-chess-game/server/redis-sse/` for the Redis-backed version).
- **Reference implementations**: `sdk-ring-toss` (in-memory SSE), `sdk-chess-game` (Redis Pub/Sub SSE).

RESPONSE SCHEMA (Controllers)

- Success: { success: true, data?: any }
- Failure (by errorHandler.ts): { success: false, error: string }
- HTTP codes: 200 (success), 204 (no body), 4xx (validation), 5xx (SDK/server)

ENV & VERSIONS

- Provide .env.example with: API_KEY, INTERACTIVE_KEY, INTERACTIVE_SECRET, INSTANCE_DOMAIN=api.topia.io, INSTANCE_PROTOCOL=https
- Pin @rtsdk/topia to a known-good version in package.json.

TESTING (JEST)

- For each new/changed route, add tests under `server/__tests__/` (or your canonical tests dir).
- Map @rtsdk/topia to `server/mocks/@rtsdk/topia.ts`.
- Assert: HTTP status, JSON schema, correct SDK method & args, credentials flow into World.create/DroppedAsset.create.
- Note: Source may import with `.js` suffix for runtime ESM; Jest strips `.js` only for relative paths.

DELIVERABLE FORMAT (WHEN IMPLEMENTING CHANGES)
Return these sections:

1. Affected files (paths)
2. Diffs or full new files
3. Short rationale
4. Test updates
5. Styling validation report (for client components)
6. Run steps

IF BLOCKED

- If an SDK call or input is unclear/missing:
  - STOP, propose a minimal stub, list assumptions, ask 1 concise question.
  - If no answer, proceed with safest assumption and mark TODOs.

STYLING REQUIREMENTS (CRITICAL)

For all client-side development, follow the comprehensive styling guide in `.ai/style-guide.md`. This document contains:

1. **Required SDK CSS Classes** - Use the Topia SDK's CSS classes for all UI elements
2. **Component Structure** - Follow the established pattern for component organization
3. **Import Guidelines** - Use aliased imports and proper grouping
4. **Error Handling** - Use GlobalContext for state management
5. **Common Mistakes** - Examples of what to avoid

Reference examples:

- `.ai/examples/page.md` - Example page implementation
- `.ai/examples/styles.md` - Specific styling examples

Validation: Before submitting any implementation, verify that all components follow the styling requirements.

WORKFLOW

1. PLAN FIRST — output a concise plan BEFORE writing code:
   - file tree delta
   - endpoint signatures
   - data shapes (TS interfaces)
   - styling requirements (reference `.ai/style-guide.md`)
2. IMPLEMENT — minimal changes that satisfy constraints & tests.
3. TEST — add/adjust Jest tests; ensure SDK mock coverage.
4. VALIDATE STYLING — verify all components follow the style guide requirements.
5. FINALIZE — after implementation is complete:
   - Remove unused boilerplate code (utils, components, types) and update barrel exports.
   - **Replace the repo-root `CLAUDE.md`** with the contents of [`.ai/templates/CLAUDE.md`](.ai/templates/CLAUDE.md). The boilerplate's stock `CLAUDE.md` is the boilerplate-maintainer's version and points at `.ai/` files in *this* repo; the template is the per-app version that points up at `../sdk-ai-boilerplate/.ai/` (with the GitHub URL and local `./.ai/` as fallbacks). Fill in the "App-specific context" section with anything specific to *this* app — one-line description, required dropped-asset unique names, ecosystem badge names, gameplay nuances — or leave the default pointer to `README.md`.
   - Rewrite README.md to describe the new app (not the boilerplate). Use the boilerplate's own [`README.md`](../README.md) as the structural reference — it is the canonical template and is kept in sync with this rules doc. Keep every section heading from the template (Introduction, Key Features, Required Assets with Unique Names, Technical Architecture (Data Objects), API Endpoints, Environment Variables, Getting Started, For Developers) and fill them in with the new app's specifics.
   - **Required Assets with Unique Names** — If the app uses dropped assets found by unique name, document every unique name pattern in a table in the README. This is critical for world builders setting up the app. Include both fixed names (manually placed) and dynamic patterns (created at runtime).
   - Rewrite server/tests/routes.test.ts to test the new app's routes; update SDK mock.
6. EXPLAIN — provide the Deliverable Format output.

DEFINITION OF DONE

- All features from plan.md are implemented and working.
- Try/catch aligned with controllers/utils.
- Jest tests cover new route(s) and assert SDK + credentials flow.
- No changes to protected files; client/topiaInit.ts remains present.
- Unused boilerplate code has been removed.
- README.md describes the new app and includes a "Required Assets with Unique Names" section if applicable.
- Server tests pass and cover the new routes.
