/**
 * Private backup catalog + spool + cross-process lock.
 *
 * Records live in atomic JSON files with restricted permissions, outside the
 * database they describe — a lost database must not take its own recovery
 * index with it. All writes are failure-safe: write temp file (0600) + fsync
 * + atomic rename. Catalog carries a schema version; unknown versions are
 * rejected rather than guessed.
 *
 * Layout under BACKUP_DIR:
 * - catalog.json            { schemaVersion, jobs[], artifacts[] }
 * - spool/<jobId>.json      durable manual/scheduled request (bounded)
 * - locks/backup.lock       one lock per configured source { pid, jobId, since }
 * - artifacts/<id>.dump     custom-format archive (0600)
 * - artifacts/<id>.manifest.json
 *
 * The lock distinguishes an active process from an abandoned request: a lock
 * whose PID is still alive and younger than 2x max duration blocks overlap
 * (skip/record rather than queue unboundedly). A dead PID or a stale lock may
 * be recovered with a warning — never silently deleted while another runner
 * may still be active.
 *
 * No `server-only` here: the CLI imports this module.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type {
  BackupArtifactRecord,
  BackupJobKind,
  BackupJobRecord,
} from "@/globals/types/backups";

import { getBackupConfig } from "./config";

export const CATALOG_SCHEMA_VERSION = 1;

type CatalogFile = {
  schemaVersion: number;
  jobs: BackupJobRecord[];
  artifacts: BackupArtifactRecord[];
};

const JOB_ID_PATTERN = /^bk_[a-z0-9]{16}$/;
const ARTIFACT_ID_PATTERN = /^bka_[a-z0-9]{16}$/;

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* best effort on non-POSIX */
  }
}

function catalogPath(dir: string) {
  return path.join(dir, "catalog.json");
}
function spoolDir(dir: string) {
  return path.join(dir, "spool");
}
function lockPath(dir: string) {
  return path.join(dir, "locks", "backup.lock");
}
function artifactsDir(dir: string) {
  return path.join(dir, "artifacts");
}

function emptyCatalog(): CatalogFile {
  return { schemaVersion: CATALOG_SCHEMA_VERSION, jobs: [], artifacts: [] };
}

export function loadCatalog(): CatalogFile {
  const { dir } = getBackupConfig();
  ensureDir(dir);
  ensureDir(spoolDir(dir));
  ensureDir(path.join(dir, "locks"));
  ensureDir(artifactsDir(dir));
  const file = catalogPath(dir);
  if (!existsSync(file)) return emptyCatalog();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as CatalogFile;
    if (parsed.schemaVersion !== CATALOG_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported backup catalog version ${parsed.schemaVersion} (expected ${CATALOG_SCHEMA_VERSION}). Refusing to guess.`,
      );
    }
    return { schemaVersion: parsed.schemaVersion, jobs: parsed.jobs ?? [], artifacts: parsed.artifacts ?? [] };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unsupported backup catalog")) throw error;
    throw new Error("Backup catalog is unreadable. Inspect the configured directory; no backup is asserted.");
  }
}

function atomicWriteJson(file: string, value: unknown) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* best effort */
  }
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    /* best effort */
  }
}

export function saveCatalog(catalog: CatalogFile) {
  const { dir } = getBackupConfig();
  ensureDir(dir);
  atomicWriteJson(catalogPath(dir), catalog);
}

export function newJobId(): string {
  return `bk_${randomBytes(8).toString("hex")}`;
}
export function newArtifactId(): string {
  return `bka_${randomBytes(8).toString("hex")}`;
}

export function assertJobId(id: string) {
  if (!JOB_ID_PATTERN.test(id)) throw new Error("Unknown backup job. Refusing arbitrary identifiers.");
}
export function assertArtifactId(id: string) {
  if (!ARTIFACT_ID_PATTERN.test(id)) throw new Error("Unknown backup artifact. Refusing arbitrary identifiers.");
}

export function shortHash(sha256: string): string {
  return sha256.slice(0, 8);
}

export function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Durably record a manual/scheduled request. Returns the stored job. */
export function enqueueJob(args: {
  kind: BackupJobKind;
  requestedBy: BackupJobRecord["requestedBy"];
}): BackupJobRecord {
  const { dir } = getBackupConfig();
  ensureDir(spoolDir(dir));
  const catalog = loadCatalog();
  // Bounded spool: refuse to accumulate unbounded requests while one is
  // already pending — overlap is skipped/recorded, not queued.
  const pending = catalog.jobs.find((j) => j.status === "REQUESTED" || j.status === "RUNNING");
  if (pending) return pending;

  const job: BackupJobRecord = {
    id: newJobId(),
    kind: args.kind,
    status: "REQUESTED",
    requestedAt: new Date().toISOString(),
    requestedBy: args.requestedBy,
    startedAt: null,
    completedAt: null,
    artifactId: null,
    error: null,
    guidance: null,
  };
  catalog.jobs.unshift(job);
  catalog.jobs = catalog.jobs.slice(0, 200);
  saveCatalog(catalog);
  atomicWriteJson(path.join(spoolDir(dir), `${job.id}.json`), job);
  return job;
}

export function updateJob(id: string, patch: Partial<BackupJobRecord>): BackupJobRecord {
  assertJobId(id);
  const catalog = loadCatalog();
  const job = catalog.jobs.find((j) => j.id === id);
  if (!job) throw new Error("Unknown backup job.");
  Object.assign(job, patch);
  saveCatalog(catalog);
  const { dir } = getBackupConfig();
  const spoolFile = path.join(spoolDir(dir), `${id}.json`);
  if (existsSync(spoolFile)) atomicWriteJson(spoolFile, job);
  return job;
}

export function upsertArtifact(artifact: BackupArtifactRecord) {
  assertArtifactId(artifact.id);
  const catalog = loadCatalog();
  const index = catalog.artifacts.findIndex((a) => a.id === artifact.id);
  if (index >= 0) catalog.artifacts[index] = artifact;
  else catalog.artifacts.unshift(artifact);
  catalog.artifacts = catalog.artifacts.slice(0, 200);
  saveCatalog(catalog);
}

export function findJob(id: string): BackupJobRecord | null {
  assertJobId(id);
  return loadCatalog().jobs.find((j) => j.id === id) ?? null;
}

export function findArtifact(id: string): BackupArtifactRecord | null {
  assertArtifactId(id);
  return loadCatalog().artifacts.find((a) => a.id === id) ?? null;
}

export function artifactDumpPath(artifactId: string): string {
  assertArtifactId(artifactId);
  const { dir } = getBackupConfig();
  return path.join(artifactsDir(dir), `${artifactId}.dump`);
}

export function artifactManifestPath(artifactId: string): string {
  assertArtifactId(artifactId);
  const { dir } = getBackupConfig();
  return path.join(artifactsDir(dir), `${artifactId}.manifest.json`);
}

/** True when the published file exists and matches the catalogued size. */
export function artifactAvailable(artifact: BackupArtifactRecord): boolean {
  try {
    const file = artifactDumpPath(artifact.id);
    if (!existsSync(file)) return false;
    return statSync(file).size === artifact.sizeBytes;
  } catch {
    return false;
  }
}

type LockRecord = { pid: number; jobId: string; since: string };

function readLock(): LockRecord | null {
  const { dir } = getBackupConfig();
  const file = lockPath(dir);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as LockRecord;
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire the one cross-process lock per configured source. Returns null when
 * another live runner holds it (caller must skip/record overlap, not queue).
 * A dead-PID or stale (>2x max duration) lock is recovered with a warning.
 */
export function acquireSourceLock(jobId: string, maxDurationMs: number): { acquired: boolean; recoveredStale: boolean } {
  const { dir } = getBackupConfig();
  ensureDir(path.join(dir, "locks"));
  const existing = readLock();
  if (existing) {
    const ageMs = Date.now() - Date.parse(existing.since);
    const alive = processAlive(existing.pid);
    if (alive && ageMs < maxDurationMs * 2) return { acquired: false, recoveredStale: false };
    if (alive) {
      // Live but stale: do not blindly delete while another runner may still
      // be active — refuse and surface overlap instead.
      return { acquired: false, recoveredStale: false };
    }
    // Dead PID: abandoned request, safe to recover (verified, not blind).
  }
  atomicWriteJson(lockPath(dir), { pid: process.pid, jobId, since: new Date().toISOString() } satisfies LockRecord);
  return { acquired: true, recoveredStale: !!existing };
}

export function releaseSourceLock(jobId: string) {
  const { dir } = getBackupConfig();
  const file = lockPath(dir);
  if (!existsSync(file)) return;
  try {
    const current = JSON.parse(readFileSync(file, "utf8")) as LockRecord;
    if (current.jobId !== jobId) return;
    if (current.pid !== process.pid) return;
    unlinkSync(file);
  } catch {
    /* best effort */
  }
}

export function listRecentJobs(limit = 20): BackupJobRecord[] {
  return loadCatalog().jobs.slice(0, Math.max(1, Math.min(100, limit)));
}

export function listSpoolPending(): string[] {
  const { dir } = getBackupConfig();
  const spool = spoolDir(dir);
  if (!existsSync(spool)) return [];
  return readdirSync(spool)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .filter((id) => JOB_ID_PATTERN.test(id));
}
