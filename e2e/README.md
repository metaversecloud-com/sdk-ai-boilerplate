# End-to-end tests

Playwright tests that drive the real app (production build of `client/` + `server/`) in a browser.
The server's `@rtsdk/topia` calls go to `mock-topia/server.mjs`, an in-memory fake of the Topia public
API, so no Topia credentials, world or network access are needed. The PR check (`E2E`) runs them on
every push; see `.github/workflows/e2e.yml` (managed by Terraform in config_texts).

## Run

```bash
npm install                      # app deps, repo root
cd e2e
npm install
npx playwright install chromium
npm test                         # builds the app, starts the mock + app, runs all specs
npm run test:ui                  # interactive mode
```

Against the Docker image instead of local Node (what ships; needs Docker):

```bash
e2e/scripts/test-image.sh        # image exactly as the Dockerfile builds it
e2e/scripts/test-image.sh 24     # --build-arg NODE_VERSION=24, fails unless the image runs Node 24
```

Ports: app `3100`, mock `3101`, mock-redis `3102` when enabled (override with `APP_PORT` / `MOCK_TOPIA_PORT` /
`MOCK_REDIS_PORT`; the Redis port defaults to `MOCK_TOPIA_PORT + 1`).

Local runs need Node 22 or later: the client build's Vite fails on older versions (e.g. 20.10)
before any test runs. `nvm use 22` or similar first.

If `npx playwright ...` prints an npm banner or dies with `EPIPE` when its output is piped, call the
binary directly: `./node_modules/.bin/playwright test`.

First run in a repo forked from an older boilerplate:

- If the root `.gitignore` ignores `package-lock.json`, track the e2e lockfile anyway (CI runs `npm ci`
  in `e2e/`): `git add -f e2e/package-lock.json`.
- If the root `npm start` sources `commit_info.txt` (written by the release build), create it first:
  `touch commit_info.txt` (untracked; the local run gets `COMMIT_HASH=local` from `appEnv.ts`).
- If the app builds its `Topia` client without `apiProtocol` (older forks), it calls the mock over https
  and every request fails: add `apiProtocol: process.env.INSTANCE_PROTOCOL || "https"` to the config
  (`appEnv.ts` sets `INSTANCE_PROTOCOL=http`).
- If the repo tracks build output (e.g. `.next/`), `npm test` leaves the tree dirty: don't commit it.
- Next.js inlines `process.env.NODE_ENV` at build time, so the health endpoint reports `"production"`:
  set `HEALTH_KNOWN_BUGS.incompleteContract` rather than changing the build.
- Before trusting image mode (`E2E_APP_IMAGE`, the CI image job), check the repo's dev build-push workflow
  history (`gh run list -R metaversecloud-com/<repo> --branch dev --limit 10`): some images have never built.
  A Dockerfile that `ADD`s a folder the build doesn't create (e.g. `build/` while `npm run build` writes
  `server/dist` and `client/build`) fails every push with `"/build": not found` (sdk-checkers#7). Fix the
  Dockerfile in a separate commit of the e2e PR so the image the tests run is the one that ships.
- A Dockerfile without `ARG NODE_VERSION` (a hardcoded `FROM node:20.10-alpine3.19`) ignores
  `test-image.sh <version>`, which then stops with "Image runs v20..., expected Node 24": a Node comparison run
  isn't possible until a Node-upgrade PR adds the `ARG`. Record it as not run rather than editing the Dockerfile
  in the e2e PR.
- Apps whose routes never call `getCredentials` (placeholders, API-key-driven webhooks) have no
  `CREDENTIALED_ROUTES` entries: leave it empty, and pin what the routes do answer in `tests/app` (status,
  body, that no Topia call was made: `world.events()` stays `[]`) so a change shows up in review. Apps whose
  router isn't on `/api` (e.g. scene-manager's `/backend`): set `basePath` on the routes that do read
  credentials, `HEALTH_PATH` if the health route moved, and `MALFORMED_JSON_REQUEST` if `express.json()` is
  mounted only on that router (scene-manager#11).

## Layout

| Path | What it is | When forking into a new app |
|---|---|---|
| `tests/platform/` | Checks every SDK app must pass: health endpoint contract, app shell fallback, credential checks, the interactive secret never reaching the browser (`callRoute.ts` sends each route its credentials and gives up after `ANSWER_TIMEOUT_MS`, 10s), the process surviving an unhandled promise rejection, a malformed JSON body getting a clean 400, the page calling its own origin. `mock.spec.ts` checks mock-topia and mock-redis keep the real services' rules (see "What the mock mirrors") | Keep identical; only edit `app.config.ts` |
| `app.config.ts` | The app's credentialed routes, their known bugs, the entry page, the app shell marker, health/process known bugs and test-only app env | See below |
| `appEnv.ts` | The app's environment under test (mock Topia, fake S3, dummy AWS credentials, `COMMIT_HASH`/`TZ` locally, `REDIS_URL` with `MOCK_REDIS`) plus `APP_ENV`; used by the shared server, private instances and the Docker image. `mockForApp()` is `{ host, url, redisUrl }` as the app reaches mock-topia and mock-redis (`host.docker.internal` in image mode), for URLs the app itself calls; `HEALTH_PATH`, `MOCK_REDIS` | Keep identical; app variables go in `APP_ENV` |
| `playwright.config.ts` | Starts mock-topia, mock-redis (`MOCK_REDIS`), any `EXTRA_WEB_SERVERS`, then the app (local build or `E2E_APP_IMAGE`); drawer-width viewport, UTC | Keep identical; per-app settings are in `app.config.ts` |
| `mock-redis/server.mjs` | In-memory Redis (RESP2) for apps that keep state or fan SSE updates out through Redis; the suite starts it for the app only with `MOCK_REDIS = true` (see "Fake Redis"), but every repo needs it: `tests/platform/mock.spec.ts` always starts its own instance | Keep identical; add commands here (in the boilerplate) if an app needs more |
| `tests/app/` | Tests for the boilerplate's example page | Replace with tests for the app's own pages and rules |
| `fixtures.ts` | `world.seed({...})` builds one isolated Topia world per test; `world.url()` / `world.api()` / `world.credentials()` add the session credentials Topia appends (the nonce is unique per world) | Extend `seed` for the app's data objects |
| `helpers/` | Shared test helpers apps import as needed. `leaderboardForgery.ts`: `forgeDisplayName(world, [999999])` for the `name\|score` leaderboard forgery. `sse.ts`: `openStream(world.api("/sse"))` reads an SSE stream from Node (`status`, `messages`, `close()`). `privateServer.ts`: `withPrivateServer(async (origin) => ..., { unhandledRejection?, env?, settleMs? })` runs a throwaway app instance for tests that may crash it, resolving `{ result, error, alive, output }`; `settleMs` (default 500) keeps watching for an exit after `use` returns. `press.ts`: `press(locator)` clicks by dispatching the event, for 0x0 icon-only buttons (see `stubSdkIcons`). `hooks.ts`: `hookUrl(world, name)` a per-world fake webhook URL as the app reaches it, `hookCalls(request, world, name?)` / `allHookCalls(request)` / `channelCalls(request, channel, text)` what the app sent there (see "Outgoing webhooks") | Keep; import from `tests/app` |
| `mock-topia/server.mjs` | Fake Topia public API. Like the real one, world routes and `public-key-analytics` reject calls with neither an API key nor an interactive JWT carrying a nonce. Route handlers are `(params, body, query, world, holdMs, req)`: `world` the call's seeded world, `req` the raw request (`req.headers`, e.g. `jwtPayload(req.headers.interactivejwt)`) | Add routes for any endpoint the app calls that isn't there |
| `mock-topia/catalog.json` (optional) | The app's default inventory catalog (array of `{ id, name, type, status?, description?, image_path?, metadata? }`); without it the default is four Quiz badges | Add one if the app caches the catalog process-wide (see `inventoryItems`) |

### `app.config.ts`

| Export | What to set |
|---|---|
| `CREDENTIALED_ROUTES` | Every route that calls `getCredentials`: `{ method, path, data?, query?, knownBugs?, credentialsIn?, credentialsKey?, basePath? }`. `credentialsIn: "body"` for webhooks that read `getCredentials(req.body)` (credentials go as top-level JSON fields instead of the query string). `credentialsKey: "interactiveParams"` for routes that read them nested in the body (`getCredentials(req.body.interactiveParams)`; implies `"body"`). `query: { q: "x" }` for routes that need query parameters besides the credentials (a GET that answers early without them would make the secrets scan vacuous). `basePath` if the router isn't mounted on `/api` (e.g. `"/webhook"`). `knownBugs`: `leaksSecret`, `acceptsMissingCredentials`, `acceptsForeignCredentials`, `unnamedCredentialError`, `crashesServer`, `answersNever` (see below). |
| `ENTRY_PAGE` | The page Topia opens in the iframe, or `null` if the app has no page (webhooks only, e.g. connect4): the page-load and app-shell tests are skipped. |
| `ENTRY_PAGE_KNOWN_BUGS` | `leaksSecret` if loading the page leaks the secret. `callsOtherOrigin` if the page sends `/api` (or any `localhost`) requests to another origin than the app's, typically a hardcoded `http://localhost:3000` API base (`VITE_API_URL` fallback) that only works in local development; the page's other app tests then route those calls to the app themselves (`page.route("http://localhost:3000/api/**", ...)`, sdk-checkers#7). |
| `ENTRY_PAGE_SCAN` | What the page-load secret scan reads: `"api"` (default) the page's `/api` responses, at least one required; `"all"` every response from the app (document, scripts, `/api`) plus WebSocket frames, none required. Use `"all"` for socket-only pages (wiggle) or pages that call `/api` only after the player acts (teams-notifier), instead of `ENTRY_PAGE = null`. Server-sent-event streams are never read. |
| `ENTRY_PAGE_ACTION` | Optional `async (page, world) => {...}` run after the page loads and before the scan, e.g. click "Join" so the page opens its socket or calls `/api`. Wait inside it for what it triggers (e.g. `expect(board).toBeVisible()`): the scan reads what arrived by then. |
| `HEALTH_PATH` | The app's health endpoint, default `/api/system/health`. Used by the shared server's readiness check, private instances and `system.spec.ts`. |
| `APP_SHELL_MARKER` | Text the app shell's HTML contains, if the page isn't a React root (e.g. Unity, Next.js `id="__next"`). |
| `APP_SHELL_FALLBACK` | `false` for apps with real page routes that answer unknown paths with a 404 (e.g. Next.js): skips "unknown pages fall back to the app shell" instead of a `grepInvert`. Default `true`. |
| `HEALTH_KNOWN_BUGS` | `{ incompleteContract: "<reason>" }` for apps whose health endpoint lacks fields of the contract (typically `envs.COMMIT_HASH` / `envs.BUILD_TIME` in apps forked before them, or `NODE_ENV` baked in by Next.js), instead of changing app code in the e2e PR. |
| `PROCESS_KNOWN_BUGS` | `{ exitsOnUnhandledRejection: "<reason>" }` while a promise rejection nobody handles exits the process. Every app has it today: `@rtsdk/topia` registers an `unhandledRejection` hook that calls `process.exit(1)`, and an app's own logging handler doesn't stop it. Fix: `process.removeAllListeners("unhandledRejection")` before registering the app's handler. |
| `MALFORMED_JSON_REQUEST` | `{ method: "post" \| "put", path }` the malformed-JSON check posts to. Default: the first POST/PUT entry of `CREDENTIALED_ROUTES` (with its `basePath`), else `POST /api/e2e-malformed-json`, which reaches the parser when `express.json()` is app-wide. A 404 there means nothing parsed the body: point it at a route that does. `null` skips the test (an app that parses no JSON). |
| `ERROR_KNOWN_BUGS` | `{ malformedJson: "<reason>" }` while a malformed JSON body doesn't get a clean 400: without an error-handling middleware Express answers with its default HTML page, which shows the stack trace and server file paths unless `NODE_ENV=production`. The boilerplate has it. Fix: an error middleware after the routes that answers `err.type === "entity.parse.failed"` with `res.status(400).json({ success: false, error: "Invalid JSON" })`. |
| `MOCK_REDIS` | `true` for apps that use Redis (state, SSE fan-out): starts `mock-redis/server.mjs` and sets `REDIS_URL` (and `REDIS_CLUSTER_MODE: "false"`) for the shared server, private instances and the image. An app that reads other variable names sets them in `APP_ENV` from `mock.redisUrl`. Default `false`. |
| `EXTRA_WEB_SERVERS` | Further processes to start before the app, as Playwright `webServer` entries (`{ command, url \| port, env?, reuseExistingServer?, timeout? }`), for a fake that can't live in mock-topia. Default none. |
| `APP_ENV` | Test-only app environment, merged over `appEnv.ts`: an object, or a function of the mocks' addresses as the app reaches them (`({ host, url, redisUrl }) => ({ GOOGLE_API_ROOT_URL: `${url}/` })`). Blank every variable that would reach a real service. Older `app.config.ts` files without `HEALTH_KNOWN_BUGS`, `PROCESS_KNOWN_BUGS`, `APP_ENV`, `APP_SHELL_FALLBACK`, `ENTRY_PAGE_SCAN`, `ENTRY_PAGE_ACTION`, `HEALTH_PATH`, `MALFORMED_JSON_REQUEST`, `ERROR_KNOWN_BUGS`, `MOCK_REDIS` or `EXTRA_WEB_SERVERS` keep working (every read has a default), but the malformed-JSON test then runs unmarked. |

`crashesServer`: some routes call `getCredentials` outside any try/catch, so a request without credentials
becomes an unhandled rejection and `@rtsdk/topia`'s hook exits the process. The "rejects a request
without session credentials" test would take the shared server down and every later test fails with
`ECONNREFUSED`; if that happens right after one of the credential tests, set `crashesServer` on the route.
All three credential tests then run against private instances (`helpers/privateServer.ts`). The
missing-credentials one expects the instance to stay up and is marked `test.fail` until the route is fixed.
The two foreign-credentials ones count an instance that went down as the `crashesServer` bug (routes that
destructure getCredentials' `{ error }` and throw it later crash on foreign credentials too, e.g.
toast-notifications) and otherwise check as usual, with their own `acceptsForeignCredentials` /
`unnamedCredentialError` markers.

`answersNever`: with valid credentials the route never answers (typically a webhook whose handler returns
on some path without `res.send`, e.g. race's checkpoint webhook when no race runs). Every platform call gives
up after `ANSWER_TIMEOUT_MS` (10s, `callRoute.ts`) with "didn't answer within 10000ms", so a hang fails fast
instead of eating the test timeout. `answersNever` marks the secrets test (which needs the answer) as
`test.fail`; when the route answers again it flips and the marker goes. If the route also hangs on missing
or foreign credentials, those tests fail on the timeout too: mark them with `acceptsMissingCredentials` /
`acceptsForeignCredentials` / `unnamedCredentialError` (it doesn't reject them), all with the same reason.

Leave server-sent-event routes (e.g. `GET /sse`) out of `CREDENTIALED_ROUTES`: with valid credentials
the stream never ends, so the platform tests can't read the body and time out. Test their credential
checks in `tests/app`. If a route reads its credentials somewhere the platform tests don't send them,
`secrets.spec.ts` fails with "the route didn't get the credentials" (the body matches
`/missing required (\w+ )*parameters/i`, so variants like "Missing required body parameters" count) instead
of passing vacuously.

Webhook-only apps that never call `getCredentials` (e.g. topia-activity-apps, driven by an API key): leave
`CREDENTIALED_ROUTES` empty and `ENTRY_PAGE = null`, then cover in `tests/app` what the platform tests would
have: the API key never reaching a response (`E2E_API_KEY` is distinctive for that), and requests from
unknown worlds or keys being refused. The shared server's stdout isn't available to tests; for a log-leak
check run the request through `withPrivateServer` and scan its `output`.

### Fixtures

`world.seed({...})` options besides the basics (`isAdmin`, `inZone`, `withAsset`, `asset`, `assetData`, `worldData`, `visitorData`, `badges`, `extraAssets`):

| Option | What it does |
|---|---|
| `latencyMs`, `delays: { "<substring of 'METHOD /api/v1/...?query'>": ms }` | Hold every / matching public-API call, so concurrent requests overlap deterministically. Keys are substrings of the method, path and query string, e.g. `"/assets-with-unique-name/board?partial"`. |
| `holdLocksDuringDelay: true` | Data-object writes with a `lockId` take the lock first and hold it for their delay, so a concurrent write with the same `lockId` gets 409 like the real API (see "Races" below). |
| `failures: { "<substring>": status }` | Answer matching public-API calls with that status (logged as `injected-failure` events), e.g. `{ "grant-visitor-inventory-item": 500 }`. Matched like `delays` (query string included). Also applies to the world's fake webhooks (`"POST /hooks/<urlSlug>/<name>"`). Change mid-test with `world.setFailures({...})`; `world.setFailures()` stops them. |
| `inventory: [{ item, quantity?, metadata? }]` | Catalog items the visitor owns, any type: `item` is a catalog id or name, `quantity` defaults to 1, `metadata` is the user item's own (default `{}`). An unknown item fails the seed. `badges: ["name"]` stays the shorthand for badges. |
| `otherVisitors: { [visitorId]: { isAdmin?, inZone?, visitorData?, badges?, inventory?, profileId?, displayName?, ...fields } }` | More players in the world. Defaults: `profileId` `<world.profileId>-v<id>` (unique per world), `displayName` `Player <id>`, in the zone. |
| `visitor: {...}` | Extra fields on the test's own visitor (e.g. `expressions: ["emote-wave"]` it owns). |
| `users: { [profileId]: dataObject }` | Data objects of profiles that aren't in the world. |
| `inventoryItems: [{ id, name, type, status?, metadata?, ... }]` | The ecosystem inventory catalog for this world (default: `mock-topia/catalog.json`, else four Quiz badges). Apps that cache the catalog process-wide (an inventory cache) keep whichever world loaded it first, so per-world catalogs don't work for them: put the app's catalog in `mock-topia/catalog.json` instead and don't seed `inventoryItems`. |
| `expressions: [{ id, name, ... }]` | Unlockable expressions for this world (default: Wave, Dance). |
| `worldDetails: {...}` | Fields `GET /world-details` (`World.fetchDetails`) returns over the default `{ urlSlug, name, width: 4000, height: 4000 }`. |
| `userGroupDataObjects: [{...}]` | What `Visitor.fetchUserGroupDataObject` returns for the world (default none). |
| `visitor: { npc, voiceSession }` | Start with an NPC (`{ playerId, username, ... }`) or an AI voice session (`{ publicKey, npcPlayerId }`; another `publicKey` stands for another app's session). |
| `scenes: { [sceneId]: { name, description, previewImgUrl, width, height, ... } }` | What `GET /scenes/:sceneId` (`Scene.get` / `fetchSceneById`) returns, with `id` set to the key; read from the caller's world (JWT `urlSlug`). An unknown id answers 200 with a `null` body, like the real `getSceneById` (not a 404). |
| `extraAssets: { [id]: {...} }` | Further dropped assets; `id` defaults to the key (an explicit `id` wins). |

User data objects are kept per world in the mock (one record per `profileId` in each world), so a fixed
`profileId` in `otherVisitors` or a `users` key like `"profile-alice"` is safe in tests running in parallel:
each test's world has its own copy, and the app and the assertions see the id exactly as written. The flip
side: one profile in two worlds of the same test doesn't share its user data object (the platform would).
`world.scopedId("alice")` (`<world.profileId>-alice`) is still the way to keep anything else the mock or the
app shares across worlds apart (S3 keys, webhook names, an app's process-wide cache keyed by profile).

Acting as another player: `world.url("/", world.as(43))`, `request.post(world.apiAs(43, "/join"))`,
`world.player(43)` (`{ visitorId, profileId, displayName }`). Seeded visitors have a `username` like real ones
(`e2e-player`, `player-<id>`, the same as their credentials send). `world.as(id)` gives each player their own
nonce, like separate drawers. Reading state: `world.visitorData(43)`, `world.userData(profileId)`,
`world.assetData()`, `world.events(type)`, `world.s3Objects()`.

`test.use({ stubSdkIcons: true })` answers `https://sdk-style.s3.amazonaws.com/icons/*` with a 24x24 SVG
instead of aborting it. Icon-only buttons (`<button><img src=".../icons/edit.svg"></button>`) are
otherwise 0x0 and Playwright refuses to click them; `press(locator)` (`helpers/press.ts`) dispatches the
click without those checks as a fallback.

`test.use({ uniqueAssetId: true })` makes the key asset id unique per world (`world.assetId`, also in
`world.credentials()`), for apps that match SSE connections or caches by `assetId` alone. The default
stays `KEY_ASSET_ID`; use `world.assetId` in new tests so they work either way.

Pages render at drawer width (400px, `playwright.config.ts`): CDN stylesheets are aborted, and unstyled
pages overlap at desktop width. A page opened as a full-screen modal can use `test.use({ viewport })`.

Every test gets its own world, so the suite runs fully in parallel. Each test also fails if the app
calls a public-API endpoint the mock doesn't implement, so an `@rtsdk/topia` upgrade that starts using
new endpoints can't pass silently. A full app example lives in sdk-quiz (`e2e/tests`).

## What the mock mirrors

- Calls outside `/world/` (inventory, user data objects and inventory, expressions, ...) belong to the world named in the caller's `InteractiveJWT` (`urlSlug`), so seeded `delays`, `failures`, catalogs and analytics apply to them too.
- A visitor's data object is its user's data object (one record per profile, like the real API): `Visitor` and `User` reads and writes for the same `profileId` see the same data. Unlike the real API, that record is per world (the call's world: path, else JWT), so parallel tests can share a fixed `profileId`.
- `GET /world/:slug/visitors` (`?droppedAssetId=` keeps only visitors in that landmark zone, like `handleGetVisitors` for `WorldActivity.fetchVisitorsInZone`; NPCs created with the app's key are listed too, like `getVisitors`), `GET /world/:slug/assets-with-unique-name/:name` (`partial` is a prefix match like the real `startAt`/`endAt` query, and any `partial` value counts, even `false`), `PUT /user/inventory/:profileId/grant-user-inventory-item` (every visitor with that profile in the caller's world gets it), `GET /expressions` + `PUT .../visitors/:id/grant-expression/:id` (an expression already owned answers 200 `{ statusCode: 409 }`, an unknown one 200 `{ statusCode: 404 }`: `grantUserExpression` returns its `ApiError` instead of throwing and `handleGrantUserExpression` sends it with a 200, so `Visitor.grantExpression` resolves), `change-click-type`, `change-media-type` (sets `mediaPlayTime`, like a restart).
- Fake S3 under `/s3/<bucket>/<key>` (PUT incl. aws-chunked uploads, GET, HEAD, DELETE; `world.s3Objects()`). `appEnv.ts` always points `AWS_ENDPOINT_URL_S3` there with dummy credentials real AWS rejects and disables EC2 metadata, so a local run can't write to a real bucket even through an app's hardcoded fallback bucket name. `S3_BUCKET` stays empty; opt in with `APP_ENV = { S3_BUCKET: FAKE_S3_BUCKET }` (the underscore forces path-style URLs; a DNS-valid bucket name needs `forcePathStyle` in the app's client). Apps that read AWS credentials under other variable names (e.g. from `../.env`) must blank those in `APP_ENV`.
- `GET /images/<anything>` answers a 1x1 PNG, for seeded image URLs the server downloads (`${MOCK_TOPIA_URL}/images/x.png`).
- `GET /world/:slug/assets/:id` returns the asset with its `dataObject`, like the real API (`DroppedAsset.get` fills `droppedAsset.dataObject` from it).
- Data-object writes (`set`, `update` and `increment-data-object-value`, on world, asset, visitor and user) honour `lock`: a held `lockId` answers 409, `releaseLock: true` frees it after the write, otherwise it stays held. Locks are per data object. By default the write takes and frees the lock in one step after its delay; `holdLocksDuringDelay` holds it for the delay.
- `GET /world/:slug/visitors/:id` answers a map keyed by visitorId, like the real route (`getVisitors`); `Visitor.fetchVisitor` reads `response.data[id]`.
- `analytics` sent with a successful write are logged as `analytics` events, with `urlSlug` set to the authenticated world (the path's, else the JWT's) like `analyticsUrlSlugStamp`, whatever the app sent; `particles` events carry `particleName`.
- Particle names (`GET /particles?name=`): the mock accepts a fixed list (`brain_float`, `partyPopper_float`, `confetti_float`, `explosion_float`, `sparkles_float`, `blueSmoke_puff`, `whiteStar_burst`, `musicNote_float`, `Firework`, `confetti_1`). Names were added because apps use them, not checked against the real catalog: a passing test doesn't prove the platform has the particle, so check new names separately.
- Visitor inventory entries have the real fields (`id`, `item_id`, `itemId`, `quantity`, `metadata` (the user item's), `itemMetadata`, `name`, `description`, `image_url`, `type`, `status`) plus the nested `item` (with the catalog `metadata`). Granting an owned item adds to its quantity. Like the real reads, entries at quantity 0 or below aren't returned.
- `PUT .../visitors/:id/update-visitor-inventory-item-quantity` (`Visitor.modifyInventoryItemQuantity`) mirrors `grantOrUpdateInventoryItemQuantity`: an upsert by item (`itemId`, or `userItemId` of an owned entry) that adds `quantity` as a delta, `delta || 1` (0 counts as +1), no floor at 0, metadata reset to `{}`; answers 201 with the real fields (`inventoryItem` is the user item id, no `user_id`). Logged as `modify-item` events `{ name, quantity: delta, total }`.
- `GET /user/inventory/:profileId/get-user-inventory-items` (`User.fetchInventoryItems`): the inventory that profile's visitor carries in the caller's world.
- `GET /world/:slug/assets` (`World.fetchDroppedAssets`, without data objects), `PUT .../assets/:id/set-clickable-link-multi` (replaces `clickableLinks`, keeps `existingLinkId`, new links get a `linkId`; logged as an event), `GET /world/:slug/world-details`.
- `PUT /analytics/public-key-analytics` needs an API key or an interactive JWT, like the real route (`interactiveKeyValidator` + `gameEngineValidator`). Like `handleAddPublicKeyAnalytics`, each analytic counts for the session's world (the JWT's `urlSlug`), not the `urlSlug` it names: logged there as an `analytics` event with `source: "public-key"`, `sentUrlSlug` (what the app sent) and `sessionVisitorId`. Per-player names (`<name>-<20-char mixed-case id>`) are dropped like the real route, logged as `analytics-rejected`. Answers `{ success: true }`.
- `DELETE /world/:slug/assets/:id` answers `{ success: true }`, 404 for an asset that doesn't exist (`removeDroppedAsset`).
- `GET /auth/interactive-credentials` (`User.checkInteractiveCredentials`): 200 `{ success: true }` for a JWT with nonce, assetId, visitorId and urlSlug, else 401.
- `POST /world/:slug/drop-scene` (`World.dropScene`): needs an admin visitor unless `allowNonAdmins` (API-key calls don't), answers `{ sceneDropId, success: true }` (`sceneDropId` defaults to `<sceneId>-<n>`). Scenes aren't modelled: one placeholder asset tagged with the `sceneDropId` stands in for the scene's assets. Logged as `drop-scene`.
- `PUT .../assets/:id/set-private-zone` stores `assetPrivateConversation` / `assetPrivateZoneChannelDisabled` / `assetPrivateConversationCap` from `isPrivateZone` / `isPrivateZoneChatDisabled` / `privateZoneUserCap` (omitted ones keep their value); `set-asset-interactive-settings` sets `isInteractive` (default `false`) and `interactivePublicKey` (default `""`), so an omitted field resets. Both logged with the request body.
- `PUT .../assets/:id/set-custom-text` (`DroppedAsset.updateCustomTextAsset(style, text)`, `setCustomTextAssetCaption`): `text` replaces the caption (omitted keeps it), each `style` attribute sent (`textColor`, `textSize`, ...; null or omitted keeps the asset's value) lands on the asset's own flat field, `textFontFamily` also sets the legacy `textFont`; answers the asset with those fields under `textStyle`. 400 for an asset whose `specialType` is set to something other than `"text"` (the real route also refuses one without `specialType`; the mock lets seeds omit it). Logged as `set-custom-text` with the request body.
- `GET /world/:slug/visitors/:id/user-group-data-object` answers `{ success: true, userGroupDataObjects }` (seeded; the visitorId isn't used, like the real route).
- NPCs and AI voice sessions, with `handleCreateNpc` / `handleGetNpc` / `handleDeleteNpc` / `handleStart|StopNpcVoiceSession`'s rules: `create-npc` needs an owned inventory item of type `NPC` whose catalog metadata has a `spriteUrl` (403 for another player's item), validates `spawnEffect` the same way, 409 for a second NPC unless `replace`; the NPC player has `isNPCFromKey` = `<publicKey>|<inventoryItemId>|<userInventoryItemId>` like `handleCreateNpc` / `mapRedisPlayer` (also in the visitors list); `get-npc` answers `null` without one; `start-npc-voice-session` needs the NPC and an `ek_` key, lets the same app restart, 409 when another app holds the session; `stop-npc-voice-session` is idempotent, 403 for another app's session; deleting or replacing the NPC ends the session (a `stopAiNpcVoice` event, the socket event the browser gets). Events: `create-npc`, `delete-npc`, `start-npc-voice-session` (with the voice config), `stop-npc-voice-session`.
- API-key calls (an `Authorization` header and no interactive credentials) skip the public key check like `interactiveKeyValidator`; the only key accepted is `E2E_API_KEY` (`constants.ts`; `APP_ENV = { API_KEY: E2E_API_KEY }`), an unknown key is a 404 and an unseeded world a 401, like `apiKeyValidator`. The world routes also answer under `/api/world/...` (no `/v1`), like the real API.
- Routes added since the error format was checked (`apiError` in `server.mjs`) answer errors like the real API, `{ errors: [{ message }] }`, which `@rtsdk/topia` reports as the error's message. Older routes still answer `{ message }` (see Known gaps).
- `GET /scenes/:sceneId` (`Scene.get`): seeded `scenes`, else 200 `null` like `getSceneById` (`handleGetSceneById` answers `res.json(null)` when the `kits` doc doesn't exist). Needs a session or API key like the other world routes (the real `globalApiValidator` answers 400 without one, the mock 401).
- `PATCH /__mock/worlds/:slug/visitors/:id` (`world.updateVisitor({...})`) changes visitor fields mid-test. Route handlers may be async.
- Latency, so concurrent requests overlap like they do against the real API: `world.seed({ latencyMs: 25 })` delays every public-API call into the world; `world.seed({ delays: { "/visitors/42/set-data-object": 400 } })` delays only calls whose `METHOD /api/v1/world/...` contains the key, so a test can line two requests up deterministically.
- The browser may only reach localhost: `fixtures.ts` aborts every other request. It runs in UTC like the app (`timezoneId` in `playwright.config.ts`); a test can pick another zone with `test.use({ timezoneId })`.
- `interactiveNonce` is `e2e-nonce-<urlSlug>`, so apps that key state by nonce across worlds (SSE connections, caches) don't mix up parallel tests.

### Fake Redis

`MOCK_REDIS = true` (app.config.ts) starts `mock-redis/server.mjs`, generalized from the copies in sdk-race#53,
sdk-chess-game#66, jukebox#29 and leaderboard#7, and points `REDIS_URL` at it (`mock.redisUrl` in `APP_ENV`
for other variable names). It speaks RESP2 to node-redis v4 (what every Redis app uses, single node: set
`REDIS_CLUSTER_MODE: "false"`, done by `appEnv.ts`): `GET`, `SET` (`EX`/`PX`/`EXAT`/`PXAT`/`NX`/`XX`/`GET`/
`KEEPTTL`), `SETEX`, `MGET`, `DEL`/`UNLINK`, `EXISTS`, `INCR`/`INCRBY`/`DECR`/`DECRBY`, `EXPIRE`/`PEXPIRE`/
`TTL`/`PTTL` (expiry checked on read), `KEYS`, `HSET`/`HGET`/`HGETALL`/`HDEL`, `PUBLISH`/`SUBSCRIBE`/
`UNSUBSCRIBE`/`PSUBSCRIBE`/`PUNSUBSCRIBE`, `PING`/`ECHO`/`INFO`/`QUIT`, and acknowledges the handshake
(`AUTH`, `SELECT`, `CLIENT ...`, `READONLY`). Any other command answers `-ERR unknown command` and is logged to
the webServer's stderr (`[mock-redis] unhandled command X`): the earlier copies answered OK to everything,
which let an unimplemented command pass silently. Add missing commands to the boilerplate's copy. One keyspace
and one set of channels for the whole suite: key per world, and expect a channel shared by every world
(e.g. `${INTERACTIVE_KEY}_JUKEBOX`) to carry other tests' messages.

### Event fields

`world.events(type)` returns the SDK's request body plus `type` (and `visitorId` for visitor calls), so
the field names are the SDK's, not the method's arguments:

- `move`: `{ moveTo: { x, y }, teleport }` (`moveVisitor({ shouldTeleportVisitor, x, y })`).
- `set-activity`: the activity type is `webhookType` (the body's own `type` is replaced by `"set-activity"`), plus `assetId`.
- `close-iframe`: `{ droppedAssetId }`; `open-iframe` and `fire-toast` carry their params as sent.
- `webhooks`: the body's `type` is `webhookType` too.

### Outgoing webhooks

`/hooks/*` on mock-topia accepts any request and records it (`GET /__mock/hooks`, `helpers/hooks.ts`). Seed
`hookUrl(world, "teams")` wherever the app reads a webhook URL (data objects, `userGroupDataObjects`), or
point an `APP_ENV` variable at `${mock.url}/hooks/<channel>` for a shared one (`channelCalls` filters those by
text). A path segment `fail-<status>` (e.g. `hookUrl(world, "fail-500")`) answers that status, and the
world's seeded `failures` / `delays` apply to its `/hooks/<urlSlug>/...` calls. Teams-style: a success
answers a bare `1`.

### External APIs

Fake any other service the app calls in `mock-topia/server.mjs` and point the app at it through
`APP_ENV`, never at the real one. jukebox#29 fakes the YouTube Data API: `APP_ENV` sets
`GOOGLE_API_ROOT_URL: `${mock.url}/`` and a distinctive `GOOGLE_API_KEY`, the mock answers
`/youtube/v3/search` and `/youtube/v3/videos` (with magic ids/queries for "video gone" and "quota
exceeded"), and logs the calls at `/__mock/youtube` for assertions.

### Extensions other apps added

Not in the boilerplate because they're app-specific. Copy from the PR when an app needs one.

| Extension | PR |
|---|---|
| Fake S3 (uploads) | sdk-scavenger-hunt#56, sdk-quest#53 |
| Fake Redis (`mock-redis/`, origin; now `MOCK_REDIS`) and scenes | sdk-race#53 |
| NPCs and expressions | virtual-pet#54 |
| JWT signature checks, multi-app and ecosystem data objects | sdk-leaderboard#13 |
| Extra players (`otherVisitors`, `world.as`), calendar-day tests in another timezone | sdk-grow#18 |
| `update-visitor-inventory-item-quantity`, teams, SSE credential checks | sdk-escape-room#20 |
| Stopped page clock for timer-driven gameplay, badge catalog incl. inactive and non-badge items | sdk-kitchen-rush#12 |
| Players acting through the API (`players`, `apiAs`), set builders | sdk-trivia#12 |
| No client page, body-credential webhooks (`world.webhook`), text and web-image assets | connect4#33 |
| `mock-redis` SSE fan-out, `set-position`, `set-asset-interactive-settings`, `auth/interactive-credentials`, lock-bucket timing | sdk-chess-game#66 |
| Award flows with `failures` and `otherVisitors`, retired/non-badge/dotted badge names in the catalog | sdk-badges#13 |
| Old repo onboarding (`git add -f` lockfile, `commit_info.txt`), routes with no credential check, `change-click-type` | sdk-checkin#12 |
| Fake S3 mirroring, expressions, accessory packs, `apiAs` | sdk-unlockables#33 |
| `crashesServer` origin (private server), YouTube fake, `mock-redis` pub/sub, per-world asset id, time-bucket locks | jukebox#29 |
| Lock-release races, SSE streams per player, `assets-with-unique-name` scenes, turn timeouts | sdk-ring-toss#16 |
| Visitor+user records, badge catalog metadata, fake S3 uploads, three-player monsters | sdk-monster-mash#22 |
| Process-wide inventory cache with a suite-wide catalog, lock 409 races, level-up particles | sdk-color-echo#13 |
| Next.js app (real 404s, `id="__next"`, baked `NODE_ENV`), nested `interactiveParams` credentials, `API_DOMAIN` | sdk-collaborative-puzzle#11 |
| Decks per user/class, `failures` changed mid-test, icon-only buttons | sdk-study-stacks#13 |
| `update-visitor-inventory-item-quantity` economy, `get-user-inventory-items`, per-app catalog, many players' plots | sdk-grow-together#43 |
| Catalog of non-badge items with metadata, inventory seeding, `world-details`, CDN icon stubs | sdk-lunch-swap#15 |
| `GET /world/:slug/assets`, `set-clickable-link-multi`, GET routes with `query`, `press` helper | sdk-cms#18 |
| API-key mode (origin), webhook-only app without `getCredentials`, prefix `partial` and `DELETE` fixes | sdk-topia-activity-apps#8 |
| `crashesServer` on foreign credentials (origin), routes that crash on any bad credentials left out | sdk-toast-notifications#18 |
| NPC + voice-session endpoints (origin), OpenAI Realtime ephemeral-key fake (`/openai`, quota/invalid-key magic keys) | sdk-npc-voice-session#11 |
| `/hooks/*` webhook fake (origin), `userGroupDataObjects`, page that calls `/api` only on an action | teams-notifier#43 |
| `drop-scene`, `set-private-zone`, `set-asset-interactive-settings`, zone-filtered visitors, usernames, lock-bucket waits | breakout#23 |
| Socket-only page: canvas recorder and socket `emitRaw` helpers, analytics per session world (origin) | sdk-wiggle#23 |
| No page and no credentialed routes, router on `/backend`, malformed-JSON stack-trace check (origin) | scene-manager#11 |
| `mock-redis` on an old race fork, hanging checkpoint webhook (origin of `answersNever`), crash after the response (origin of `settleMs`) | leaderboard#7 |
| `GET /scenes/:id` + `scenes` seed (origin), scene switching | scene-swapper#22 |
| Old boilerplate example page, Dockerfile that never built, hardcoded `localhost:3000` API base (origin of the origin check), un-awaited delete crashing the server, `extraAssets` id default | sdk-checkers#7 |

## Known gaps

- Error bodies: the real API answers errors as `{ errors: [{ message }] }` and `@rtsdk/topia` uses that
  message. Most mock routes predate that check and answer `{ message }`, so an SDK error's `message` is
  axios' "Request failed with status code N" there instead of the real text: don't assert on it.
- Scenes: `drop-scene` drops one placeholder asset instead of the scene's assets, and there is no per-app
  hook to seed a scene's contents (`scenes` only feeds `Scene.get`). Apps that read what a scene drop created seed those assets themselves
  (see sdk-race#53, breakout#23).
- External-API failure injection per world only covers `/hooks/<urlSlug>/...`; app-specific fakes (YouTube,
  OpenAI) use magic ids or keys instead (jukebox#29, sdk-npc-voice-session#11).
- No WebSocket fake: socket-only apps drive the browser (wiggle#23's recorders).
- SSRF: the browser and mock only use `localhost`, so a route that fetches a user-supplied URL (e.g. link
  previews) can't be tested against a realistic external hostname yet. Cover those checks with unit tests
  or a stub hostname in the app's own tests.

## Known bugs

Tests for bugs that still exist are marked `test.fail(...)`: they pass while the bug is there and
fail with "Expected to fail, but passed" once it's fixed, so the marker is removed in the same change
as the fix. In `tests/platform/` the markers come from `knownBugs` on each route in `app.config.ts`
(and `ENTRY_PAGE_KNOWN_BUGS` for the page load), so the specs stay identical across apps.

| Test | Bug | Fix |
|---|---|---|
| `platform/credentials.spec.ts` "names the credential problem" (`unnamedCredentialError`) | `getCredentials` returns `{ error }` instead of throwing, so requests with bad credentials carry on and fail later on a Topia call. | Throw from `getCredentials` (protected file: needs explicit approval). Tracked in EXP-428. |
| `platform/system.spec.ts` "a promise rejection nobody handles doesn't take the server down" (`exitsOnUnhandledRejection`) | `@rtsdk/topia`'s `unhandledRejection` hook calls `process.exit(1)`; the handler in `server/index.ts` meant to prevent crashes runs too late to matter. | `process.removeAllListeners("unhandledRejection")` before `server/index.ts` registers its handler (or drop the exit from the SDK). |
| `platform/system.spec.ts` "a malformed JSON body gets a 400 without a stack trace or server paths" (`ERROR_KNOWN_BUGS.malformedJson`) | No error-handling middleware: `express.json()`'s parse error reaches Express' default handler, whose HTML page shows the stack trace and file paths (`NODE_ENV` isn't `production` under test, nor set by the Dockerfile). | An error middleware in `server/index.ts` answering `entity.parse.failed` with a JSON 400. |

The interactive secret leak (EXP-429) is fixed here: `server/index.ts` registers the
`cleanReturnPayload` scrubber on `/api` before the routes, and the scrubber also strips
`interactiveSecret` from SDK errors. Apps forked earlier register it after the routes, where it
never runs; set `leaksSecret` on the routes that leak until they take the same fix.

## Conventions

- New tests are mutation-checked: break the behavior in the app and confirm the test goes red.
- Before merging, `npx playwright test --repeat-each=3` must pass every time.
- Races. The mock runs a call's delay before handling it, and a data-object write takes and frees its
  lock in one step, so by default two writes with the same `lockId` and `releaseLock: true` never collide
  (a 409 only comes from a lock left held). Pick the setup for the race under test:
  - Lock contention (the real API's 409 while another write holds the lock): seed
    `holdLocksDuringDelay: true` with a delay on the write, e.g. `delays: { "/set-data-object": 300 }`.
    The first write holds the lock for 300ms; a second one with the same `lockId` meanwhile gets 409.
  - Lost updates (two requests both read, then both write): delay the writes longer than the reads, e.g.
    `delays: { "/get-data-object": 50, "/update-data-object": 400 }`, so both reads finish before either
    write lands. A delay on the read alone just runs the two requests one after another.
- `page.clock.install()` doesn't pause time: the clock keeps running from the given time. Use
  `page.clock.pauseAt(...)` (or `install` + `pauseAt`) to stop it and `runFor` / `fastForward` to advance.
- Interval-driven UIs (a power meter, a countdown, pattern playback): install the clock before `goto`, then
  pause, wait until the interval has started, advance, resume. Pausing first stops a busy machine from moving
  the UI past the point the test stops on; waiting for the interval matters because React sets it up in an
  effect on a later task (its scheduler posts to a `MessageChannel`, which `page.clock` doesn't control), so
  `runFor` straight after the click can advance time before the interval exists:

  ```ts
  await page.clock.install();
  await page.goto(world.url());
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000); // runs on until it gets there
  await page.getByRole("button", { name: "Throw" }).click();
  await page.getByRole("button", { name: "Stop!" }).waitFor(); // the UI the interval drives is up...
  await page.evaluate(() => new Promise<void>((resolve) => { // ...and React's effect has run
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  }));
  await page.clock.runFor(2 * 280); // exactly two ticks
  await page.getByRole("button", { name: "Stop!" }).click();
  await page.clock.resume(); // let the rest (animations, timeouts) run normally
  ```

  (sdk-ring-toss, sdk-color-echo.)
- `withPrivateServer(use)`: return from `use` as soon as the requests are done; don't wait there for
  something to happen later (a poll, a timeout). `use` races the instance's exit, and after it returns the
  instance is watched for `settleMs` more (default 500ms) before it's killed, so a crash shows up as
  `alive: false`. Assert on `result`, `alive` and `output` after it returns.
- Failure injection on SDK calls a route doesn't await (e.g. `droppedAsset.deleteDroppedAsset()` without
  `await`, then `res.json({ success: true })`): the route answers before Topia does and the rejection lands
  later, where `@rtsdk/topia`'s hook exits the process. Run it on a private instance with `failures` seeded
  and a `settleMs` longer than the call takes (e.g. `withPrivateServer(use, { settleMs: 3000 })`), then
  `test.fail` on `alive` only after checking the request got an answer (sdk-checkers#7). Against the shared
  server it would take every later test down with `ECONNREFUSED`.
- Process-wide in-memory state (a module-level `Map`, a cache, an `EventEmitter` registry) is shared by every
  test, since all workers hit the same app process. Key everything a test creates by its world (`world.urlSlug`,
  `world.scopedId(...)`, `test.use({ uniqueAssetId: true })`) so parallel tests can't see each other's state.
- Locally `reuseExistingServer` keeps an already running app (and mock) between runs: restart it after
  changing app code or `APP_ENV`. Apps that write files at runtime (trace or log files, caches) leave them
  behind in the working tree; gitignore them or point them at a temp dir through `APP_ENV`, and don't commit
  them.
- Time-bucketed locks: apps that build a `lockId` from the clock (e.g. `${assetId}-${Math.floor(Date.now() / 10000)}`)
  answer a second action in the same bucket with the lock's 409 by design. A test that repeats an action
  waits for the next bucket first, e.g. `await new Promise((r) => setTimeout(r, 10_000 - (Date.now() % 10_000) + 50))`,
  rather than retrying.
- Server-wide background timers (a `setInterval` sweeping every game for timeouts, cleanups, ...) run
  across all worlds and can't be paused with `page.clock`, which only controls the browser. Seed state the
  timer leaves alone (e.g. a fresh `turnStartedAt`), or wait for its effect with `expect.poll` and a
  timeout longer than its interval; never assume it hasn't run yet.

## Upgrading an app's e2e/ to the latest boilerplate

For an app PR whose `e2e/` was copied from an older boilerplate. The source is this repo's `e2e/` on
`test/playwright-e2e` (sdk-ai-boilerplate#9). Work on the app's e2e branch; if a Node-upgrade branch was
merged from it, merge the e2e branch into that one afterwards.

### 1. Copy the shared files verbatim

Overwrite these with the boilerplate's copies; never edit them in an app (fix the boilerplate instead):

- `playwright.config.ts`
- `appEnv.ts`
- `constants.ts`
- `package.json`, `package-lock.json` (if the root `.gitignore` ignores lockfiles: `git add -f e2e/package-lock.json`)
- `README.md`
- `tests/platform/callRoute.ts`, `tests/platform/credentials.spec.ts`, `tests/platform/mock.spec.ts`,
  `tests/platform/secrets.spec.ts`, `tests/platform/system.spec.ts`
- `helpers/hooks.ts`, `helpers/leaderboardForgery.ts`, `helpers/press.ts`, `helpers/privateServer.ts`,
  `helpers/sse.ts`, `helpers/preload/unhandledRejection.cjs`
- `mock-redis/server.mjs` (always, also without `MOCK_REDIS`: `tests/platform/mock.spec.ts` starts it; replaces
  an app's own copy)
- `scripts/test-image.sh`

`.github/workflows/e2e.yml` is managed by Terraform (config_texts), not copied by hand.

Moving app edits out of them:

- `playwright.config.ts`: inline env (`const appEnv = {...}`) goes to `APP_ENV` in `app.config.ts`, minus what
  `appEnv.ts` already sets (`PORT`, `NODE_ENV`, `INSTANCE_*`, `INTERACTIVE_*`, `API_KEY`, AWS/S3, `COMMIT_HASH`,
  `TZ`). A mock-redis webServer entry becomes `MOCK_REDIS = true` (drop `MOCK_REDIS_PORT` and `REDIS_URL` /
  `REDIS_CLUSTER_MODE` from `app.config.ts` and `constants.ts`). Any other extra server goes to
  `EXTRA_WEB_SERVERS`. `grepInvert: /unknown pages fall back.../` becomes `APP_SHELL_FALLBACK = false`. A desktop
  viewport becomes `test.use({ viewport: { width: 1280, height: 720 } })` in the specs that need it. A
  hardcoded `/api/system/health` URL becomes `HEALTH_PATH`.
- `constants.ts`: app constants (e.g. jukebox's `GOOGLE_API_KEY`) move to `app.config.ts` or the spec that
  uses them; update their imports.

### 2. Merge the app-extended files

These hold the app's own code on top of the boilerplate's. Take the boilerplate's current file and re-apply
the app's additions (diff the app's copy against the boilerplate commit it was copied from to find them):

- `mock-topia/server.mjs`: keep the app's routes and fakes (external APIs, app-specific endpoints). Drop app
  copies of routes the boilerplate now has (visitors list/get, `assets-with-unique-name`, asset list and
  delete, `set-clickable-link-multi`, `change-click-type`/`change-media-type`, `set-private-zone`,
  `set-asset-interactive-settings`, `set-custom-text`, `drop-scene`, `scenes/:id`, `world-details`, expressions and
  `grant-expression`, `grant-user-inventory-item`, `get-user-inventory-items`,
  `update-visitor-inventory-item-quantity`, `user-group-data-object`, NPC and voice-session routes,
  `auth/interactive-credentials`, `/hooks/*`, S3, `/images/*`): the boilerplate's follow the real API more
  closely and `mock.spec.ts` checks them. Extra seed fields an app route reads go through the seed body as is.
- `fixtures.ts`: keep the app's seed options and helpers on top of the boilerplate's `SeedOptions` /
  `TopiaWorld`.
- `app.config.ts`: keep the app's values. Add the new exports only where needed (every read has a default):
  `ERROR_KNOWN_BUGS`, `MALFORMED_JSON_REQUEST`, `ENTRY_PAGE_KNOWN_BUGS.callsOtherOrigin`, `knownBugs.answersNever`,
  `MOCK_REDIS`, `EXTRA_WEB_SERVERS`.
- `tests/app/**` and `mock-topia/catalog.json`: the app's own; only adjust them for the behaviour changes below.
- App-specific e2e notes (what the app's tests cover, its known bugs, seeding quirks) go in
  `e2e/tests/app/README.md`, not in `e2e/README.md`, which is copied verbatim and would lose them on the next
  sync. Move any such notes out of an app's old `e2e/README.md` before overwriting it.

### 3. Run and triage

`npm test` (with the app's ports), then fix what flipped using the list below. Every new `test.fail` marker
gets its tracking reason and is checked by removing it once (the test must fail on the expected assertion).
Finish with `npx playwright test --repeat-each=3`, push, and wait for the PR's `E2E` check.

Behaviour changes since c5b7d55 that can flip app tests (apps copied earlier also get the ones before it):

Platform tests and config:

1. New test "a promise rejection nobody handles doesn't take the server down": fails in every app until
   `PROCESS_KNOWN_BUGS.exitsOnUnhandledRejection` is set (all apps have the bug, see Known bugs).
2. New test "a malformed JSON body gets a 400 without a stack trace or server paths": apps without an error
   middleware fail on the stack trace: set `ERROR_KNOWN_BUGS.malformedJson`. A 404 means the default request
   missed the parser: set `MALFORMED_JSON_REQUEST`. `null` for apps that parse no JSON.
3. New test "the page calls its own server, not a hardcoded origin" (skipped with `ENTRY_PAGE = null`): fails
   for pages with a hardcoded API base (`ENTRY_PAGE_KNOWN_BUGS.callsOtherOrigin`), and like the secrets scan it
   needs one `/api` call to the app's origin on load unless `ENTRY_PAGE_SCAN = "all"`.
4. `crashesServer` now moves all three credential tests of the route to private instances; the two
   foreign-credential tests count an instance that went down as `crashesServer` and otherwise check as usual
   with their own markers. A private instance that fails to start fails the test instead of satisfying
   `test.fail`.
5. The secrets scan's "the route didn't get the credentials" matches `/missing required (\w+ )*parameters/i`,
   so "Missing required body parameters" now counts: fix the route's `credentialsIn` / `credentialsKey`.
6. Platform calls give up after 10s (`ANSWER_TIMEOUT_MS`): a route that hangs fails with "didn't answer within
   10000ms" instead of the 30s test timeout; mark it `answersNever` (and see `answersNever` above).
7. `withPrivateServer` watches for an exit for `settleMs` (default 500ms) after `use` returns: drop waits
   inside `use` that only existed to catch a late crash and pass `{ settleMs }` instead.
8. Pages render at drawer width (400x900) and in UTC: UI tests that relied on a desktop layout can find
   elements hidden or overlapping (`test.use({ viewport })`). Fake S3 is always wired with dummy AWS
   credentials and `S3_BUCKET` blank unless `APP_ENV` sets `FAKE_S3_BUCKET`; apps reading AWS credentials
   under other names must blank them in `APP_ENV`.

mock-topia:

9. Visitor and user data objects are one record per profile: `visitorData` and `userData` (and the app's
   `Visitor` / `User` writes) see the same object.
10. Calls outside `/world/` (inventory, user data objects, expressions, scenes, ...) belong to the world in the
    caller's JWT, so seeded `delays`, `failures`, catalogs and analytics apply to them.
11. Analytics: a write's analytics get `urlSlug` set to the authenticated world, whatever the app sent;
    `public-key-analytics` logs each analytic in the session's world (JWT `urlSlug`) with extra fields
    `sentUrlSlug`, `sessionVisitorId`, `source: "public-key"`, and drops per-player names
    (`<name>-<20-char id>`, logged as `analytics-rejected`). Exact `toEqual` on analytics events fails: use
    `expect.objectContaining`.
12. `assets-with-unique-name` with `partial` is a prefix match (not a substring), and any `partial` value
    counts, `partial=false` included.
13. `DELETE /world/:slug/assets/:id` answers `{ success: true }` (was `{}`) and 404 for an asset that doesn't
    exist, so deleting twice is now an error in the app.
14. Seeded visitors have `username` (`e2e-player`, `player-<id>`): exact `toEqual` on visitor objects fails.
15. `GET /world/:slug/visitors/:id` answers a map keyed by visitorId like the real route: an app mock that
    overrides it with the bare visitor must drop the override.
16. `update-visitor-inventory-item-quantity` has the real semantics: an upsert that adds `quantity` as a delta
    (`delta || 1`, so 0 counts as +1), no floor at 0 (reads hide entries at 0 or below), the user item's
    metadata reset to `{}`, 201 with the real fields (`inventoryItem` is the user item id), `modify-item`
    events `{ name, quantity: delta, total }`.
17. Inventory entries: `metadata` is the user item's own (default `{}`), the catalog's is in `itemMetadata` and
    `item.metadata`; the default catalog is `mock-topia/catalog.json` when present.
18. Route handlers are `(params, body, query, world, holdMs, req)`: old `(params, body, query)` handlers keep
    working; one that used a fourth parameter for something else must move it. `world` is the seeded world or
    undefined.
19. An `Authorization` header without `publickey` / `interactivejwt` is API-key mode: only `E2E_API_KEY` is
    accepted (unknown key 404, unseeded world 401). An app that calls the API with its own key needs
    `APP_ENV = { API_KEY: E2E_API_KEY }`; a test sending `Authorization` gets the same rules. World routes also
    answer under `/api/world/...`.
20. Routes added since the error-format check answer `{ errors: [{ message }] }`, so the SDK error's message is
    the real text there (it was axios' "Request failed with status code N").
21. `GET /world/:slug/visitors` filters by `?droppedAssetId=` and lists NPCs created with the app's key.
22. `failures` / `delays` keys also match the query string, so a short key can now match more calls.
23. `extraAssets` get `id` = their key unless they name one: exact `toEqual` on such an asset needs the `id`.
24. `GET /scenes/:sceneId` exists: an app calling `Scene.get` used to fail as unhandled and now gets the seeded
    `scenes` entry or `null`.
25. mock-redis answers an error for commands it doesn't implement (app copies answered OK to anything): a
    Redis call that "worked" before may now reject; add the command to the boilerplate's mock-redis.
26. `grant-expression` for an expression the visitor already owns answers 200 `{ statusCode: 409 }` (was HTTP
    409), an unknown expression 200 `{ statusCode: 404 }` (was HTTP 404), like the real route: the SDK call now
    resolves with that body instead of throwing. App code that relied on the throw has a real bug; an app mock
    override that answered 409 can go.
27. NPC players (`create-npc`, `get-npc`, NPCs in the visitors list) carry `isNPCFromKey`: exact `toEqual` on
    them needs it (or `toMatchObject`); an app mock that added it can drop its override.
28. `set-custom-text` is in the boilerplate (stores the flat style fields, answers `textStyle`, 400 for an asset
    with another `specialType`): drop the app's copy. The event is unchanged (`{ ...body, type, assetId }`).
29. User data objects are per world (they were global per `profileId`): fixed `profileId`s in `otherVisitors`
    / `users` no longer collide across parallel tests, so hand-rolled per-test suffixes can go (keeping them
    is harmless). A test that read one profile's user data from two worlds would now see two records.
    `world.userData(profileId)` reads this world's copy (`/__mock/users/:id?world=<urlSlug>`). App mock routes
    that use the user store take the world first: `getUser(slug, profileId)`, `visitorRecord(slug, visitor)`
    (a one-argument `getUser` throws; user routes get the slug from `jwtPayload(req.headers.interactivejwt)`).
30. `TopiaWorld.request` is `protected`: a subclass can use it for mock-topia control routes instead of keeping
    its own copy of the request context.
