// Prisma 7 config: this is where Migrate/Studio get their connection
// string. The runtime PrismaClient (src/lib/db.ts) does NOT read this —
// it builds its own pg Pool from DATABASE_URL via @prisma/adapter-pg.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
