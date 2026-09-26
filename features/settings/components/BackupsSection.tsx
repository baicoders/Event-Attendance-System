"use client";

import { Fragment, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, RefreshCw, LifeBuoy, ShieldAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/globals/components/shad-cn/alert";
import { Button } from "@/globals/components/shad-cn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/globals/components/shad-cn/dialog";
import { Skeleton } from "@/globals/components/shad-cn/skeleton";
import StatusBadge from "@/globals/components/shared/StatusBadge";
import { toastDanger, toastSuccess, toastWarning } from "@/globals/components/shared/toasts";
import { surface, type as typeToken } from "@/globals/constants/designTokens";
import { useConfirm } from "@/globals/contexts/ConfirmModalContext";
import { cn } from "@/globals/libs/shad-cn";
import { queryKeys } from "@/globals/utils/queryKeys";
import {
  useBackupJob,
  useBackupJobs,
  useBackupStatus,
  useRequestBackup,
} from "@/globals/hooks/useBackups";
import type { BackupJobRecord } from "@/globals/types/backups";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const JOB_TONE = {
  REQUESTED: "info",
  RUNNING: "info",
  CREATED: "success",
  RESTORE_VERIFIED: "success",
  FAILED: "danger",
  INTERRUPTED: "warning",
} as const;

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1 border-b border-slate-100 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
    <dt className="text-sm text-slate-500">{label}</dt>
    <dd className="text-sm font-medium text-slate-900 sm:text-right">{children}</dd>
  </div>
);

function JobDetails({ jobId }: { jobId: string }) {
  const { data, isLoading, isError } = useBackupJob(jobId);
  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (isError || !data) return <p className="text-sm text-slate-500">Couldn&apos;t read job details.</p>;
  const { job, artifact } = data;
  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
      <dl className="space-y-1.5">
        <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
          <dt className="text-slate-500">Job</dt>
          <dd className="font-mono text-xs">{job.id}</dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
          <dt className="text-slate-500">Requested</dt>
          <dd>
            {formatTime(job.requestedAt)} ·{" "}
            {job.requestedBy.id === "schedule" ? "Schedule" : `${job.requestedBy.name} (${job.requestedBy.email})`}
          </dd>
        </div>
        {job.startedAt ? (
          <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
            <dt className="text-slate-500">Started</dt>
            <dd>{formatTime(job.startedAt)}</dd>
          </div>
        ) : null}
        {job.completedAt ? (
          <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
            <dt className="text-slate-500">Completed</dt>
            <dd>{formatTime(job.completedAt)}</dd>
          </div>
        ) : null}
        {artifact ? (
          <>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
              <dt className="text-slate-500">Artifact</dt>
              <dd className="font-mono text-xs">
                {artifact.id} · {formatBytes(artifact.sizeBytes)} · sha {artifact.sha256.slice(0, 8)}
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
              <dt className="text-slate-500">Captured</dt>
              <dd>
                {formatTime(artifact.startedAt)} → {formatTime(artifact.createdAt)}
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
              <dt className="text-slate-500">Archive check</dt>
              <dd>{artifact.tocOk ? "Table-of-contents readable" : "Not verified"}</dd>
            </div>
            {artifact.restoreVerification ? (
              <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                <dt className="text-slate-500">Restore test</dt>
                <dd>
                  {formatTime(artifact.restoreVerification.verifiedAt)} · {artifact.restoreVerification.targetLabel}
                </dd>
              </div>
            ) : null}
            {artifact.separateCopy ? (
              <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                <dt className="text-slate-500">Second copy</dt>
                <dd>
                  {artifact.separateCopy.destinationLabel} · {formatTime(artifact.separateCopy.verifiedAt)}
                </dd>
              </div>
            ) : null}
          </>
        ) : null}
        {job.error ? (
          <div className="flex flex-col gap-1">
            <dt className="text-slate-500">Result</dt>
            <dd>{job.error}</dd>
            {job.guidance ? <dd className="text-slate-600">{job.guidance}</dd> : null}
          </div>
        ) : null}
      </dl>
      <p className="mt-2 text-xs text-slate-500">
        Detail never exposes credentials, SQL, raw tool output, or infrastructure paths.
      </p>
    </div>
  );
}

function JobsTable({ jobs }: { jobs: BackupJobRecord[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (jobs.length === 0) {
    return <p className={cn(typeToken.muted, "mt-3")}>No backup jobs yet. Request one, or wait for the schedule.</p>;
  }
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3 font-semibold">Requested</th>
            <th className="py-2 pr-3 font-semibold">By</th>
            <th className="py-2 pr-3 font-semibold">Result</th>
            <th className="py-2 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <Fragment key={job.id}>
              <tr className="border-b border-slate-100 last:border-b-0">
                <td className="py-2 pr-3 tabular-nums">{formatTime(job.requestedAt)}</td>
                <td className="py-2 pr-3">
                  {job.kind === "scheduled" || job.requestedBy.id === "schedule"
                    ? "Schedule"
                    : `${job.requestedBy.name} / admin`}
                </td>
                <td className="py-2 pr-3">
                  <StatusBadge tone={JOB_TONE[job.status]} withDot>
                    {job.status === "CREATED"
                      ? "Created"
                      : job.status === "RESTORE_VERIFIED"
                        ? "Restore verified"
                        : job.status === "REQUESTED"
                          ? "Requested"
                          : job.status === "RUNNING"
                            ? "Running"
                            : job.status === "INTERRUPTED"
                              ? "Interrupted"
                              : "Failed"}
                  </StatusBadge>
                  {job.error ? <p className="mt-1 text-xs text-slate-500">{job.error}</p> : null}
                  {job.guidance && (job.status === "FAILED" || job.status === "INTERRUPTED") ? (
                    <p className="mt-0.5 text-xs text-slate-500">{job.guidance}</p>
                  ) : null}
                </td>
                <td className="py-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExpanded((current) => (current === job.id ? null : job.id))}
                    aria-expanded={expanded === job.id}
                  >
                    {expanded === job.id ? "Hide" : "Details"}
                  </Button>
                </td>
              </tr>
              {expanded === job.id ? (
                <tr>
                  <td colSpan={4} className="pb-3">
                    <JobDetails jobId={job.id} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Operator-visible backup console. A completed dump, a copy in a separate
 * destination, a provider window, and an exercised restore are different
 * facts and are displayed separately. This console never downloads database
 * files and never restores production.
 */
const BackupsSection = () => {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const statusQuery = useBackupStatus(true);
  const jobsQuery = useBackupJobs(true);
  const requestBackup = useRequestBackup();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.backups.all() });
  };

  const handleCreate = async () => {
    const sourceLabel = statusQuery.data?.sourceLabel ?? "the configured database";
    const confirmed = await confirm({
      title: "Create backup",
      description: `Create a backup of "${sourceLabel}" now? The archive contains student data, user password hashes, and potentially retained audit data. It is stored in private runner storage — never downloaded through this console.`,
    });
    if (!confirmed) return;
    try {
      const result = await requestBackup.mutateAsync();
      if (result.deduped) {
        toastWarning("A backup is already running.", "The existing job was kept; overlap is not queued.");
      } else {
        toastSuccess("Backup requested.", "The runner will pick it up; this list refreshes automatically.");
      }
    } catch (error) {
      toastDanger("Couldn't request backup.", error instanceof Error ? error.message : undefined);
    }
  };

  if (statusQuery.isLoading) {
    return (
      <section className={cn(surface.card, "p-6")}>
        <h2 className={typeToken.sectionTitle}>Backups</h2>
        <div className="mt-4 space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-6 w-full" />
          ))}
        </div>
      </section>
    );
  }

  if (statusQuery.isError || !statusQuery.data) {
    return (
      <section className={cn(surface.card, "p-6")}>
        <h2 className={typeToken.sectionTitle}>Backups</h2>
        <p className={cn(typeToken.muted, "mt-2")}>Couldn&apos;t read backup status.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={refresh}>
          <RefreshCw /> Retry
        </Button>
      </section>
    );
  }

  const status = statusQuery.data;
  const jobs = jobsQuery.data?.jobs ?? [];

  return (
    <section className={cn(surface.card, "p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">PostgreSQL • {status.sourceLabel}</p>
          <h2 className={typeToken.sectionTitle}>Backups</h2>
          <p className={cn(typeToken.muted, "mt-1")}>
            A dump, a second copy, and an exercised restore are different facts. Checked{" "}
            {new Date(status.generatedAt).toLocaleTimeString()}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={statusQuery.isFetching}>
            <RefreshCw /> {statusQuery.isFetching ? "Refreshing…" : "Refresh status"}
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <LifeBuoy /> Recovery instructions
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Recovery instructions</DialogTitle>
                <DialogDescription>
                  Privileged operator procedure. Never restore over the live database from this console.
                </DialogDescription>
              </DialogHeader>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
                <li>Identify the verified artifact (restore-verified, matching checksum) and the authorized operator.</li>
                <li>
                  Provision an empty recovery database (<code className="rounded bg-slate-100 px-1 text-xs">eas_restore_…</code>)
                  and confirm it is not live, development, or another operator&apos;s target.
                </li>
                <li>
                  Restore with the tested <code className="rounded bg-slate-100 px-1 text-xs">pg_restore</code> recipe,
                  apply the reviewed ownership/grant recipe, then verify schema, relations, sequences, and timeout-only
                  records before marking restore-verified.
                </li>
                <li>
                  For real disaster recovery: block new admission, stop/drain every writer, preserve the displaced live
                  database, rotate <code className="rounded bg-slate-100 px-1 text-xs">AUTH_SECRET</code>, review restored
                  users/roles, then switch configuration to the verified target and smoke-check before reopening.
                </li>
                <li>Full commands live in the operator runbook §1. Browser-local journals are not part of server backups.</li>
              </ol>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {!status.configured ? (
        <Alert variant="destructive" className="mt-4">
          <ShieldAlert />
          <AlertTitle>Backup automation is not configured</AlertTitle>
          <AlertDescription>
            {status.configuredReason ?? "The runner is not configured."} Use the operator runbook §1 (direct{" "}
            <code className="rounded bg-rose-50 px-1 text-xs">pg_dump</code>) until this is set up. Creation is disabled —
            nothing here spins or fabricates a recent backup.
          </AlertDescription>
        </Alert>
      ) : null}

      <dl className="mt-4">
        <Row label="Latest dump">
          {status.latestCreatedArtifact ? (
            <span>
              Created {formatTime(status.latestCreatedArtifact.createdAt)} · {status.latestCreatedArtifact.sha256Short} ·{" "}
              {formatBytes(status.latestCreatedArtifact.sizeBytes)} ·{" "}
              {status.latestCreatedArtifact.tocOk ? "archive validated" : "archive unchecked"} ·{" "}
              {status.latestCreatedArtifact.restoreVerified ? (
                <StatusBadge tone="success" withDot>
                  Restore verified
                </StatusBadge>
              ) : (
                <StatusBadge tone="warning" withDot>
                  Created, not yet restore-verified
                </StatusBadge>
              )}
              {!status.latestCreatedArtifact.available ? (
                <span className="ml-2">
                  <StatusBadge tone="danger" withDot>
                    File missing
                  </StatusBadge>
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-slate-500">No dump yet — unknown, not green.</span>
          )}
        </Row>
        <Row label="Latest restore test">
          {status.latestVerifiedRestore ? (
            <span>
              {formatTime(status.latestVerifiedRestore.verifiedAt)} · separate test database ·{" "}
              <StatusBadge tone="success" withDot>
                Passed
              </StatusBadge>
            </span>
          ) : (
            <span className="text-slate-500">No exercised restore yet.</span>
          )}
        </Row>
        <Row label="Automatic backups">
          <span>
            {status.automaticSchedule.lastScheduledRunAt
              ? `Last scheduled run ${formatTime(status.automaticSchedule.lastScheduledRunAt)}`
              : "No scheduled run yet"}
            {status.automaticSchedule.nextExpectedAt
              ? ` · next expected ${formatTime(status.automaticSchedule.nextExpectedAt)}`
              : ""}
            {status.automaticSchedule.overdue ? (
              <span className="ml-2">
                <StatusBadge tone="warning" withDot>
                  Overdue
                </StatusBadge>
              </span>
            ) : null}
            <span className="block text-xs font-normal text-slate-500">
              {status.automaticSchedule.description} · {status.automaticSchedule.timezone} ·{" "}
              {status.automaticSchedule.runnerOwnership}. Manual requests never reset this clock.
            </span>
          </span>
        </Row>
        <Row label="Separate copy">
          {status.separateCopy.configured && status.separateCopy.artifactId ? (
            <span>
              Dump {status.separateCopy.artifactId.slice(0, 8)}… verified in {status.separateCopy.destinationLabel} ·{" "}
              {formatTime(status.separateCopy.verifiedAt)}
              <span className="block text-xs font-normal text-slate-500">{status.separateCopy.failureDomainNote}</span>
            </span>
          ) : status.separateCopy.configured ? (
            <span className="text-slate-500">Second destination configured; no verified copy yet.</span>
          ) : (
            <span className="text-slate-500">No second destination configured.</span>
          )}
        </Row>
        <Row label="Provider PITR">
          {status.providerRecovery.configured ? (
            <span>
              {status.providerRecovery.providerName} · {status.providerRecovery.recoveryWindow ?? "window unknown"} ·{" "}
              {status.providerRecovery.lastVerified ? `verified ${formatTime(status.providerRecovery.lastVerified)}` : "not verified"}
            </span>
          ) : (
            <span className="text-slate-500">Not configured / not verified.</span>
          )}
        </Row>
      </dl>

      {status.warnings.length > 0 ? (
        <Alert className="mt-4">
          <DatabaseBackup />
          <AlertTitle>Attention</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-5">
              {status.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={handleCreate} disabled={!status.configured || requestBackup.isPending}>
          <DatabaseBackup /> {requestBackup.isPending ? "Requesting…" : "Create backup"}
        </Button>
      </div>
      <p className={cn(typeToken.muted, "mt-3 text-xs")}>
        This console does not download database files or restore production. A readable dump can contain executable
        database objects; only restore trusted artifacts into isolated targets.
      </p>

      <h3 className="mt-6 text-sm font-semibold text-slate-900">Recent jobs</h3>
      {jobsQuery.isLoading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : jobsQuery.isError ? (
        <p className={cn(typeToken.muted, "mt-2")}>Couldn&apos;t read recent jobs.</p>
      ) : (
        <JobsTable jobs={jobs} />
      )}
    </section>
  );
};

export default BackupsSection;
