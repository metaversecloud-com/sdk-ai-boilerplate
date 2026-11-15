// Per-app settings for the shared platform tests in tests/platform. Every app edits this file;
// the platform specs themselves stay identical across SDK apps.
import type { Page } from "@playwright/test";
import type { TopiaWorld } from "./fixtures";

/**
 * Bugs a route still has, each set to its tracking reason (e.g. "EXP-429: ..."). The matching
 * platform test is marked test.fail: it passes while the bug exists and fails once it's fixed, so
 * the entry is removed together with the fix. Leave out what the route doesn't have.
 */
export type KnownBugs = {
  /** The response contains the interactive secret or a signed InteractiveJWT. */
  leaksSecret?: string;
  /** A request without session credentials succeeds. */
  acceptsMissingCredentials?: string;
  /** Credentials signed for another app's public key are accepted. */
  acceptsForeignCredentials?: string;
  /** Bad credentials fail later on a Topia call instead of with a credential error. */
  unnamedCredentialError?: string;
  /**
   * A request without session credentials takes the app process down (e.g. getCredentials throws
   * outside any try/catch, and @rtsdk/topia's unhandledRejection hook calls process.exit(1)). All three
   * credential tests then run against private app instances (helpers/privateServer.ts) instead of the
   * shared one, so they can't kill the server mid-suite. The missing-credentials test fails while the bug
   * exists; the foreign-credentials ones count an instance that went down as this bug and otherwise check
   * as usual (so foreign credentials that crash the route, e.g. getCredentials' { error } thrown later,
   * are covered too). If the suite collapses with ECONNREFUSED right after one of the credential tests,
   * that route needs this.
   */
  crashesServer?: string;
};

export type RouteSpec = {
  method: "get" | "post" | "put" | "delete";
  /** Path under basePath, without the query string. */
  path: string;
  /** Where the router is mounted. Default "/api"; e.g. "/webhook" for a separate webhook router. */
  basePath?: string;
  /**
   * Where the route reads the session credentials. "query" (default) is the iframe's backendAPI call.
   * "body": webhooks (asset clicks, zone events) get them as top-level fields of the JSON body, and
   * read them with getCredentials(req.body). The platform tests then merge them into `data`.
   */
  credentialsIn?: "query" | "body";
  /**
   * Body key the route reads the credentials from, for routes that take them nested, e.g.
   * "interactiveParams" for getCredentials(req.body.interactiveParams). Implies credentialsIn: "body".
   */
  credentialsKey?: string;
  /**
   * Query parameters the route needs besides the credentials (GET routes that answer early without them,
   * which would make the secrets scan vacuous).
   */
  query?: Record<string, string>;
  data?: Record<string, unknown>;
  knownBugs?: KnownBugs;
};

// getCredentials (protected file) returns { error } instead of throwing, so every route that
// uses it has this bug until it's fixed there.
const GET_CREDENTIALS_DOESNT_THROW = "EXP-428 #6: getCredentials doesn't throw";

/**
 * API routes that read the session credentials (getCredentials). Each one must reject missing or
 * foreign credentials and must never send the interactive secret to the browser. List them all.
 *
 * Except server-sent-event streams (e.g. GET /sse): with valid credentials the response never ends, so
 * the platform tests can't read its body and time out. Cover an SSE route's credential checks in
 * tests/app instead (open it with page.request or fetch + AbortController and check the status).
 */
export const CREDENTIALED_ROUTES: RouteSpec[] = [
  { method: "get", path: "/game-state", knownBugs: { unnamedCredentialError: GET_CREDENTIALS_DOESNT_THROW } },
];

/**
 * Page the app opens in its iframe; the platform tests load it with valid credentials. null if the app
 * has no page (no client/, driven only by webhooks): the platform tests that load a page are skipped.
 */
export const ENTRY_PAGE: string | null = "/";

/** Bugs seen when loading ENTRY_PAGE (only leaksSecret applies). */
export const ENTRY_PAGE_KNOWN_BUGS: Pick<KnownBugs, "leaksSecret"> = {};

/**
 * What the page-load secret scan reads. "api" (default): the page's /api responses, at least one required.
 * "all": every response from the app (document, scripts, /api) plus WebSocket frames, none required, for
 * pages that talk over a socket or call /api only after the player acts.
 */
export const ENTRY_PAGE_SCAN: "api" | "all" = "api";

/**
 * Runs after ENTRY_PAGE loads and before the scan (e.g. click "Join" so the page opens its socket or calls
 * /api). Optional. Wait inside it for what it triggers (e.g. expect the game board to show): the scan only
 * reads what arrived by the time it returns and the page went network-idle.
 */
export const ENTRY_PAGE_ACTION: ((page: Page, world: TopiaWorld) => Promise<void>) | undefined = undefined;

/** Text the app shell's HTML must contain. Change it if the app isn't a React root (e.g. Unity). */
export const APP_SHELL_MARKER = 'id="root"';

/**
 * Whether unknown paths serve the app shell (an SPA with client-side routing). false for apps with real
 * page routes that answer unknown paths with a proper 404 (e.g. Next.js): the fallback test is skipped.
 */
export const APP_SHELL_FALLBACK: boolean = true;

/** The app's health endpoint, for the shared server's readiness check, private instances and system.spec. */
export const HEALTH_PATH: string = "/api/system/health";

/**
 * Bugs of the health endpoint (HEALTH_PATH), e.g. { incompleteContract: "EXP-123: no
 * COMMIT_HASH/BUILD_TIME in envs" } for apps forked before the contract had them. Marks the contract
 * test test.fail instead of changing app code in the e2e PR.
 */
export const HEALTH_KNOWN_BUGS: { incompleteContract?: string } = {};

/**
 * Bugs of the app process as a whole.
 * exitsOnUnhandledRejection: a promise rejection nobody handles exits the process, so any route that
 * forgets a try/catch lets one request restart the server for every player. @rtsdk/topia registers an
 * unhandledRejection hook that calls process.exit(1) when it's imported, which runs even when the app
 * registers its own logging handler. Fix: process.removeAllListeners("unhandledRejection") before
 * registering the app's handler.
 */
export const PROCESS_KNOWN_BUGS: { exitsOnUnhandledRejection?: string } = {
  exitsOnUnhandledRejection:
    "@rtsdk/topia's unhandledRejection hook calls process.exit(1); server/index.ts's handler doesn't stop it",
};

/**
 * Extra environment for the app under test (merged over the defaults in appEnv.ts; also passed to
 * private instances and the Docker image). A function gets the mock's address as the app reaches it
 * ({ host: "localhost:3101" or "host.docker.internal:3101", url: "http://<host>" }), for fakes of
 * external APIs served by mock-topia. Fake S3 opt-in: { S3_BUCKET: FAKE_S3_BUCKET } (constants.ts).
 * Blank every variable that would point the app at a real service.
 */
export const APP_ENV: Record<string, string> | ((mock: { host: string; url: string }) => Record<string, string>) = (
  mock,
) => ({
  // The boilerplate's example posts player stats to the leaderboard app.
  LEADERBOARD_BASE_URL: `${mock.url}/leaderboard`,
  GOOGLESHEETS_SHEET_ID: "",
});
