/**
 * Backup DTOs shared by the server catalog/runner, the admin API, and the
 * operator console. No server imports here on purpose: the CLI and the client
 * hooks import these types without pulling `server-only` or Prisma into the
 * graph.
 *
 * A created dump is not labelled restore-verified until its isolated restore
 * succeeds. A manually requested backup never resets the automatic scheduler's
 * clock. A copy on the same disk is never described as off-site protection.
 */

export type BackupJobStage =
  | "REQUESTED"
  | "RUNNING"
  | "CREATED"
  | "RESTORE_VERIFIED"
  | "FAILED"
  | "INTERRUPTED";

export type BackupJobKind = "manual" | "scheduled";

export type BackupJobRecord = {
  id: string;
  kind: BackupJobKind;
  status: BackupJobStage;
  requestedAt: string;
  requestedBy: { id: string; name: string; email: string } | { id: "schedule"; name: string; email: string };
  startedAt: string | null;
  completedAt: string | null;
  artifactId: string | null;
  /** Safe one-line failure summary. Never credentials, SQL, raw stderr or paths. */
  error: string | null;
  /** Operator next-action guidance for a failed job. */
  guidance: string | null;
};

export type BackupArtifactRecord = {
  id: string;
  jobId: string;
  /** When pg_dump started. */
  startedAt: string;
  /** When the artifact was atomically published. */
  createdAt: string;
  sizeBytes: number;
  sha256: string;
  pgServerVersion: string;
  pgDumpVersion: string;
  appBuildId: string | null;
  migrationLineage: string[];
  sourceLabel: string;
  /** Archive table-of-contents was readable via pg_restore --list. */
  tocOk: boolean;
  /** Explicit operator pin (pre-change backup). Excluded from retention pruning. */
  pinned: boolean;
  restoreVerification: {
    jobId: string;
    verifiedAt: string;
    targetLabel: string;
    passed: boolean;
    checks: string[];
  } | null;
  separateCopy: {
    destinationLabel: string;
    verifiedAt: string;
    checksumMatch: boolean;
    failureDomainNote: string;
  } | null;
};

export type BackupJobDetail = {
  job: BackupJobRecord;
  artifact: BackupArtifactRecord | null;
};

export type BackupStatusDTO = {
  configured: boolean;
  /** Actionable reason when unconfigured. Never a spinner with no explanation. */
  configuredReason: string | null;
  sourceLabel: string;
  latestAttempt: {
    jobId: string;
    kind: BackupJobKind;
    status: BackupJobStage;
    requestedAt: string;
    completedAt: string | null;
    error: string | null;
  } | null;
  latestCreatedArtifact: {
    artifactId: string;
    jobId: string;
    createdAt: string;
    sizeBytes: number;
    sha256Short: string;
    tocOk: boolean;
    /** False until an isolated restore passes for this exact artifact. */
    restoreVerified: boolean;
    /** False when the file is missing even if the catalog row remains. */
    available: boolean;
  } | null;
  latestVerifiedRestore: {
    artifactId: string;
    jobId: string;
    verifiedAt: string;
    targetLabel: string;
  } | null;
  automaticSchedule: {
    description: string;
    timezone: string;
    runnerOwnership: string;
    lastScheduledRunAt: string | null;
    nextExpectedAt: string | null;
    /** True when a scheduled run is overdue. Never green when unknown. */
    overdue: boolean | null;
  };
  separateCopy: {
    configured: boolean;
    artifactId: string | null;
    destinationLabel: string | null;
    verifiedAt: string | null;
    checksumMatch: boolean | null;
    failureDomainNote: string | null;
  };
  providerRecovery: {
    configured: boolean;
    providerName: string | null;
    recoveryWindow: string | null;
    lastVerified: string | null;
    note: string | null;
  };
  warnings: string[];
  generatedAt: string;
};
