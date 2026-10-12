import "dotenv/config";
import { defineConfig } from "prisma/config";
import { getMigrationDatabaseUrl } from "./globals/libs/dbConfig";

// The shared helper also adds the configured provider CA to remote URLs for
// Prisma Migrate, materializing it in a private temporary file when needed.
const migrationUrl = getMigrationDatabaseUrl();

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
