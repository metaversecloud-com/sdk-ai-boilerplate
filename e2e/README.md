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

## Layout

| Path | What it is | When forking into a new app |
|---|---|---|
| `tests/platform/` | Checks every SDK app must pass: health endpoint contract, app shell fallback, credential checks, the interactive secret never reaching the browser (`callRoute.ts` sends each route its credentials) | Keep identical; only edit `app.config.ts` |
| `app.config.ts` | The app's credentialed routes, their known bugs, the entry page and the app shell marker | See below |
| `tests/app/` | Tests for the boilerplate's example page | Replace with tests for the app's own pages and rules |
| `fixtures.ts` | `world.seed({...})` builds one isolated Topia world per test; `world.url()` / `world.api()` / `world.credentials()` add the session credentials Topia appends (the nonce is unique per world) | Extend `seed` for the app's data objects |
| `helpers/` | Shared test helpers apps import as needed. `leaderboardForgery.ts`: `forgeDisplayName(world, [999999])` for the `name\|score` leaderboard forgery | Keep; import from `tests/app` |
| `mock-topia/server.mjs` | Fake Topia public API. Like the real one, world routes and `public-key-analytics` reject calls with neither an API key nor an interactive JWT carrying a nonce | Add routes for any endpoint the app calls that isn't there |

### `app.config.ts`

| Export | What to set |
|---|---|
| `CREDENTIALED_ROUTES` | Every route that calls `getCredentials`: `{ method, path, data?, knownBugs?, credentialsIn?, basePath? }`. `credentialsIn: "body"` for webhooks that read `getCredentials(req.body)` (credentials go as top-level JSON fields instead of the query string). `basePath` if the router isn't mounted on `/api` (e.g. `"/webhook"`). |
| `ENTRY_PAGE` | The page Topia opens in the iframe, or `null` if the app has no page (webhooks only, e.g. connect4): the page-load and app-shell tests are skipped. |
| `ENTRY_PAGE_KNOWN_BUGS` | `leaksSecret` if loading the page leaks the secret. |
| `APP_SHELL_MARKER` | Text the app shell's HTML contains, if the page isn't a React root (e.g. Unity). |

Leave server-sent-event routes (e.g. `GET /sse`) out of `CREDENTIALED_ROUTES`: with valid credentials
the stream never ends, so the platform tests can't read the body and time out. Test their credential
checks in `tests/app`. If a route reads its credentials somewhere the platform tests don't send them,
`secrets.spec.ts` fails with "the route didn't get the credentials" instead of passing vacuously.

Every test gets its own world, so the suite runs fully in parallel. Each test also fails if the app
calls a public-API endpoint the mock doesn't implement, so an `@rtsdk/topia` upgrade that starts using
new endpoints can't pass silently. A full app example lives in sdk-quiz (`e2e/tests`).

## What the mock mirrors

- `GET /world/:slug/assets/:id` returns the asset with its `dataObject`, like the real API (`DroppedAsset.get` fills `droppedAsset.dataObject` from it).
- Data-object writes (`set`, `update` and `increment-data-object-value`, on world, asset, visitor and user) honour `lock`: a held `lockId` answers 409, `releaseLock: true` frees it after the write, otherwise it stays held. Locks are per data object.
- `analytics` sent with a successful write are logged as `analytics` events; `particles` events carry `particleName`.
- Visitor inventory entries have the real top-level fields (`name`, `image_url`, `type`, `item_id`, `itemId`, `quantity`, `status`) plus the nested `item`. Granting an owned item adds to its quantity.
- `PUT /analytics/public-key-analytics` needs an API key or an interactive JWT, like the real route (`interactiveKeyValidator` + `gameEngineValidator`), and logs each analytic in its `urlSlug`'s world as an `analytics` event with `source: "public-key"`.
- `PATCH /__mock/worlds/:slug/visitors/:id` (`world.updateVisitor({...})`) changes visitor fields mid-test. Route handlers may be async.
- Latency, so concurrent requests overlap like they do against the real API: `world.seed({ latencyMs: 25 })` delays every public-API call into the world; `world.seed({ delays: { "/visitors/42/set-data-object": 400 } })` delays only calls whose `METHOD /api/v1/world/...` contains the key, so a test can line two requests up deterministically.
- The browser may only reach localhost: `fixtures.ts` aborts every other request. It runs in UTC like the app (`timezoneId` in `playwright.config.ts`); a test can pick another zone with `test.use({ timezoneId })`.
- `interactiveNonce` is `e2e-nonce-<urlSlug>`, so apps that key state by nonce across worlds (SSE connections, caches) don't mix up parallel tests.

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

## Known bugs

Tests for bugs that still exist are marked `test.fail(...)`: they pass while the bug is there and
fail with "Expected to fail, but passed" once it's fixed, so the marker is removed in the same change
as the fix. In `tests/platform/` the markers come from `knownBugs` on each route in `app.config.ts`
(and `ENTRY_PAGE_KNOWN_BUGS` for the page load), so the specs stay identical across apps.

| Test | Bug | Fix |
|---|---|---|
| `platform/credentials.spec.ts` "names the credential problem" (`unnamedCredentialError`) | `getCredentials` returns `{ error }` instead of throwing, so requests with bad credentials carry on and fail later on a Topia call. | Throw from `getCredentials` (protected file: needs explicit approval). Tracked in EXP-428. |

The interactive secret leak (EXP-429) is fixed here: `server/index.ts` registers the
`cleanReturnPayload` scrubber on `/api` before the routes, and the scrubber also strips
`interactiveSecret` from SDK errors. Apps forked earlier register it after the routes, where it
never runs; set `leaksSecret` on the routes that leak until they take the same fix.

## Conventions

- New tests are mutation-checked: break the behavior in the app and confirm the test goes red.
- Before merging, `npx playwright test --repeat-each=3` must pass every time.
