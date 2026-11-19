export const APP_PORT = Number(process.env.APP_PORT || 3100);
export const MOCK_TOPIA_PORT = Number(process.env.MOCK_TOPIA_PORT || 3101);
export const MOCK_TOPIA_URL = `http://localhost:${MOCK_TOPIA_PORT}`;
// mock-redis (mock-redis/server.mjs), started only for apps that set MOCK_REDIS = true in app.config.ts.
export const MOCK_REDIS_PORT = Number(process.env.MOCK_REDIS_PORT || MOCK_TOPIA_PORT + 1);
export const INTERACTIVE_KEY = "e2e-public-key";
// Distinctive on purpose: the platform tests fail if this string ever reaches the browser.
export const INTERACTIVE_SECRET = "e2e-interactive-secret-must-never-leak";
// The Topia API key mock-topia accepts (Authorization header, no interactive credentials), for apps that call
// the public API with a world admin's key: APP_ENV = { API_KEY: E2E_API_KEY } (app.config.ts).
export const E2E_API_KEY = "e2e-topia-api-key-must-never-leak";
// mock-topia's fake S3 bucket, for APP_ENV's S3_BUCKET (app.config.ts). The underscore makes it an invalid
// DNS name on purpose, so the AWS SDK puts the bucket in the path (http://<mock>/s3/<bucket>/<key>).
export const FAKE_S3_BUCKET = "e2e_bucket";
