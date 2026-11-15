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

First run in a repo forked from an older boilerplate:

- If the root `.gitignore` ignores `package-lock.json`, track the e2e lockfile anyway (CI runs `npm ci`
  in `e2e/`): `git add -f e2e/package-lock.json`.
- If the root `npm start` sources `commit_info.txt` (written by the release build), create it first:
  `touch commit_info.txt` (untracked; the local run gets `COMMIT_HASH=local` from `appEnv.ts`).

## Layout

| Path | What it is | When forking into a new app |
|---|---|---|
| `tests/platform/` | Checks every SDK app must pass: health endpoint contract, app shell fallback, credential checks, the interactive secret never reaching the browser (`callRoute.ts` sends each route its credentials), the process surviving an unhandled promise rejection | Keep identical; only edit `app.config.ts` |
| `app.config.ts` | The app's credentialed routes, their known bugs, the entry page, the app shell marker, health/process known bugs and test-only app env | See below |
| `appEnv.ts` | The app's environment under test (mock Topia, fake S3, dummy AWS credentials, `COMMIT_HASH`/`TZ` locally) plus `APP_ENV`; used by the shared server, private instances and the Docker image | Keep identical; app variables go in `APP_ENV` |
| `tests/app/` | Tests for the boilerplate's example page | Replace with tests for the app's own pages and rules |
| `fixtures.ts` | `world.seed({...})` builds one isolated Topia world per test; `world.url()` / `world.api()` / `world.credentials()` add the session credentials Topia appends (the nonce is unique per world) | Extend `seed` for the app's data objects |
| `helpers/` | Shared test helpers apps import as needed. `leaderboardForgery.ts`: `forgeDisplayName(world, [999999])` for the `name\|score` leaderboard forgery. `sse.ts`: `openStream(world.api("/sse"))` reads an SSE stream from Node (`status`, `messages`, `close()`). `privateServer.ts`: `withPrivateServer(async (origin) => ..., { unhandledRejection?, env? })` runs a throwaway app instance for tests that may crash it, resolving `{ result, error, alive, output }` | Keep; import from `tests/app` |
| `mock-topia/server.mjs` | Fake Topia public API. Like the real one, world routes and `public-key-analytics` reject calls with neither an API key nor an interactive JWT carrying a nonce | Add routes for any endpoint the app calls that isn't there |

### `app.config.ts`

| Export | What to set |
|---|---|
| `CREDENTIALED_ROUTES` | Every route that calls `getCredentials`: `{ method, path, data?, knownBugs?, credentialsIn?, basePath? }`. `credentialsIn: "body"` for webhooks that read `getCredentials(req.body)` (credentials go as top-level JSON fields instead of the query string). `basePath` if the router isn't mounted on `/api` (e.g. `"/webhook"`). `knownBugs`: `leaksSecret`, `acceptsMissingCredentials`, `acceptsForeignCredentials`, `unnamedCredentialError`, `crashesServer` (see below). |
| `ENTRY_PAGE` | The page Topia opens in the iframe, or `null` if the app has no page (webhooks only, e.g. connect4): the page-load and app-shell tests are skipped. |
| `ENTRY_PAGE_KNOWN_BUGS` | `leaksSecret` if loading the page leaks the secret. |
| `APP_SHELL_MARKER` | Text the app shell's HTML contains, if the page isn't a React root (e.g. Unity). |
| `HEALTH_KNOWN_BUGS` | `{ incompleteContract: "<reason>" }` for apps whose health endpoint lacks fields of the contract (typically `envs.COMMIT_HASH` / `envs.BUILD_TIME` in apps forked before them), instead of changing app code in the e2e PR. |
| `PROCESS_KNOWN_BUGS` | `{ exitsOnUnhandledRejection: "<reason>" }` while a promise rejection nobody handles exits the process. Every app has it today: `@rtsdk/topia` registers an `unhandledRejection` hook that calls `process.exit(1)`, and an app's own logging handler doesn't stop it. Fix: `process.removeAllListeners("unhandledRejection")` before registering the app's handler. |
| `APP_ENV` | Test-only app environment, merged over `appEnv.ts`: an object, or a function of the mock's address as the app reaches it (`({ host, url }) => ({ GOOGLE_API_ROOT_URL: `${url}/` })`). Blank every variable that would reach a real service. Older `app.config.ts` files without the last three exports keep working. |

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
| `failures: { "<substring>": status }` | Answer matching public-API calls with that status (logged as `injected-failure` events), e.g. `{ "grant-visitor-inventory-item": 500 }`. |
| `otherVisitors: { [visitorId]: { isAdmin?, inZone?, visitorData?, badges?, profileId?, displayName?, ...fields } }` | More players in the world. Defaults: `profileId` `<world.profileId>-v<id>`, `displayName` `Player <id>`, in the zone. |
| `visitor: {...}` | Extra fields on the test's own visitor (e.g. `expressions: ["emote-wave"]` it owns). |
| `users: { [profileId]: dataObject }` | Data objects of profiles that aren't in the world. |
| `inventoryItems: [{ id, name, type, status?, metadata?, ... }]` | The ecosystem inventory catalog for this world (default: four Quiz badges). |
| `expressions: [{ id, name, ... }]` | Unlockable expressions for this world (default: Wave, Dance). |

Acting as another player: `world.url("/", world.as(43))`, `request.post(world.apiAs(43, "/join"))`,
`world.player(43)` (`{ visitorId, profileId, displayName }`). `world.as(id)` gives each player their own
nonce, like separate drawers. Reading state: `world.visitorData(43)`, `world.userData(profileId)`,
`world.assetData()`, `world.events(type)`, `world.s3Objects()`.

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
- Data-object writes (`set`, `update` and `increment-data-object-value`, on world, asset, visitor and user) honour `lock`: a held `lockId` answers 409, `releaseLock: true` frees it after the write, otherwise it stays held. Locks are per data object.
- `analytics` sent with a successful write are logged as `analytics` events; `particles` events carry `particleName`.
- Visitor inventory entries have the real top-level fields (`name`, `image_url`, `type`, `item_id`, `itemId`, `quantity`, `status`) plus the nested `item`. Granting an owned item adds to its quantity.
- `PUT /analytics/public-key-analytics` needs an API key or an interactive JWT, like the real route (`interactiveKeyValidator` + `gameEngineValidator`), and logs each analytic in its `urlSlug`'s world as an `analytics` event with `source: "public-key"`.
- `PATCH /__mock/worlds/:slug/visitors/:id` (`world.updateVisitor({...})`) changes visitor fields mid-test. Route handlers may be async.
- Latency, so concurrent requests overlap like they do against the real API: `world.seed({ latencyMs: 25 })` delays every public-API call into the world; `world.seed({ delays: { "/visitors/42/set-data-object": 400 } })` delays only calls whose `METHOD /api/v1/world/...` contains the key, so a test can line two requests up deterministically.
- The browser may only reach localhost: `fixtures.ts` aborts every other request. It runs in UTC like the app (`timezoneId` in `playwright.config.ts`); a test can pick another zone with `test.use({ timezoneId })`.
- `interactiveNonce` is `e2e-nonce-<urlSlug>`, so apps that key state by nonce across worlds (SSE connections, caches) don't mix up parallel tests.

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
- Races on a lock that the first write releases (`releaseLock: true`): `latencyMs` alone doesn't line the
  two requests up reliably. Put an explicit delay on the write, e.g.
  `delays: { "/update-data-object": 400 }`, so the second request arrives while the first holds the lock.
- Server-wide background timers (a `setInterval` sweeping every game for timeouts, cleanups, ...) run
  across all worlds and can't be paused with `page.clock`, which only controls the browser. Seed state the
  timer leaves alone (e.g. a fresh `turnStartedAt`), or wait for its effect with `expect.poll` and a
  timeout longer than its interval; never assume it hasn't run yet.
