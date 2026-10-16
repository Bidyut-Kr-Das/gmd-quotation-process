// Prisma config for the stock database. Used only by Prisma CLI for
// migrations/generation of `prisma/schema.prisma`; the runtime client is
// created in `src/index.ts` via the pg driver adapter.
//
//   pnpm --filter @gmd/db-stock db:migrate
//   pnpm --filter @gmd/db-stock db:generate
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["STOCK_DATABASE_URL"],
  },
});
