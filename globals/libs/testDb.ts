import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

/**
 * PostgreSQL disposable-database fixtures (issue #51 §6).
 *
 * - No implicit production fallback: TEST_DATABASE_URL must be set explicitly.
 * - Generated `test_<...>` names, identity verification, cleanup restricted
 *   to created targets only.
 * - Real migrations (`migrate deploy`) + production adapter (`PrismaPg`).
 * - Parallel-safe: unique names per worker; cleanup runs even after failure
 *   (callers use try/finally or after()).
 */

const DISPOSABLE_PATTERN = /^test_[a-z0-9_]+$/;

function testAdminUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Set it to a PostgreSQL maintenance URL (e.g. postgresql://postgres:postgres@127.0.0.1:5433/postgres). Tests never fall back to DATABASE_URL.",
    );
  }
  if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
    throw new Error("TEST_DATABASE_URL must be a PostgreSQL URL. Refusing to provision test databases.");
  }
  return url;
}

function databaseUrlWithDb(base: string, dbName: string): string {
  const parsed = new URL(base);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

function adminPool(): Pool {
  return new Pool({ connectionString: testAdminUrl() });
}

export type DisposableDb = {
  dbName: string;
  url: string;
  cleanup: () => Promise<void>;
};

/** Create `test_...`, apply real migrations, verify identity. */
export async function createDisposableDb(prefix = "test"): Promise<DisposableDb> {
  const suffix = `${Date.now().toString(36)}_${randomBytes(4).toString("hex")}_${process.pid.toString(36)}`;
  const dbName = `${prefix}_${suffix}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!DISPOSABLE_PATTERN.test(dbName)) {
    throw new Error(`Refusing to create database with unexpected name: ${dbName}`);
  }
  // Guard: never create inside the dev/production databases.
  const adminUrl = testAdminUrl();
  const adminDb = new URL(adminUrl).pathname.replace(/^\//, "");
  if (["event_attendance_dev", "event_attendance", "event_attendance_prod"].includes(dbName)) {
    throw new Error(`Refusing: disposable name collides with a real database (${dbName}).`);
  }
  if (["event_attendance_dev", "event_attendance_prod"].includes(adminDb)) {
    throw new Error(
      `Refusing: TEST_DATABASE_URL points at a real database (${adminDb}). Point it at a maintenance database (e.g. postgres).`,
    );
  }

  const pool = adminPool();
  try {
    await pool.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await pool.end();
  }

  const url = databaseUrlWithDb(adminUrl, dbName);
  try {
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
      stdio: "pipe",
    });
    // Identity verification: connected DB matches the created target.
    const verify = new Pool({ connectionString: url });
    try {
      const { rows } = await verify.query("SELECT current_database() AS db");
      if (rows[0]?.db !== dbName) {
        throw new Error(`Identity verification failed: connected to ${rows[0]?.db}, expected ${dbName}.`);
      }
    } finally {
      await verify.end();
    }
  } catch (error) {
    await dropDisposableDb(dbName);
    throw error;
  }

  return {
    dbName,
    url,
    cleanup: () => dropDisposableDb(dbName),
  };
}

async function dropDisposableDb(dbName: string): Promise<void> {
  if (!DISPOSABLE_PATTERN.test(dbName)) {
    throw new Error(`Refusing to drop non-disposable database: ${dbName}`);
  }
  const pool = adminPool();
  try {
    // Terminate backends so DROP succeeds even after a failed test holds a pool.
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await pool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  } finally {
    await pool.end();
  }
}

export type TestClient = {
  db: PrismaClient;
  disconnect: () => Promise<void>;
};

/** Production-adapter client for a disposable URL (bounded pool). */
export function createTestClient(url: string, max = 5): TestClient {
  const pool = new Pool({
    connectionString: url,
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    db,
    disconnect: async () => {
      await db.$disconnect();
      await pool.end();
    },
  };
}
