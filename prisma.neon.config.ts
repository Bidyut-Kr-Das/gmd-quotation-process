// Prisma config for the SECOND datasource (Neon). Used only by Prisma CLI for
// migrations/generation of `prisma/neon/schema.prisma`; the runtime client is
// created in `lib/neonPrisma.ts` via the pg driver adapter.
//
//   npx prisma migrate dev --config prisma.neon.config.ts
//   npx prisma generate     --config prisma.neon.config.ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/neon/schema.prisma",
  migrations: {
    path: "prisma/neon/migrations",
  },
  datasource: {
    url: process.env["NEON_DATABASE_URL"],
  },
});
