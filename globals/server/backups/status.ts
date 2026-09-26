/**
 * Canonical backup status — one DTO consumed by the Backups console and by
 * #85 health. No second filesystem/provider polling elsewhere.
 *
 * Created, restore-verified, automatic-run, separate-copy and provider
 * evidence stay distinct and correctly dated. Missing artifacts, unknown
 * runner state, disabled configuration and stale schedules are visible
 * without fictional green status. A lost/deleted artifact invalidates its
 * availability even if the creation record remains.
 *
 * No `server-only` here: the CLI also prints this DTO.
 */

import { existsSync } from "node:fs";

import type { BackupStatusDTO } from "@/globals/types/backups";

import { getBackupConfig } from "./config";
import { artifactAvailable, artifactDumpPath, loadCatalog, shortHash } from "./catalog";

function nextExpectedIso(lastRunIso: string | null, scheduleMinutes = 15): string | null {
  if (!lastRunIso) return null;
  const next = Date.parse(lastRunIso) + scheduleMinutes * 60_000;
  if (!Number.isFinite(next)) return null;
  return new Date(next).toISOString();
}

export function getBackupStatus(): BackupStatusDTO {
  const config = getBackupConfig();
  const generatedAt = new Date().toISOString();
  const warnings: string[] = [];

  if (!config.configured) {
    return {
      configured: false,
      configuredReason:
        config.configuredReason ??
        "Backup runner is not configured. Use the operator runbook §1 (direct pg_dump) until it is.",
      sourceLabel: config.sourceLabel,
      latestAttempt: null,
      latestCreatedArtifact: null,
      latestVerifiedRestore: null,
      automaticSchedule: {
        description: config.scheduleDescription,
        timezone: config.timezone,
        runnerOwnership: config.runnerOwnership,
        lastScheduledRunAt: null,
        nextExpectedAt: null,
        overdue: null,
      },
      separateCopy: {
        configured: !!(config.secondaryDir && config.secondaryLabel),
        artifactId: null,
        destinationLabel: config.secondaryLabel,
        verifiedAt: null,
        checksumMatch: null,
        failureDomainNote: config.failureDomainNote,
      },
      providerRecovery: {
        configured: false,
        providerName: config.providerName,
        recoveryWindow: null,
        lastVerified: null,
        note: "Provider PITR not configured / not verified.",
      },
      warnings: ["Backup automation is not configured."],
      generatedAt,
    };
  }

  let catalog;
  try {
    catalog = loadCatalog();
  } catch {
    return {
      configured: true,
      configuredReason: null,
      sourceLabel: config.sourceLabel,
      latestAttempt: null,
      latestCreatedArtifact: null,
      latestVerifiedRestore: null,
      automaticSchedule: {
        description: config.scheduleDescription,
        timezone: config.timezone,
        runnerOwnership: config.runnerOwnership,
        lastScheduledRunAt: null,
        nextExpectedAt: null,
        overdue: null,
      },
      separateCopy: {
        configured: !!(config.secondaryDir && config.secondaryLabel),
        artifactId: null,
        destinationLabel: config.secondaryLabel,
        verifiedAt: null,
        checksumMatch: null,
        failureDomainNote: config.failureDomainNote,
      },
      providerRecovery: {
        configured: !!config.providerName,
        providerName: config.providerName,
        recoveryWindow: config.providerRecoveryWindow,
        lastVerified: config.providerLastVerified,
        note: config.providerName ? "Provider evidence is operator-verified only." : "Provider PITR not configured / not verified.",
      },
      warnings: ["Backup catalog is unreadable. No backup is asserted."],
      generatedAt,
    };
  }

  const latestAttempt = catalog.jobs[0]
    ? {
        jobId: catalog.jobs[0].id,
        kind: catalog.jobs[0].kind,
        status: catalog.jobs[0].status,
        requestedAt: catalog.jobs[0].requestedAt,
        completedAt: catalog.jobs[0].completedAt,
        error: catalog.jobs[0].error,
      }
    : null;

  const createdCandidates = [...catalog.artifacts].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const latestAvailable = createdCandidates.find((a) => {
    try {
      return existsSync(artifactDumpPath(a.id)) && artifactAvailable(a);
    } catch {
      return false;
    }
  });
  for (const a of createdCandidates) {
    if (a.id !== latestAvailable?.id) {
      try {
        if (!existsSync(artifactDumpPath(a.id))) {
          warnings.push(`Artifact ${shortHash(a.sha256)} is catalogued but its file is missing.`);
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  const latestCreatedArtifact = latestAvailable
    ? {
        artifactId: latestAvailable.id,
        jobId: latestAvailable.jobId,
        createdAt: latestAvailable.createdAt,
        sizeBytes: latestAvailable.sizeBytes,
        sha256Short: shortHash(latestAvailable.sha256),
        tocOk: latestAvailable.tocOk,
        restoreVerified: !!latestAvailable.restoreVerification?.passed,
        available: true,
      }
    : createdCandidates[0]
      ? {
          artifactId: createdCandidates[0].id,
          jobId: createdCandidates[0].jobId,
          createdAt: createdCandidates[0].createdAt,
          sizeBytes: createdCandidates[0].sizeBytes,
          sha256Short: shortHash(createdCandidates[0].sha256),
          tocOk: createdCandidates[0].tocOk,
          restoreVerified: !!createdCandidates[0].restoreVerification?.passed,
          available: false,
        }
      : null;

  const verifiedList = catalog.artifacts
    .filter((a) => a.restoreVerification?.passed)
    .sort((a, b) => Date.parse(b.restoreVerification!.verifiedAt) - Date.parse(a.restoreVerification!.verifiedAt));
  const latestVerifiedRestore = verifiedList[0]
    ? {
        artifactId: verifiedList[0].id,
        jobId: verifiedList[0].restoreVerification!.jobId,
        verifiedAt: verifiedList[0].restoreVerification!.verifiedAt,
        targetLabel: verifiedList[0].restoreVerification!.targetLabel,
      }
    : null;

  const scheduledRuns = catalog.jobs
    .filter((j) => j.kind === "scheduled" && (j.status === "CREATED" || j.status === "RESTORE_VERIFIED"))
    .sort((a, b) => Date.parse(b.completedAt ?? b.requestedAt) - Date.parse(a.completedAt ?? a.requestedAt));
  const lastScheduledRunAt = scheduledRuns[0]?.completedAt ?? scheduledRuns[0]?.requestedAt ?? null;
  // Manual creation never resets the automatic clock: only scheduled jobs
  // count here.
  const nextExpectedAt = nextExpectedIso(lastScheduledRunAt);
  const overdue =
    lastScheduledRunAt && nextExpectedAt
      ? Date.parse(nextExpectedAt) < Date.now()
      : lastScheduledRunAt
        ? false
        : null;
  if (overdue) warnings.push("Automatic backup run is overdue.");

  const withCopy = [...catalog.artifacts]
    .filter((a) => a.separateCopy?.checksumMatch)
    .sort((a, b) => Date.parse(b.separateCopy!.verifiedAt) - Date.parse(a.separateCopy!.verifiedAt))[0];
  const separateCopy = {
    configured: !!(config.secondaryDir && config.secondaryLabel),
    artifactId: withCopy?.id ?? null,
    destinationLabel: withCopy?.separateCopy?.destinationLabel ?? config.secondaryLabel,
    verifiedAt: withCopy?.separateCopy?.verifiedAt ?? null,
    checksumMatch: withCopy?.separateCopy?.checksumMatch ?? null,
    failureDomainNote:
      withCopy?.separateCopy?.failureDomainNote ??
      config.failureDomainNote ??
      (config.secondaryDir
        ? "Second destination configured; separate failure domain asserted by deployment, not inferred from path."
        : "No second destination configured."),
  };
  if (separateCopy.configured && !withCopy) {
    warnings.push("Second destination is configured but no verified copy exists yet.");
  }

  const providerRecovery = {
    configured: !!config.providerName,
    providerName: config.providerName,
    recoveryWindow: config.providerRecoveryWindow,
    lastVerified: config.providerLastVerified,
    note: config.providerName
      ? (config.providerLastVerified
          ? "Provider recovery is operator-verified evidence, not an automatic guarantee."
          : "Provider named but recovery window is not verified.")
      : "Provider PITR not configured / not verified.",
  };
  if (config.providerName && !config.providerLastVerified) {
    warnings.push("Provider recovery is named but has no verified snapshot evidence.");
  }
  if (process.env.BACKUP_RETENTION_CONFIRMED !== "true" && catalog.artifacts.length > 0) {
    warnings.push("Retention policy is not confirmed; old archives are retained, never auto-deleted.");
  }

  return {
    configured: true,
    configuredReason: null,
    sourceLabel: config.sourceLabel,
    latestAttempt,
    latestCreatedArtifact,
    latestVerifiedRestore,
    automaticSchedule: {
      description: config.scheduleDescription,
      timezone: config.timezone,
      runnerOwnership: config.runnerOwnership,
      lastScheduledRunAt,
      nextExpectedAt,
      overdue,
    },
    separateCopy,
    providerRecovery,
    warnings,
    generatedAt,
  };
}
