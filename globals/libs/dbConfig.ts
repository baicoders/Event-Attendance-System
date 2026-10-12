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

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkServerIdentity } from "node:tls";
import type { PoolConfig } from "pg";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const migrationCaPaths = new Map<string, string>();

function getMigrationCaPath(encodedCa: string): string {
  const cached = migrationCaPaths.get(encodedCa);
  if (cached) return cached;

  const directory = mkdtempSync(join(tmpdir(), "event-attendance-db-ca-"));
  const migrationCaPath = join(directory, "root-ca.pem");
  writeFileSync(migrationCaPath, Buffer.from(encodedCa, "base64"), {
    flag: "wx",
    mode: 0o600,
  });
  migrationCaPaths.set(encodedCa, migrationCaPath);
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
    // Both pg and Prisma let the query's host override the URL hostname.
    const host = Object.fromEntries(parsed.searchParams).host || parsed.hostname;
    return LOCAL_HOSTS.has(host.toLowerCase());
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

/** Raw direct endpoint for pg seeds/maintenance; no engine-specific options. */
export function getDirectDatabaseUrl(): string {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Neither DIRECT_URL nor DATABASE_URL is set. Set DATABASE_URL (and DIRECT_URL for pooled production) to PostgreSQL URLs.",
    );
  }
  return assertPostgresUrl(url, process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL");
}

/** Prisma's schema engine uses different TLS parameters from node-postgres. */
export function getMigrationDatabaseUrl(): string {
  const validatedUrl = getDirectDatabaseUrl();
  if (isLocalPostgresUrl(validatedUrl)) return validatedUrl;

  const encodedCa = process.env.DATABASE_SSL_CA_BASE64;
  const migrationUrl = new URL(validatedUrl);
  // Prisma 7.10 supports require + strict, not libpq's verify-full/rootcert.
  migrationUrl.searchParams.set("sslmode", "require");
  migrationUrl.searchParams.set("sslaccept", "strict");
  const caPath = encodedCa
    ? getMigrationCaPath(encodedCa)
    : migrationUrl.searchParams.get("sslrootcert");
  if (caPath) migrationUrl.searchParams.set("sslcert", caPath);
  migrationUrl.searchParams.delete("sslrootcert");
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

/**
 * Build the pg URL and TLS options together so URL parsing cannot replace the
 * verified SSL object. Keep client certificates and direct TLS negotiation.
 * Remote connections always verify the server; local development is unchanged.
 */
export function getPgPoolConfig(url: string): PoolConfig {
  if (isLocalPostgresUrl(url)) return { connectionString: url };

  const poolUrl = new URL(url);
  const options = Object.fromEntries(poolUrl.searchParams);
  if (
    (options.sslmode && !["require", "verify-ca", "verify-full"].includes(options.sslmode)) ||
    (options.ssl && !["true", "1"].includes(options.ssl))
  ) {
    throw new Error("Remote PostgreSQL requires verified TLS. Remove insecure SSL options or use sslmode=verify-full.");
  }
  const negotiation = options.sslnegotiation;
  if (negotiation && negotiation !== "direct" && negotiation !== "postgres") {
    throw new Error("sslnegotiation must be postgres or direct.");
  }
  const encodedCa = process.env.DATABASE_SSL_CA_BASE64;
  const ca = encodedCa
    ? Buffer.from(encodedCa, "base64").toString("utf8")
    : options.sslrootcert ? readFileSync(options.sslrootcert, "utf8") : undefined;
  const cert = options.sslcert ? readFileSync(options.sslcert, "utf8") : undefined;
  const key = options.sslkey ? readFileSync(options.sslkey, "utf8") : undefined;
  const host = (options.host || decodeURIComponent(poolUrl.hostname)).replace(/^\[|\]$/g, "");

  // These are every SSL-object override in pg-connection-string 2.14.0.
  // Move negotiation out too: direct negotiation implicitly sets ssl=true.
  for (const option of ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "sslnegotiation", "uselibpqcompat"]) {
    poolUrl.searchParams.delete(option);
  }
  const config: PoolConfig = {
    connectionString: poolUrl.toString(),
    ssl: {
      rejectUnauthorized: true,
      // pg omits SNI for IP addresses; Node otherwise checks "localhost".
      checkServerIdentity: (_hostname, certificate) => checkServerIdentity(host, certificate),
      ...(ca !== undefined ? { ca } : {}),
      ...(cert !== undefined ? { cert } : {}),
      ...(key !== undefined ? { key } : {}),
    },
  };
  if (negotiation === "direct" || negotiation === "postgres") {
    config.sslnegotiation = negotiation;
  }
  return config;
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
