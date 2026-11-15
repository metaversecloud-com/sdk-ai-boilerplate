// Shared by every SDK app: keep this file identical across repos. App-specific variables go in APP_ENV
// (app.config.ts).
import * as config from "./app.config";
import { INTERACTIVE_KEY, INTERACTIVE_SECRET, MOCK_TOPIA_PORT } from "./constants";

/** E2E_APP_IMAGE=<image> runs the app from a Docker image instead of local Node (see playwright.config.ts). */
export const APP_IMAGE = process.env.E2E_APP_IMAGE;

/**
 * Environment of the app under test, for the shared server, private instances (helpers/privateServer.ts)
 * and the Docker image alike. Explicit env wins over any developer ../.env because dotenv never
 * overrides existing variables.
 */
export const appEnv = (port: number): Record<string, string> => {
  // The container reaches the mock on the host through host.docker.internal.
  const host = `${APP_IMAGE ? "host.docker.internal" : "localhost"}:${MOCK_TOPIA_PORT}`;
  const mock = { host, url: `http://${host}` };
  const extra = typeof config.APP_ENV === "function" ? config.APP_ENV(mock) : config.APP_ENV ?? {};
  return {
    PORT: String(port),
    NODE_ENV: "test",
    INSTANCE_DOMAIN: host,
    INSTANCE_PROTOCOL: "http",
    INTERACTIVE_KEY,
    INTERACTIVE_SECRET,
    API_KEY: "",
    // Never let a test reach real AWS: every S3 call goes to mock-topia's fake bucket, with dummy
    // credentials that real AWS rejects even if an old SDK ignores AWS_ENDPOINT_URL_S3. S3_BUCKET stays
    // empty unless APP_ENV opts in (S3_BUCKET: FAKE_S3_BUCKET); an app's hardcoded fallback bucket
    // still lands in the mock.
    S3_BUCKET: "",
    AWS_ENDPOINT_URL_S3: `${mock.url}/s3`,
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "e2e-access-key",
    AWS_SECRET_ACCESS_KEY: "e2e-secret-key",
    AWS_SESSION_TOKEN: "",
    AWS_EC2_METADATA_DISABLED: "true",
    // The image bakes COMMIT_HASH in and runs in UTC; a local run has to provide both.
    ...(APP_IMAGE ? {} : { COMMIT_HASH: "local", TZ: "UTC" }),
    ...extra,
  };
};
