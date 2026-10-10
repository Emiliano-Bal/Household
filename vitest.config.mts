import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // *.db.test.ts files need a real, migrated Postgres (DATABASE_URL) —
    // run those explicitly with `npm run test:db`, not the default `npm
    // test`, which must stay DB-free and always green.
    exclude: ["node_modules/**", "src/**/*.db.test.ts"],
  },
});
