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

Ports: app `3100`, mock `3101` (override with `APP_PORT` / `MOCK_TOPIA_PORT`).

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

## Layout

| Path | What it is | When forking into a new app |
|---|---|---|
| `tests/platform/` | Checks every SDK app must pass: health endpoint contract, app shell fallback, credential checks, the interactive secret never reaching the browser (`callRoute.ts` sends each route its credentials), the process surviving an unhandled promise rejection | Keep identical; only edit `app.config.ts` |
| `app.config.ts` | The app's credentialed routes, their known bugs, the entry page, the app shell marker, health/process known bugs and test-only app env | See below |
| `appEnv.ts` | The app's environment under test (mock Topia, fake S3, dummy AWS credentials, `COMMIT_HASH`/`TZ` locally) plus `APP_ENV`; used by the shared server, private instances and the Docker image | Keep identical; app variables go in `APP_ENV` |
| `tests/app/` | Tests for the boilerplate's example page | Replace with tests for the app's own pages and rules |
| `fixtures.ts` | `world.seed({...})` builds one isolated Topia world per test; `world.url()` / `world.api()` / `world.credentials()` add the session credentials Topia appends (the nonce is unique per world) | Extend `seed` for the app's data objects |
| `helpers/` | Shared test helpers apps import as needed. `leaderboardForgery.ts`: `forgeDisplayName(world, [999999])` for the `name\|score` leaderboard forgery. `sse.ts`: `openStream(world.api("/sse"))` reads an SSE stream from Node (`status`, `messages`, `close()`). `privateServer.ts`: `withPrivateServer(async (origin) => ..., { unhandledRejection?, env? })` runs a throwaway app instance for tests that may crash it, resolving `{ result, error, alive, output }`. `press.ts`: `press(locator)` clicks by dispatching the event, for 0x0 icon-only buttons (see `stubSdkIcons`) | Keep; import from `tests/app` |
| `mock-topia/server.mjs` | Fake Topia public API. Like the real one, world routes and `public-key-analytics` reject calls with neither an API key nor an interactive JWT carrying a nonce | Add routes for any endpoint the app calls that isn't there |
| `mock-topia/catalog.json` (optional) | The app's default inventory catalog (array of `{ id, name, type, status?, description?, image_path?, metadata? }`); without it the default is four Quiz badges | Add one if the app caches the catalog process-wide (see `inventoryItems`) |

### `app.config.ts`

| Export | What to set |
|---|---|
| `CREDENTIALED_ROUTES` | Every route that calls `getCredentials`: `{ method, path, data?, query?, knownBugs?, credentialsIn?, credentialsKey?, basePath? }`. `credentialsIn: "body"` for webhooks that read `getCredentials(req.body)` (credentials go as top-level JSON fields instead of the query string). `credentialsKey: "interactiveParams"` for routes that read them nested in the body (`getCredentials(req.body.interactiveParams)`; implies `"body"`). `query: { q: "x" }` for routes that need query parameters besides the credentials (a GET that answers early without them would make the secrets scan vacuous). `basePath` if the router isn't mounted on `/api` (e.g. `"/webhook"`). `knownBugs`: `leaksSecret`, `acceptsMissingCredentials`, `acceptsForeignCredentials`, `unnamedCredentialError`, `crashesServer` (see below). |
| `ENTRY_PAGE` | The page Topia opens in the iframe, or `null` if the app has no page (webhooks only, e.g. connect4): the page-load and app-shell tests are skipped. |
| `ENTRY_PAGE_KNOWN_BUGS` | `leaksSecret` if loading the page leaks the secret. |
| `APP_SHELL_MARKER` | Text the app shell's HTML contains, if the page isn't a React root (e.g. Unity, Next.js `id="__next"`). |
| `APP_SHELL_FALLBACK` | `false` for apps with real page routes that answer unknown paths with a 404 (e.g. Next.js): skips "unknown pages fall back to the app shell" instead of a `grepInvert`. Default `true`. |
| `HEALTH_KNOWN_BUGS` | `{ incompleteContract: "<reason>" }` for apps whose health endpoint lacks fields of the contract (typically `envs.COMMIT_HASH` / `envs.BUILD_TIME` in apps forked before them, or `NODE_ENV` baked in by Next.js), instead of changing app code in the e2e PR. |
| `PROCESS_KNOWN_BUGS` | `{ exitsOnUnhandledRejection: "<reason>" }` while a promise rejection nobody handles exits the process. Every app has it today: `@rtsdk/topia` registers an `unhandledRejection` hook that calls `process.exit(1)`, and an app's own logging handler doesn't stop it. Fix: `process.removeAllListeners("unhandledRejection")` before registering the app's handler. |
| `APP_ENV` | Test-only app environment, merged over `appEnv.ts`: an object, or a function of the mock's address as the app reaches it (`({ host, url }) => ({ GOOGLE_API_ROOT_URL: `${url}/` })`). Blank every variable that would reach a real service. Older `app.config.ts` files without `HEALTH_KNOWN_BUGS`, `PROCESS_KNOWN_BUGS`, `APP_ENV` or `APP_SHELL_FALLBACK` keep working. |

`crashesServer`: some routes call `getCredentials` outside any try/catch, so a request without credentials
becomes an unhandled rejection and `@rtsdk/topia`'s hook exits the process. The "rejects a request
without session credentials" test would take the shared server down and every later test fails with
`ECONNREFUSED`; if that happens right after one of those tests, set `crashesServer` on the route. The
test then runs against a private instance (`helpers/privateServer.ts`), expects it to stay up, and is
marked `test.fail` until the route is fixed. Only that test is moved: the others send credentials.

Leave server-sent-event routes (e.g. `GET /sse`) out of `CREDENTIALED_ROUTES`: with valid credentials
the stream never ends, so the platform tests can't read the body and time out. Test their credential
checks in `tests/app`. If a route reads its credentials somewhere the platform tests don't send them,
`secrets.spec.ts` fails with "the route didn't get the credentials" instead of passing vacuously.

### Fixtures

`world.seed({...})` options besides the basics (`isAdmin`, `inZone`, `withAsset`, `asset`, `assetData`, `worldData`, `visitorData`, `badges`, `extraAssets`):

| Option | What it does |
|---|---|
| `latencyMs`, `delays: { "<substring of 'METHOD /api/v1/...'>": ms }` | Hold every / matching public-API call, so concurrent requests overlap deterministically. |
| `holdLocksDuringDelay: true` | Data-object writes with a `lockId` take the lock first and hold it for their delay, so a concurrent write with the same `lockId` gets 409 like the real API (see "Races" below). |
| `failures: { "<substring>": status }` | Answer matching public-API calls with that status (logged as `injected-failure` events), e.g. `{ "grant-visitor-inventory-item": 500 }`. Change mid-test with `world.setFailures({...})`; `world.setFailures()` stops them. |
| `inventory: [{ item, quantity?, metadata? }]` | Catalog items the visitor owns, any type: `item` is a catalog id or name, `quantity` defaults to 1, `metadata` is the user item's own (default `{}`). An unknown item fails the seed. `badges: ["name"]` stays the shorthand for badges. |
| `otherVisitors: { [visitorId]: { isAdmin?, inZone?, visitorData?, badges?, inventory?, profileId?, displayName?, ...fields } }` | More players in the world. Defaults: `profileId` `<world.profileId>-v<id>` (unique per world), `displayName` `Player <id>`, in the zone. |
| `visitor: {...}` | Extra fields on the test's own visitor (e.g. `expressions: ["emote-wave"]` it owns). |
| `users: { [profileId]: dataObject }` | Data objects of profiles that aren't in the world. |
| `inventoryItems: [{ id, name, type, status?, metadata?, ... }]` | The ecosystem inventory catalog for this world (default: `mock-topia/catalog.json`, else four Quiz badges). Apps that cache the catalog process-wide (an inventory cache) keep whichever world loaded it first, so per-world catalogs don't work for them: put the app's catalog in `mock-topia/catalog.json` instead and don't seed `inventoryItems`. |
| `expressions: [{ id, name, ... }]` | Unlockable expressions for this world (default: Wave, Dance). |
| `worldDetails: {...}` | Fields `GET /world-details` (`World.fetchDetails`) returns over the default `{ urlSlug, name, width: 4000, height: 4000 }`. |

Profiles are global in the mock (one user data object per `profileId`, across worlds). An explicit
`profileId` in `otherVisitors` or a `users` key like `"alice"` is shared by every test that uses it and
collides when they run in parallel: derive it from the world with `world.scopedId("alice")`
(`<world.profileId>-alice`).

Acting as another player: `world.url("/", world.as(43))`, `request.post(world.apiAs(43, "/join"))`,
`world.player(43)` (`{ visitorId, profileId, displayName }`). `world.as(id)` gives each player their own
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
- A visitor's data object is its user's data object (one record per profile, like the real API): `Visitor` and `User` reads and writes for the same `profileId` see the same data.
- `GET /world/:slug/visitors`, `GET /world/:slug/assets-with-unique-name/:name` (`partial=true`), `PUT /user/inventory/:profileId/grant-user-inventory-item` (every visitor with that profile in the caller's world gets it), `GET /expressions` + `PUT .../visitors/:id/grant-expression/:id` (409 when already owned), `change-click-type`, `change-media-type` (sets `mediaPlayTime`, like a restart).
- Fake S3 under `/s3/<bucket>/<key>` (PUT incl. aws-chunked uploads, GET, HEAD, DELETE; `world.s3Objects()`). `appEnv.ts` always points `AWS_ENDPOINT_URL_S3` there with dummy credentials real AWS rejects and disables EC2 metadata, so a local run can't write to a real bucket even through an app's hardcoded fallback bucket name. `S3_BUCKET` stays empty; opt in with `APP_ENV = { S3_BUCKET: FAKE_S3_BUCKET }` (the underscore forces path-style URLs; a DNS-valid bucket name needs `forcePathStyle` in the app's client). Apps that read AWS credentials under other variable names (e.g. from `../.env`) must blank those in `APP_ENV`.
- `GET /images/<anything>` answers a 1x1 PNG, for seeded image URLs the server downloads (`${MOCK_TOPIA_URL}/images/x.png`).
- `GET /world/:slug/assets/:id` returns the asset with its `dataObject`, like the real API (`DroppedAsset.get` fills `droppedAsset.dataObject` from it).
- Data-object writes (`set`, `update` and `increment-data-object-value`, on world, asset, visitor and user) honour `lock`: a held `lockId` answers 409, `releaseLock: true` frees it after the write, otherwise it stays held. Locks are per data object. By default the write takes and frees the lock in one step after its delay; `holdLocksDuringDelay` holds it for the delay.
- `GET /world/:slug/visitors/:id` answers a map keyed by visitorId, like the real route (`getVisitors`); `Visitor.fetchVisitor` reads `response.data[id]`.
- `analytics` sent with a successful write are logged as `analytics` events; `particles` events carry `particleName`.
- Particle names (`GET /particles?name=`): the mock accepts a fixed list (`brain_float`, `partyPopper_float`, `confetti_float`, `explosion_float`, `sparkles_float`, `blueSmoke_puff`, `whiteStar_burst`, `musicNote_float`, `Firework`, `confetti_1`). Names were added because apps use them, not checked against the real catalog: a passing test doesn't prove the platform has the particle, so check new names separately.
- Visitor inventory entries have the real fields (`id`, `item_id`, `itemId`, `quantity`, `metadata` (the user item's), `itemMetadata`, `name`, `description`, `image_url`, `type`, `status`) plus the nested `item` (with the catalog `metadata`). Granting an owned item adds to its quantity. Like the real reads, entries at quantity 0 or below aren't returned.
- `PUT .../visitors/:id/update-visitor-inventory-item-quantity` (`Visitor.modifyInventoryItemQuantity`) mirrors `grantOrUpdateInventoryItemQuantity`: an upsert by item (`itemId`, or `userItemId` of an owned entry) that adds `quantity` as a delta, `delta || 1` (0 counts as +1), no floor at 0, metadata reset to `{}`; answers 201 with the real fields (`inventoryItem` is the user item id, no `user_id`). Logged as `modify-item` events `{ name, quantity: delta, total }`.
- `GET /user/inventory/:profileId/get-user-inventory-items` (`User.fetchInventoryItems`): the inventory that profile's visitor carries in the caller's world.
- `GET /world/:slug/assets` (`World.fetchDroppedAssets`, without data objects), `PUT .../assets/:id/set-clickable-link-multi` (replaces `clickableLinks`, keeps `existingLinkId`, new links get a `linkId`; logged as an event), `GET /world/:slug/world-details`.
- `PUT /analytics/public-key-analytics` needs an API key or an interactive JWT, like the real route (`interactiveKeyValidator` + `gameEngineValidator`), and logs each analytic in its `urlSlug`'s world as an `analytics` event with `source: "public-key"`.
- `PATCH /__mock/worlds/:slug/visitors/:id` (`world.updateVisitor({...})`) changes visitor fields mid-test. Route handlers may be async.
- Latency, so concurrent requests overlap like they do against the real API: `world.seed({ latencyMs: 25 })` delays every public-API call into the world; `world.seed({ delays: { "/visitors/42/set-data-object": 400 } })` delays only calls whose `METHOD /api/v1/world/...` contains the key, so a test can line two requests up deterministically.
- The browser may only reach localhost: `fixtures.ts` aborts every other request. It runs in UTC like the app (`timezoneId` in `playwright.config.ts`); a test can pick another zone with `test.use({ timezoneId })`.
- `interactiveNonce` is `e2e-nonce-<urlSlug>`, so apps that key state by nonce across worlds (SSE connections, caches) don't mix up parallel tests.

### Event fields

`world.events(type)` returns the SDK's request body plus `type` (and `visitorId` for visitor calls), so
the field names are the SDK's, not the method's arguments:

- `move`: `{ moveTo: { x, y }, teleport }` (`moveVisitor({ shouldTeleportVisitor, x, y })`).
- `set-activity`: the activity type is `webhookType` (the body's own `type` is replaced by `"set-activity"`), plus `assetId`.
- `close-iframe`: `{ droppedAssetId }`; `open-iframe` and `fire-toast` carry their params as sent.
- `webhooks`: the body's `type` is `webhookType` too.

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
| Fake Redis (`mock-redis/`) and scenes | sdk-race#53 |
| NPCs and expressions | virtual-pet#54 |
| JWT signature checks, multi-app and ecosystem data objects | sdk-leaderboard#13 |
| `set-custom-text` | sdk-tictactoe#41 |
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

## Known gaps

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
- Server-wide background timers (a `setInterval` sweeping every game for timeouts, cleanups, ...) run
  across all worlds and can't be paused with `page.clock`, which only controls the browser. Seed state the
  timer leaves alone (e.g. a fresh `turnStartedAt`), or wait for its effect with `expect.poll` and a
  timeout longer than its interval; never assume it hasn't run yet.
