/**
 * Controlled backup runner — one supervised maintenance process per configured
 * source. Owns execution; the web request only durably records a job and the
 * UI polls it. A request timeout never implies the dump failed.
 *
 * Pipeline:
 * validate source + destination -> acquire lock -> private .partial ->
 * pg_dump -> checksum + TOC inspect -> atomic publish (archive + manifest +
 * catalog) -> optional verified secondary copy -> retention after publication.
 *
 * Partial/failed dumps never become available backups. A failed job never
 * deletes the last good protected artifact.
 *
 * Logical backups are reads: a forced timeout is not a database rollback.
 * Dump start/completion times are recorded, not an invented single timestamp.
 *
 * No `server-only` here: the CLI imports this module.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Pool } from "pg";

import type { BackupArtifactRecord } from "@/globals/types/backups";

import { getBackupConfig, getBackupSourceUrl } from "./config";
import {
  acquireSourceLock,
  artifactAvailable,
  artifactDumpPath,
  artifactManifestPath,
  findJob,
  loadCatalog,
  newArtifactId,
  releaseSourceLock,
  saveCatalog,
  shortHash,
  updateJob,
  upsertArtifact,
} from "./catalog";
import {
  assertMajorCompatible,
  assertTlsPolicy,
  parsePostgresUrl,
  runBounded,
  safeEnvForLibpq,
  toolVersion,
  writePassfile,
} from "./pgTools";

function ensurePrivateDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* best effort */
  }
}

function migrationLineage(): string[] {
  try {
    const dir = path.resolve(process.cwd(), "prisma", "migrations");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => !name.startsWith("."))
      .sort();
  } catch {
    return [];
  }
}

function appVersion(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

async function queryServerVersion(sourceUrl: string): Promise<string> {
  // Bounded, isolated connection budget: one short-lived pool, never the web
  // pool. Statement timeout keeps a stuck check from holding a slot.
  const pool = new Pool({
    connectionString: sourceUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
  });
  try {
    const client = await pool.connect();
    try {
      await client.query("SET statement_timeout = '5s'");
      const { rows } = await client.query("SELECT version() AS ver");
      return (rows[0]?.ver as string) ?? "unknown";
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

function sha256File(file: string): Promise<{ sha256: string; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let size = 0;
    const stream = createReadStream(file);
    stream.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += buf.length;
      hash.update(buf);
    });
    stream.on("end", () => resolve({ sha256: hash.digest("hex"), sizeBytes: size }));
    stream.on("error", reject);
  });
}

function tocEntryCount(dumpFile: string, pgRestorePath: string, env: NodeJS.ProcessEnv, timeoutMs: number): number {
  // Archive structure must be readable; an unreadable TOC is not a backup.
  const out = execFileSync(pgRestorePath, ["--list", dumpFile], {
    env,
    encoding: "utf8",
    timeout: Math.min(timeoutMs, 30_000),
  });
  return out.split("\n").filter((line) => line.includes(";")).length;
}

function failureGuidance(kind: string): string {
  switch (kind) {
    case "timeout":
      return "Backup timed out. Check database load and BACKUP_MAX_DURATION_MS; the live database was not changed (a dump is a read). Re-run backup:run.";
    case "tools":
      return "Version-matched pg_dump/pg_restore missing or incompatible. Install the same PostgreSQL major on the runner host.";
    case "tls":
      return "TLS verification failed. Check the trust chain and sslmode=verify-full; never disable verification to retry.";
    case "privileges":
      return "Backup role lacks read access. Grant CONNECT + SELECT on all application tables/sequences (test grants after migrations).";
    case "disk":
      return "Destination full or quota reached. Free space or raise BACKUP_MAX_BYTES / storage cap; the last good backup is retained.";
    case "lock":
      return "Another backup is running. Overlap was skipped, not queued. Wait for it to finish, then retry.";
    default:
      return "Backup failed. See the operator runbook §1; the last good backup (if any) remains available.";
  }
}

export type RunResult = {
  ok: boolean;
  artifactId: string | null;
  stage: "CREATED" | "FAILED" | "INTERRUPTED";
  message: string;
};

/**
 * Execute one durably-recorded job. Validates the configured source and the
 * bounded destination, holds the cross-process lock, publishes atomically.
 */
export async function runBackupJob(jobId: string): Promise<RunResult> {
  const config = getBackupConfig();
  if (!config.configured) {
    updateJob(jobId, {
      status: "FAILED",
      completedAt: new Date().toISOString(),
      error: config.configuredReason ?? "Backup runner is not configured.",
      guidance: "Set BACKUP_DIR and version-matched PostgreSQL tools; the runbook remains usable directly.",
    });
    return { ok: false, artifactId: null, stage: "FAILED", message: config.configuredReason ?? "unconfigured" };
  }

  const job = findJob(jobId);
  if (!job) throw new Error("Unknown backup job.");
  if (job.status !== "REQUESTED") {
    return {
      ok: job.status === "CREATED" || job.status === "RESTORE_VERIFIED",
      artifactId: job.artifactId,
      stage: job.status === "CREATED" || job.status === "RESTORE_VERIFIED" ? "CREATED" : "FAILED",
      message: `Job already ${job.status}.`,
    };
  }

  const lock = acquireSourceLock(jobId, config.maxDurationMs);
  if (!lock.acquired) {
    updateJob(jobId, {
      status: "FAILED",
      completedAt: new Date().toISOString(),
      error: "Another backup is already running.",
      guidance: failureGuidance("lock"),
    });
    return { ok: false, artifactId: null, stage: "FAILED", message: "overlap" };
  }

  const startedAt = new Date().toISOString();
  updateJob(jobId, { status: "RUNNING", startedAt });

  let passfile: { file: string; cleanup: () => void } | null = null;
  const artifactId = newArtifactId();
  // Private .partial output: never published as success.
  const partialFile = path.join(config.dir, "artifacts", `.${artifactId}.dump.partial`);
  const finalFile = artifactDumpPath(artifactId);
  const manifestFile = artifactManifestPath(artifactId);

  try {
    ensurePrivateDir(path.join(config.dir, "artifacts"));
    const sourceUrl = getBackupSourceUrl();
    const conn = parsePostgresUrl(sourceUrl);
    assertTlsPolicy(conn);

    // Tool + server compatibility before any bytes are written.
    const dumpVersionLine = toolVersion(config.pgDumpPath);
    const serverVersionLine = await queryServerVersion(sourceUrl);
    try {
      assertMajorCompatible(serverVersionLine, dumpVersionLine, "pg_dump");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Version mismatch.";
      updateJob(jobId, {
        status: "FAILED",
        completedAt: new Date().toISOString(),
        error: "PostgreSQL tool/server major mismatch.",
        guidance: failureGuidance("tools"),
      });
      void message;
      return { ok: false, artifactId: null, stage: "FAILED", message: "tools" };
    }

    passfile = writePassfile(conn);
    const env = safeEnvForLibpq(conn, passfile?.file ?? null);

    // Complete application database: schema, enums, relations, indexes, FKs,
    // sequences, _prisma_migrations and all feature tables. Never a hardcoded
    // five-table subset — pg_dump selects the whole database.
    const argv = [
      `--host=${conn.host}`,
      `--port=${conn.port}`,
      `--username=${conn.user}`,
      `--dbname=${conn.dbname}`,
      "--format=custom",
      "--no-password",
      "--no-owner",
      "--no-privileges",
      `--file=${partialFile}`,
    ];
    try {
      chmodSync(path.dirname(partialFile), 0o700);
    } catch {
      /* best effort */
    }

    const run = await runBounded({
      binary: config.pgDumpPath,
      argv,
      env,
      timeoutMs: config.maxDurationMs,
    });

    if (run.timedOut) {
      try {
        if (existsSync(partialFile)) unlinkSync(partialFile);
      } catch {
        /* best effort */
      }
      updateJob(jobId, {
        status: "INTERRUPTED",
        completedAt: new Date().toISOString(),
        error: "Backup timed out and was killed.",
        guidance: failureGuidance("timeout"),
      });
      return { ok: false, artifactId: null, stage: "INTERRUPTED", message: "timeout" };
    }
    if (run.exitCode !== 0) {
      try {
        if (existsSync(partialFile)) unlinkSync(partialFile);
      } catch {
        /* best effort */
      }
      updateJob(jobId, {
        status: "FAILED",
        completedAt: new Date().toISOString(),
        error: "pg_dump failed.",
        guidance: failureGuidance("disk"),
      });
      return { ok: false, artifactId: null, stage: "FAILED", message: "pg_dump" };
    }

    // Close output; checksum bytes; inspect archive table-of-contents.
    const { sha256, sizeBytes } = await sha256File(partialFile);
    if (sizeBytes === 0) throw new Error("Empty dump.");
    if (sizeBytes > config.maxBytes) {
      try {
        unlinkSync(partialFile);
      } catch {
        /* best effort */
      }
      updateJob(jobId, {
        status: "FAILED",
        completedAt: new Date().toISOString(),
        error: "Dump exceeded the configured output-size budget.",
        guidance: failureGuidance("disk"),
      });
      return { ok: false, artifactId: null, stage: "FAILED", message: "quota" };
    }

    let tocCount = 0;
    try {
      tocCount = tocEntryCount(partialFile, config.pgRestorePath, env, config.maxDurationMs);
    } catch {
      try {
        unlinkSync(partialFile);
      } catch {
        /* best effort */
      }
      updateJob(jobId, {
        status: "FAILED",
        completedAt: new Date().toISOString(),
        error: "Archive table-of-contents is unreadable.",
        guidance: failureGuidance("disk"),
      });
      return { ok: false, artifactId: null, stage: "FAILED", message: "toc" };
    }
    if (tocCount === 0) {
      try {
        unlinkSync(partialFile);
      } catch {
        /* best effort */
      }
      updateJob(jobId, {
        status: "FAILED",
        completedAt: new Date().toISOString(),
        error: "Archive is empty.",
        guidance: failureGuidance("disk"),
      });
      return { ok: false, artifactId: null, stage: "FAILED", message: "empty" };
    }

    const completedAt = new Date().toISOString();
    // Atomic publish: archive first, then manifest, then catalog entry.
    renameSync(partialFile, finalFile);
    try {
      chmodSync(finalFile, 0o600);
    } catch {
      /* best effort */
    }

    const restoreVersionLine = (() => {
      try {
        return toolVersion(config.pgRestorePath);
      } catch {
        return "unknown";
      }
    })();

    const manifest = {
      schemaVersion: 1,
      artifactId,
      jobId,
      sourceLabel: config.sourceLabel,
      startedAt,
      completedAt,
      sizeBytes,
      sha256,
      pgServerVersion: serverVersionLine.split("\n")[0],
      pgDumpVersion: dumpVersionLine,
      pgRestoreVersion: restoreVersionLine,
      appVersion: appVersion(),
      appBuildId: config.appBuildId,
      migrationLineage: migrationLineage(),
      tocEntries: tocCount,
      // A logical dump excludes cluster-wide roles, host settings, TLS
      // secrets and external app secrets by design; the grant/secret recipe
      // lives in the runbook, never in this manifest.
      includesSecrets: false,
    };
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    try {
      chmodSync(manifestFile, 0o600);
    } catch {
      /* best effort */
    }

    const artifact: BackupArtifactRecord = {
      id: artifactId,
      jobId,
      startedAt,
      createdAt: completedAt,
      sizeBytes,
      sha256,
      pgServerVersion: serverVersionLine.split("\n")[0] ?? "unknown",
      pgDumpVersion: dumpVersionLine,
      appBuildId: config.appBuildId,
      migrationLineage: migrationLineage(),
      sourceLabel: config.sourceLabel,
      tocOk: true,
      pinned: false,
      restoreVerification: null,
      separateCopy: null,
    };
    upsertArtifact(artifact);
    updateJob(jobId, {
      status: "CREATED",
      completedAt,
      artifactId,
      error: null,
      guidance: null,
    });

    // Optional verified copy of that exact artifact, then retention only
    // after safe publication.
    try {
      await copyToSecondary(artifact);
    } catch {
      // A failed copy does not fail the backup; it is recorded as missing
      // separate-copy evidence with a warning in status.
    }
    try {
      pruneAfterPublish();
    } catch {
      // Retention never fails a created backup; warnings surface in status.
    }

    return { ok: true, artifactId, stage: "CREATED", message: `Created ${shortHash(sha256)}.` };
  } catch (error) {
    try {
      if (existsSync(partialFile)) unlinkSync(partialFile);
    } catch {
      /* best effort */
    }
    const message = error instanceof Error ? error.message : "Backup failed.";
    const isPriv = /permission|denied|privilege/i.test(message);
    updateJob(jobId, {
      status: "FAILED",
      completedAt: new Date().toISOString(),
      // Sanitized: never raw stderr, SQL, or absolute infrastructure paths.
      error: isPriv ? "Database role lacks read access." : "Backup failed.",
      guidance: isPriv ? failureGuidance("privileges") : failureGuidance("disk"),
    });
    return { ok: false, artifactId: null, stage: "FAILED", message };
  } finally {
    passfile?.cleanup();
    releaseSourceLock(jobId);
  }
}

/** Copy the exact published artifact to the independently configured destination. */
export async function copyToSecondary(artifact: BackupArtifactRecord): Promise<boolean> {
  const config = getBackupConfig();
  if (!config.secondaryDir || !config.secondaryLabel) return false;
  const src = artifactDumpPath(artifact.id);
  if (!existsSync(src)) return false;
  ensurePrivateDir(config.secondaryDir);
  ensurePrivateDir(path.join(config.secondaryDir, "artifacts"));
  const dest = path.join(config.secondaryDir, "artifacts", `${artifact.id}.dump`);
  const destManifest = path.join(config.secondaryDir, "artifacts", `${artifact.id}.manifest.json`);
  copyFileSync(src, dest);
  try {
    chmodSync(dest, 0o600);
  } catch {
    /* best effort */
  }
  try {
    copyFileSync(artifactManifestPath(artifact.id), destManifest);
    chmodSync(destManifest, 0o600);
  } catch {
    /* best effort */
  }
  // Verify readback before declaring copied.
  const { sha256 } = await sha256File(dest);
  const match = sha256 === artifact.sha256;
  if (!match) {
    try {
      unlinkSync(dest);
    } catch {
      /* best effort */
    }
    return false;
  }
  const catalog = loadCatalog();
  const stored = catalog.artifacts.find((a) => a.id === artifact.id);
  if (stored) {
    stored.separateCopy = {
      destinationLabel: config.secondaryLabel,
      verifiedAt: new Date().toISOString(),
      checksumMatch: true,
      failureDomainNote:
        config.failureDomainNote ??
        "Second destination configured; separate failure domain asserted by deployment, not inferred from path.",
    };
    saveCatalog(catalog);
  }
  return true;
}

/**
 * Retention after safe publication. Keeps the latest restore-verified
 * artifact, pinned pre-change backups, the N most recent, and one daily
 * checkpoint per day for the daily window. Requires explicit operator
 * confirmation (BACKUP_RETENTION_CONFIRMED=true); a failed new job never
 * triggers cleanup that removes the last recoverable artifact.
 */
export function pruneAfterPublish() {
  const config = getBackupConfig();
  if (process.env.BACKUP_RETENTION_CONFIRMED !== "true") return { pruned: 0, reason: "unconfirmed" };
  const catalog = loadCatalog();
  if (catalog.artifacts.length === 0) return { pruned: 0, reason: "empty" };

  const available = catalog.artifacts.filter(artifactAvailable);
  if (available.length <= 1) return { pruned: 0, reason: "last-good" };

  const keep = new Set<string>();
  // Latest restore-verified artifact is always protected.
  const verified = [...catalog.artifacts]
    .filter((a) => a.restoreVerification?.passed)
    .sort((a, b) => Date.parse(b.restoreVerification!.verifiedAt) - Date.parse(a.restoreVerification!.verifiedAt))[0];
  if (verified) keep.add(verified.id);
  for (const a of catalog.artifacts) if (a.pinned) keep.add(a.id);

  const byNewest = [...catalog.artifacts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const a of byNewest.slice(0, config.retentionRecent)) keep.add(a.id);

  // Daily checkpoints: newest artifact per calendar day (UTC) for the window.
  const seenDays = new Set<string>();
  let dailyKept = 0;
  for (const a of byNewest) {
    if (dailyKept >= config.retentionDaily) break;
    const day = new Date(a.createdAt).toISOString().slice(0, 10);
    if (seenDays.has(day)) continue;
    seenDays.add(day);
    keep.add(a.id);
    dailyKept++;
  }

  // Storage cap: drop oldest unprotected first, but never the last available.
  let candidates = byNewest.filter((a) => !keep.has(a.id));
  if (config.storageCapBytes) {
    const total = catalog.artifacts.reduce((sum, a) => sum + (artifactAvailable(a) ? a.sizeBytes : 0), 0);
    if (total > config.storageCapBytes) {
      // Oldest first among candidates is already reverse of byNewest tail.
      candidates = [...candidates].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    } else {
      // Under cap: only prune beyond the recent+daily windows (candidates).
    }
  }

  let pruned = 0;
  for (const victim of candidates) {
    const remaining = loadCatalog().artifacts.filter((a) => a.id !== victim.id && artifactAvailable(a));
    // Re-resolve the record each iteration; never delete the last good.
    const current = loadCatalog().artifacts.find((a) => a.id === victim.id);
    if (!current) continue;
    if (current.pinned) continue;
    if (current.restoreVerification?.passed) {
      const latestVerified = loadCatalog().artifacts
        .filter((a) => a.restoreVerification?.passed && a.id !== victim.id)
        .sort((a, b) => Date.parse(b.restoreVerification!.verifiedAt) - Date.parse(a.restoreVerification!.verifiedAt))[0];
      if (!latestVerified) continue;
    }
    if (remaining.length === 0) continue;
    try {
      const file = artifactDumpPath(victim.id);
      if (existsSync(file)) unlinkSync(file);
      const manifest = artifactManifestPath(victim.id);
      if (existsSync(manifest)) unlinkSync(manifest);
    } catch {
      continue;
    }
    const next = loadCatalog();
    next.artifacts = next.artifacts.filter((a) => a.id !== victim.id);
    saveCatalog(next);
    pruned++;
  }
  return { pruned, reason: "ok" };
}

/** Drain the durable spool: oldest REQUESTED first, one at a time. */
export async function runPendingJobs(limit = 5): Promise<RunResult[]> {
  const catalog = loadCatalog();
  const pending = catalog.jobs
    .filter((j) => j.status === "REQUESTED")
    .sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt))
    .slice(0, limit);
  const results: RunResult[] = [];
  for (const job of pending) {
    results.push(await runBackupJob(job.id));
  }
  return results;
}
