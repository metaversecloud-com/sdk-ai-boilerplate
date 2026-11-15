export const APP_PORT = Number(process.env.APP_PORT || 3100);
export const MOCK_TOPIA_PORT = Number(process.env.MOCK_TOPIA_PORT || 3101);
export const MOCK_TOPIA_URL = `http://localhost:${MOCK_TOPIA_PORT}`;
export const INTERACTIVE_KEY = "e2e-public-key";
// Distinctive on purpose: the platform tests fail if this string ever reaches the browser.
export const INTERACTIVE_SECRET = "e2e-interactive-secret-must-never-leak";
// mock-topia's fake S3 bucket, for APP_ENV's S3_BUCKET (app.config.ts). The underscore makes it an invalid
// DNS name on purpose, so the AWS SDK puts the bucket in the path (http://<mock>/s3/<bucket>/<key>).
export const FAKE_S3_BUCKET = "e2e_bucket";
