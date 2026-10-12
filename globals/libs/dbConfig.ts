/**
 * PostgreSQL connection configuration — single owner for runtime, seed,
 * fixtures and approved CLIs.
 *
 * - `DATABASE_URL` is the runtime (pooled) endpoint.
 * - `DIRECT_URL` is the non-pooled administrative endpoint used by Prisma
 *   Migrate and maintenance tools. In local development the two may point at
 *   the same server/database; migration config must never use a pooler URL.
 * - `TEST_DATABASE_URL` is the template used by integration fixtures to
 *   provision disposable databases. Never falls back to `DATABASE_URL`.
 *
 * Fail-closed: missing or non-PostgreSQL runtime URLs throw instead of
 * opening a local file or in-memory fallback.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
let migrationCaPath: string | undefined;

function getMigrationCaPath(encodedCa: string): string {
  if (migrationCaPath) return migrationCaPath;

  const directory = mkdtempSync(join(tmpdir(), "event-attendance-db-ca-"));
  migrationCaPath = join(directory, "root-ca.pem");
  writeFileSync(migrationCaPath, Buffer.from(encodedCa, "base64"), {
    flag: "wx",
    mode: 0o600,
  });
  process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
  return migrationCaPath;
}

export function isPostgresUrl(url: string): boolean {
  return (
    url.startsWith("postgresql://") || url.startsWith("postgres://")
  );
}

export function isLocalPostgresUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return LOCAL_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Throw unless `url` is a PostgreSQL connection string. */
export function assertPostgresUrl(url: string, name: string): string {
  const trimmed = url.trim();
  if (!isPostgresUrl(trimmed)) {
    throw new Error(
      `${name} must be a PostgreSQL connection string (postgresql://...). ` +
        `Refusing SQLite/file: URLs and empty values. Got: ${trimmed.slice(0, 12) || "(empty)"}...`,
    );
  }
  if (trimmed.includes("pooler") && name === "DIRECT_URL") {
    throw new Error(
      "DIRECT_URL must not point at a transaction pooler. Use the direct (non-pooled) endpoint for migrations.",
    );
  }
  return trimmed;
}

export function getRuntimeDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL environment variable is not set. Set it to a PostgreSQL URL (e.g. DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/event_attendance_dev").',
    );
  }
  return assertPostgresUrl(url, "DATABASE_URL");
}

/**
 * pg lets SSL options from a connection string replace the explicit `ssl`
 * object. When a custom CA is configured, remove URL SSL options so the pool
 * uses the verified CA object returned by `sslForUrl()`.
 */
export function getRuntimePoolConnectionString(url: string): string {
  if (!process.env.DATABASE_SSL_CA_BASE64 || isLocalPostgresUrl(url)) return url;

  const poolUrl = new URL(url);
  for (const option of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) {
    poolUrl.searchParams.delete(option);
  }
  return poolUrl.toString();
}

export function getMigrationDatabaseUrl(): string {
  // Migrate/maintenance prefers DIRECT_URL, falls back to the runtime URL in
  // local development where both point at the same server.
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Neither DIRECT_URL nor DATABASE_URL is set. Set DATABASE_URL (and DIRECT_URL for pooled production) to PostgreSQL URLs.",
    );
  }
  const validatedUrl = assertPostgresUrl(url, process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL");
  const encodedCa = process.env.DATABASE_SSL_CA_BASE64;
  if (!encodedCa || isLocalPostgresUrl(validatedUrl)) return validatedUrl;

  const migrationUrl = new URL(validatedUrl);
  migrationUrl.searchParams.set("sslmode", "verify-full");
  migrationUrl.searchParams.set("sslrootcert", getMigrationCaPath(encodedCa));
  return migrationUrl.toString();
}

export type PgPoolTuning = {
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
};

/**
 * Initial runtime pool budget (issue #51 §1): 8 connections per process,
 * 5s establishment/acquisition budget, 30s idle budget. Measure, don't assume.
 */
export const RUNTIME_POOL_TUNING: PgPoolTuning = {
  max: 8,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
};

/** Returns true when the URL targets a remote host that requires TLS. */
export function requiresTls(url: string): boolean {
  return !isLocalPostgresUrl(url);
}

/**
 * pg Pool SSL config: remote hosts verify certificates against the host trust
 * chain. Never disable validation to "fix" configuration.
 */
export function sslForUrl(url: string): { rejectUnauthorized: true; ca?: string } | undefined {
  if (!requiresTls(url)) return undefined;
  try {
    const parsed = new URL(url);
    const sslmode = parsed.searchParams.get("sslmode");
    if (sslmode === "disable" || sslmode === "allow" || sslmode === "prefer") {
      throw new Error(
        `Refusing insecure sslmode=${sslmode} for remote PostgreSQL host ${parsed.hostname}. Use verify-full (or verify-ca with documented trust).`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing insecure")) throw error;
    // URL already validated by assertPostgresUrl; ignore parse noise here.
  }
  const encodedCa = process.env.DATABASE_SSL_CA_BASE64;
  const ca = encodedCa ? Buffer.from(encodedCa, "base64").toString("utf8") : undefined;
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

/** Redacted host/db label for logs — never prints credentials. */
export function describeDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "(unparseable)";
  }
}
