import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/"],
  testMatch: ["**/tests/**/*.test.ts"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  clearMocks: true,
  restoreMocks: true,

  moduleNameMapper: {
    // 🔒 Force all imports of the SDK to our mock file
    "^@rtsdk/topia$": "<rootDir>/mocks/@rtsdk/topia.ts",
    "^@rtsdk/topia/(.*)$": "<rootDir>/mocks/@rtsdk/topia.ts",

    // 🔗 Map @shared/* to the shared workspace (strip .js extension for ts-jest)
    "^@shared/(.*)\\.js$": "<rootDir>/../shared/$1",
    "^@shared/(.*)$": "<rootDir>/../shared/$1",

    // 🔗 Map @utils/* to the utils directory
    "^@utils/(.*)\\.js$": "<rootDir>/utils/$1",
    "^@utils/(.*)$": "<rootDir>/utils/$1",

    // ✅ Only strip `.js` from *relative* imports, so your runtime-friendly
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};

export default config;
