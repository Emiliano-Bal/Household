import "dotenv/config";
import { defineConfig } from "vitest/config";

// Separate config for *.db.test.ts files, which need a real, migrated
// Postgres (DATABASE_URL). Run explicitly with `npm run test:db` — kept
// out of the default `vitest.config.mts` / `npm test` so that one stays
// DB-free and always green.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    // Explicitly forwarded, not just relied on via the top-level dotenv
    // import above — test files run in separate worker processes that
    // don't automatically inherit env vars set in the config process.
    env: { DATABASE_URL: process.env.DATABASE_URL },
  },
});
