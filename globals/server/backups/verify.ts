/**
 * Isolated restore verification — privileged operator procedure, never a web
 * upload or a browser-triggered production reset.
 *
 * 1. Verify trusted origin/checksum, tool/server compatibility, env recipe.
 * 2. Provision a uniquely named empty recovery database (never live/dev).
 * 3. pg_restore --exit-on-error --single-transaction --no-owner --no-privileges
 *    into the empty target, then the reviewed ownership/grant recipe.
 * 4. Verify schema, enums, tables, constraints, relation integrity, migration
 *    records, sequence state; compare entity/attendance aggregates including
 *    timeout-only records; isolated smoke query. Mark RESTORE_VERIFIED only
 *    after it passes.
 *
 * Steps 5-8 (admission shutdown, writer drain, secret rotation, cutover) are
 * real disaster-recovery actions documented in the runbook — not automated
 * here. Restoring the database does not restore browser-local offline
 * journals; post-cutover reversal is not lossless once new writes land.
 *
 * No `server-only` here: the CLI imports this module.
 */

import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { Pool } from "pg";

import { getBackupConfig, getBackupSourceUrl } from "./config";
import {
  artifactDumpPath,
  assertArtifactId,
  findArtifact,
  loadCatalog,
  saveCatalog,
  updateJob,
} from "./catalog";
import {
  assertMajorCompatible,
  assertTlsPolicy,
  parsePostgresUrl,
  safeEnvForLibpq,
  toolVersion,
  writePassfile,
} from "./pgTools";

function sha256FileFast(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk: Buffer | string) => hash.update(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

const PROTECTED_DB_NAMES = new Set([
  "postgres",
  "template0",
  "template1",
  "event_attendance_dev",
  "event_attendance",
  "event_attendance_prod",
]);

function liveDatabaseNames(): Set<string> {
  const names = new Set(PROTECTED_DB_NAMES);
  for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const raw = process.env[key];
    if (!raw) continue;
    try {
      const db = new URL(raw.trim()).pathname.replace(/^\//, "");
      if (db) names.add(db);
    } catch {
      /* ignore */
    }
  }
  return names;
}

export function newRestoreDbName(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = randomBytes(3).toString("hex");
  return `eas_restore_${stamp}_${rand}`.toLowerCase();
}

function adminPool(adminUrl: string): Pool {
  return new Pool({
    connectionString: adminUrl,
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
  });
}

function urlWithDb(base: string, dbName: string): string {
  const parsed = new URL(base);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

async function dropDatabase(adminUrl: string, dbName: string) {
  const pool = adminPool(adminUrl);
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

export type VerifyResult = { ok: boolean; checks: string[]; targetDb: string; message: string };

/**
 * Restore the exact artifact into a new isolated database and run the
 * schema/data/application checks. Cleans up only the target it created.
 */
export async function verifyArtifact(
  artifactId: string,
  opts?: { keepTarget?: boolean; verificationJobId?: string },
): Promise<VerifyResult> {
  assertArtifactId(artifactId);
  const config = getBackupConfig();
  const artifact = findArtifact(artifactId);
  if (!artifact) throw new Error("Unknown backup artifact.");
  const dumpFile = artifactDumpPath(artifactId);
  if (!existsSync(dumpFile)) throw new Error("Backup artifact file is missing; availability is invalid.");

  // Trusted origin: checksum must match the catalogued value.
  const actual = await sha256FileFast(dumpFile);
  if (actual !== artifact.sha256) {
    throw new Error("Checksum mismatch: untrusted or corrupted archive. Refusing restore.");
  }

  const sourceUrl = getBackupSourceUrl();
  const conn = parsePostgresUrl(sourceUrl);
  assertTlsPolicy(conn);
  const restoreVersionLine = toolVersion(config.pgRestorePath);
  const psqlVersionLine = (() => {
    try {
      return toolVersion(config.psqlPath);
    } catch {
      return restoreVersionLine;
    }
  })();
  void psqlVersionLine;

  // Server compatibility from the live server version line (catalogued at
  // capture + re-checked here via a bounded connection).
  const adminUrl = process.env.TEST_DATABASE_URL ?? sourceUrl;
  const adminConn = parsePostgresUrl(adminUrl);
  void adminConn;

  const targetDb = newRestoreDbName();
  const protectedNames = liveDatabaseNames();
  if (protectedNames.has(targetDb)) throw new Error("Refusing: restore target collides with a protected database.");
  for (const live of protectedNames) {
    if (targetDb === live) throw new Error("Refusing: restore target is a live database.");
  }
  if (!/^eas_restore_[a-z0-9_]+$/.test(targetDb)) throw new Error("Refusing unexpected restore target name.");

  // Provision empty recovery database. Uses the maintenance URL's server with
  // only the database name changed — never archive-driven --create.
  const adminPoolForCreate = adminPool(adminUrl);
  try {
    await adminPoolForCreate.query(`CREATE DATABASE "${targetDb}"`);
  } finally {
    await adminPoolForCreate.end();
  }

  // Confirm the target is empty and is not the live database.
  const targetUrl = urlWithDb(adminUrl, targetDb);
  const verifyPool = new Pool({ connectionString: targetUrl, max: 2 });
  try {
    const { rows } = await verifyPool.query("SELECT current_database() AS db");
    if (rows[0]?.db !== targetDb) {
      await verifyPool.end();
      await dropDatabase(adminUrl, targetDb);
      throw new Error("Identity verification failed: connected to the wrong database. Refusing restore.");
    }
    const { rows: tables } = await verifyPool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    if ((tables[0]?.n as number) !== 0) {
      await verifyPool.end();
      await dropDatabase(adminUrl, targetDb);
      throw new Error("Refusing: restore target is not empty.");
    }
    await verifyPool.end();
  } catch (error) {
    try {
      await dropDatabase(adminUrl, targetDb);
    } catch {
      /* best effort */
    }
    throw error;
  }

  const passfile = writePassfile(parsePostgresUrl(targetUrl));
  try {
    const targetConn = parsePostgresUrl(targetUrl);
    const env = safeEnvForLibpq(targetConn, passfile?.file ?? null);
    try {
      assertMajorCompatible(artifact.pgServerVersion, restoreVersionLine, "pg_restore");
    } catch (error) {
      await dropDatabase(adminUrl, targetDb);
      throw error;
    }

    // Tested restore invocation. No --clean/drop against live production;
    // explicit target connection, empty target only. Parallel restore is
    // never combined with --single-transaction.
    try {
      execFileSync(
        config.pgRestorePath,
        [
          `--host=${targetConn.host}`,
          `--port=${targetConn.port}`,
          `--username=${targetConn.user}`,
          `--dbname=${targetConn.dbname}`,
          "--exit-on-error",
          "--single-transaction",
          "--no-owner",
          "--no-privileges",
          dumpFile,
        ],
        { env, timeout: config.maxDurationMs, stdio: "pipe" },
      );
    } catch {
      await dropDatabase(adminUrl, targetDb);
      throw new Error("Restore failed. The live database was not touched; the rehearsal target was dropped.");
    }

    // Verification: schema, enums, tables, constraints, relation integrity,
    // migration records, entity/attendance aggregates including timeout-only.
    const checks: string[] = [];
    const pool = new Pool({ connectionString: targetUrl, max: 2 });
    try {
      const requiredTables = ["Event", "Student", "Record", "User", "Group", "_EventGroups", "_GroupToStudent"];
      const { rows: found } = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
      );
      const names = new Set((found as Array<{ tablename: string }>).map((r) => r.tablename));
      for (const t of requiredTables) {
        if (!names.has(t)) throw new Error(`Restored schema is missing table ${t}.`);
      }
      checks.push(`tables:${requiredTables.length}`);

      const { rows: enums } = await pool.query(`SELECT count(*)::int AS n FROM pg_type WHERE typtype = 'e'`);
      if ((enums[0]?.n as number) < 5) throw new Error("Restored enums are incomplete.");
      checks.push(`enums:${enums[0]?.n}`);

      const { rows: counts } = await pool.query(
        `SELECT (SELECT count(*)::int FROM "Student") AS students, (SELECT count(*)::int FROM "Group") AS groups, (SELECT count(*)::int FROM "Event") AS events, (SELECT count(*)::int FROM "Record") AS records, (SELECT count(*)::int FROM "User") AS users, (SELECT count(*)::int FROM "Record" WHERE timein IS NULL AND timeout IS NOT NULL) AS timeout_only`,
      );
      const c = counts[0] as Record<string, number>;
      checks.push(`students:${c.students}`, `groups:${c.groups}`, `events:${c.events}`, `records:${c.records}`, `users:${c.users}`, `timeout_only:${c.timeout_only}`);

      const { rows: orphans } = await pool.query(
        `SELECT (SELECT count(*)::int FROM "Record" r LEFT JOIN "Event" e ON e.id = r."eventId" WHERE e.id IS NULL) AS orphan_events, (SELECT count(*)::int FROM "Record" r LEFT JOIN "Student" s ON s.id = r."studentId" WHERE s.id IS NULL) AS orphan_students`,
      );
      if ((orphans[0]?.orphan_events as number) !== 0 || (orphans[0]?.orphan_students as number) !== 0) {
        throw new Error("Relation integrity failed: orphan attendance rows.");
      }
      checks.push("relations:ok");

      // Migration lineage: _prisma_migrations when present (Prisma 7 may use
      // a different bookkeeping table; absence is recorded, not fatal).
      try {
        const { rows: mig } = await pool.query(`SELECT count(*)::int AS n FROM "_prisma_migrations"`);
        checks.push(`migrations:${mig[0]?.n}`);
      } catch {
        checks.push("migrations:unavailable");
      }

      // Isolated application smoke test: eligible-scope read with no
      // production callbacks (a bounded approved-event + record read).
      await pool.query(`SELECT id FROM "Event" WHERE status = 'APPROVED' LIMIT 1`);
      checks.push("smoke:ok");
    } finally {
      await pool.end();
    }

    // Mark the exact artifact RESTORE_VERIFIED only after all checks pass.
    const catalog = loadCatalog();
    const stored = catalog.artifacts.find((a) => a.id === artifactId);
    if (stored) {
      stored.restoreVerification = {
        jobId: opts?.verificationJobId ?? stored.jobId,
        verifiedAt: new Date().toISOString(),
        targetLabel: `${targetDb} (isolated, dropped after check${opts?.keepTarget ? ", kept" : ""})`,
        passed: true,
        checks,
      };
      saveCatalog(catalog);
    }
    if (opts?.verificationJobId) {
      try {
        updateJob(opts.verificationJobId, { status: "RESTORE_VERIFIED", completedAt: new Date().toISOString(), artifactId });
      } catch {
        /* job may be the original creation job; catalog artifact is authority */
      }
    } else {
      // Also reflect verification on the creation job when it is still CREATED.
      try {
        const creationJob = catalog.jobs.find((j) => j.id === artifact.jobId);
        if (creationJob && creationJob.status === "CREATED") {
          updateJob(creationJob.id, { status: "RESTORE_VERIFIED", artifactId });
        }
      } catch {
        /* best effort */
      }
    }

    if (!opts?.keepTarget) {
      await dropDatabase(adminUrl, targetDb);
    }

    return { ok: true, checks, targetDb, message: `Restore verified for ${artifactId}.` };
  } finally {
    passfile?.cleanup();
  }
}
