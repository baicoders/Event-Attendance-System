import "dotenv/config";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

function adminUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set. Tests never fall back to DATABASE_URL.");
  if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
    throw new Error("TEST_DATABASE_URL must be a PostgreSQL URL.");
  }
  return url;
}

function withDb(base, dbName) {
  const parsed = new URL(base);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

export async function createDisposableDatabase(prefix = "test") {
  const suffix = `${Date.now().toString(36)}_${randomBytes(4).toString("hex")}_${process.pid.toString(36)}`;
  const dbName = `${prefix}_${suffix}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!/^test_[a-z0-9_]+$/.test(dbName)) throw new Error(`Refusing unexpected name: ${dbName}`);
  const base = adminUrl();
  const adminDb = new URL(base).pathname.replace(/^\//, "");
  if (["event_attendance_dev", "event_attendance_prod"].includes(adminDb)) {
    throw new Error(`Refusing: TEST_DATABASE_URL points at a real database (${adminDb}).`);
  }
  const pool = new Pool({ connectionString: base });
  try {
    await pool.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await pool.end();
  }
  const url = withDb(base, dbName);
  try {
    const deploy = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
      encoding: "utf8",
    });
    if (deploy.status !== 0) throw new Error(deploy.stderr || deploy.stdout || "migrate deploy failed");
    const verify = new Pool({ connectionString: url });
    try {
      const { rows } = await verify.query("SELECT current_database() AS db");
      if (rows[0]?.db !== dbName) throw new Error(`Identity verification failed: ${rows[0]?.db} !== ${dbName}`);
    } finally {
      await verify.end();
    }
  } catch (error) {
    await dropDisposableDatabase(dbName);
    throw error;
  }
  return {
    dbName,
    url,
    cleanup: () => dropDisposableDatabase(dbName),
  };
}

export async function dropDisposableDatabase(dbName) {
  if (!/^test_[a-z0-9_]+$/.test(dbName)) throw new Error(`Refusing to drop non-disposable database: ${dbName}`);
  const pool = new Pool({ connectionString: adminUrl() });
  try {
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await pool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  } finally {
    await pool.end();
  }
}
