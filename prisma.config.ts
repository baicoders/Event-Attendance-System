import "dotenv/config";
import { defineConfig } from "prisma/config";

// DIRECT_URL is the non-pooled administrative endpoint for Migrate and
// maintenance. Falls back to DATABASE_URL in local development where both
// point at the same server. Never point this at a transaction pooler.
const migrationUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!migrationUrl) {
  throw new Error(
    "Neither DIRECT_URL nor DATABASE_URL is set. Set DATABASE_URL (and DIRECT_URL for pooled production) to PostgreSQL URLs.",
  );
}
if (!migrationUrl.startsWith("postgresql://") && !migrationUrl.startsWith("postgres://")) {
  throw new Error("Migration URL must be a PostgreSQL connection string (postgresql://...). Refusing SQLite/file: URLs.");
}

export default defineConfig({
	schema: "prisma/schema.prisma",
	migrations: {
		path: "prisma/migrations",
		seed: "tsx prisma/seed.ts",
	},
	datasource: {
		url: migrationUrl,
	},
});
