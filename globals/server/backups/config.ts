/**
 * Backup deployment configuration — single owner for the web status reader,
 * the API request path, and the controlled CLI runner.
 *
 * No `server-only` or `next/headers` here on purpose: the command-line runner
 * imports this module, so framework imports must stay out of the graph (same
 * rule as `globals/utils/credentials.ts`).
 *
 * Environment (all optional except the database contract from #51):
 * - BACKUP_DIR: private artifact storage (default `<repo>/backups` is NOT
 *   used in production; set an explicit restricted directory). Holds catalog,
 *   spool, locks, artifacts, manifests.
 * - BACKUP_SOURCE_LABEL: approved display label for the configured database
 *   (default "School attendance"). Never a connection string.
 * - BACKUP_PG_DUMP_PATH / BACKUP_PG_RESTORE_PATH: version-matched tool paths.
 *   Defaults to `pg_dump` / `pg_restore` on PATH.
 * - BACKUP_MAX_DURATION_MS: bounded execution (default 120000). Deployment
 *   configuration only.
 * - BACKUP_MAX_BYTES: output-size guard (default 2GiB).
 * - BACKUP_RETENTION_RECENT / BACKUP_RETENTION_DAILY: defaults 48 / 7.
 * - BACKUP_STORAGE_CAP_BYTES: optional cap; pruning never removes the last
 *   recoverable artifact.
 * - BACKUP_SCHEDULE_DESC / BACKUP_TIMEZONE / BACKUP_RUNNER_OWNERSHIP:
 *   deployment-recorded schedule evidence (not a new app scheduler).
 * - BACKUP_SECONDARY_DIR / BACKUP_SECONDARY_LABEL / BACKUP_FAILURE_DOMAIN_NOTE:
 *   independently configured second destination. Whether it is a separate
 *   failure domain is a deployment assertion, never inferred from a path.
 * - BACKUP_PROVIDER_NAME / BACKUP_PROVIDER_RECOVERY_WINDOW /
 *   BACKUP_PROVIDER_LAST_VERIFIED: optional managed-PITR evidence. Absent
 *   means not configured / not verified — never inferred from a brand.
 * - BACKUP_APP_BUILD_ID: deployment-supplied build identifier for manifests.
 */

import { existsSync } from "node:fs";
import path from "node:path";

export type BackupConfig = {
  configured: boolean;
  configuredReason: string | null;
  dir: string;
  sourceLabel: string;
  pgDumpPath: string;
  pgRestorePath: string;
  psqlPath: string;
  maxDurationMs: number;
  maxBytes: number;
  retentionRecent: number;
  retentionDaily: number;
  storageCapBytes: number | null;
  scheduleDescription: string;
  timezone: string;
  runnerOwnership: string;
  secondaryDir: string | null;
  secondaryLabel: string | null;
  failureDomainNote: string | null;
  providerName: string | null;
  providerRecoveryWindow: string | null;
  providerLastVerified: string | null;
  appBuildId: string | null;
};

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultBackupDir(): string {
  // Private default beside the repo. Production must set BACKUP_DIR to
  // restricted storage; the default is a local-dev convenience, never a
  // claim about durability.
  return path.resolve(process.cwd(), "backups");
}

export function getBackupConfig(): BackupConfig {
  const dir = process.env.BACKUP_DIR?.trim() || defaultBackupDir();
  const sourceLabel = process.env.BACKUP_SOURCE_LABEL?.trim() || "School attendance";
  const pgDumpPath = process.env.BACKUP_PG_DUMP_PATH?.trim() || "pg_dump";
  const pgRestorePath = process.env.BACKUP_PG_RESTORE_PATH?.trim() || "pg_restore";
  const psqlPath = process.env.BACKUP_PSQL_PATH?.trim() || "psql";

  const problems: string[] = [];
  // The database contract itself comes from #51: DIRECT_URL (preferred) or
  // DATABASE_URL must be a PostgreSQL URL. The backup runner never accepts a
  // caller-supplied URL, path, or executable beyond these configured values.
  const maintenanceUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!maintenanceUrl) {
    problems.push("DIRECT_URL / DATABASE_URL is not set.");
  } else if (
    !maintenanceUrl.startsWith("postgresql://") &&
    !maintenanceUrl.startsWith("postgres://")
  ) {
    problems.push("Configured database URL is not PostgreSQL.");
  }

  const toolsMissing: string[] = [];
  // PATH resolution is checked by the runner at execution time (version match
  // included); here we only record the configured paths.
  if (!pgDumpPath) toolsMissing.push("pg_dump");
  if (!pgRestorePath) toolsMissing.push("pg_restore");

  // A directory that cannot be created is an unconfigured runner, not a
  // spinner: the UI disables creation and shows this reason.
  let dirProblem: string | null = null;
  try {
    if (!existsSync(dir)) {
      // Do not create it here: creation happens with restricted permissions
      // (0700) in the catalog layer. Presence is not required for "configured".
    }
  } catch {
    dirProblem = `Backup directory is not accessible: ${dir}`;
  }

  const configuredReason =
    problems.length > 0
      ? problems.join(" ")
      : toolsMissing.length > 0
        ? `Backup tools not configured: ${toolsMissing.join(", ")}.`
        : dirProblem;

  return {
    configured: !configuredReason,
    configuredReason: configuredReason ?? null,
    dir,
    sourceLabel,
    pgDumpPath,
    pgRestorePath,
    psqlPath,
    maxDurationMs: intEnv("BACKUP_MAX_DURATION_MS", 120_000),
    maxBytes: intEnv("BACKUP_MAX_BYTES", 2 * 1024 * 1024 * 1024),
    retentionRecent: intEnv("BACKUP_RETENTION_RECENT", 48),
    retentionDaily: intEnv("BACKUP_RETENTION_DAILY", 7),
    storageCapBytes: process.env.BACKUP_STORAGE_CAP_BYTES
      ? intEnv("BACKUP_STORAGE_CAP_BYTES", 0) || null
      : null,
    scheduleDescription:
      process.env.BACKUP_SCHEDULE_DESC?.trim() ||
      "Every 15 minutes during event operations, daily otherwise",
    timezone: process.env.BACKUP_TIMEZONE?.trim() || "Asia/Manila",
    runnerOwnership:
      process.env.BACKUP_RUNNER_OWNERSHIP?.trim() ||
      "Supervised maintenance host (OS timer invokes backup:run)",
    secondaryDir: process.env.BACKUP_SECONDARY_DIR?.trim() || null,
    secondaryLabel: process.env.BACKUP_SECONDARY_LABEL?.trim() || null,
    failureDomainNote: process.env.BACKUP_FAILURE_DOMAIN_NOTE?.trim() || null,
    providerName: process.env.BACKUP_PROVIDER_NAME?.trim() || null,
    providerRecoveryWindow: process.env.BACKUP_PROVIDER_RECOVERY_WINDOW?.trim() || null,
    providerLastVerified: process.env.BACKUP_PROVIDER_LAST_VERIFIED?.trim() || null,
    appBuildId: process.env.BACKUP_APP_BUILD_ID?.trim() || null,
  };
}

/** Maintenance endpoint for dumps: DIRECT_URL preferred, DATABASE_URL fallback. */
export function getBackupSourceUrl(): string {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Neither DIRECT_URL nor DATABASE_URL is set.");
  const trimmed = url.trim();
  if (!trimmed.startsWith("postgresql://") && !trimmed.startsWith("postgres://")) {
    throw new Error("Backup source must be a PostgreSQL URL. Refusing file/SQLite targets.");
  }
  return trimmed;
}
