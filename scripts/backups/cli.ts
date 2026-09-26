/**
 * Controlled backup CLI — the runner. One supervised maintenance process per
 * configured source; OS timers invoke the same commands the app spool uses.
 *
 * Usage:
 *   pnpm backup:status                          print canonical status JSON
 *   pnpm backup:run [--job bk_...] [--scheduled] [--limit N]
 *   pnpm backup:request --kind manual|scheduled (operator terminal)
 *   pnpm backup:verify <bka_...> [--keep]
 *   pnpm backup:jobs [--limit N]
 *   pnpm backup:prune
 *
 * Safety: accepts only configured job/artifact IDs, never arbitrary SQL,
 * paths, connection strings, or executable locations. Passwords never appear
 * in arguments or stdout. Restore targets are uniquely named isolated
 * databases; live/dev names are refused.
 */
import "dotenv/config";

import { getBackupConfig } from "@/globals/server/backups/config";
import {
  assertArtifactId,
  assertJobId,
  enqueueJob,
  listRecentJobs,
  loadCatalog,
  saveCatalog,
} from "@/globals/server/backups/catalog";
import { pruneAfterPublish, runBackupJob, runPendingJobs } from "@/globals/server/backups/runner";
import { getBackupStatus } from "@/globals/server/backups/status";
import { verifyArtifact } from "@/globals/server/backups/verify";

function usage(): never {
  console.error(
    [
      "Usage:",
      "  pnpm backup:status",
      "  pnpm backup:run [--job bk_...] [--scheduled] [--limit N]",
      "  pnpm backup:request --kind manual|scheduled",
      "  pnpm backup:verify <bka_...> [--keep]",
      "  pnpm backup:jobs [--limit N]",
      "  pnpm backup:prune",
    ].join("\n"),
  );
  process.exit(2);
}

function flag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}
function has(argv: string[], name: string): boolean {
  return argv.includes(name);
}

async function main() {
  const [, , command, ...rest] = process.argv;
  if (!command) usage();

  if (command === "status") {
    const status = getBackupStatus();
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (command === "jobs") {
    const limitRaw = flag(rest, "--limit");
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 20;
    for (const job of listRecentJobs(Number.isFinite(limit) ? limit : 20)) {
      console.log(
        `${job.id} ${job.kind} ${job.status} requested=${job.requestedAt} artifact=${job.artifactId ?? "-"}`,
      );
    }
    return;
  }

  if (command === "request") {
    const kind = flag(rest, "--kind") ?? "manual";
    if (kind !== "manual" && kind !== "scheduled") usage();
    const job = enqueueJob({
      kind,
      requestedBy:
        kind === "scheduled"
          ? { id: "schedule", name: "Schedule", email: "schedule" }
          : { id: "operator", name: "Operator", email: "operator" },
    });
    console.log(JSON.stringify(job, null, 2));
    return;
  }

  if (command === "run") {
    const config = getBackupConfig();
    if (!config.configured) {
      console.error(`Refusing: ${config.configuredReason ?? "runner is not configured."}`);
      process.exit(1);
    }
    const jobId = flag(rest, "--job");
    if (jobId) {
      assertJobId(jobId);
      const result = await runBackupJob(jobId);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 1);
    }
    const scheduled = has(rest, "--scheduled");
    if (scheduled) {
      // Scheduled tick: create a scheduled request when due, then drain.
      // Overlap is skipped, not queued (enqueueJob returns the pending job).
      const job = enqueueJob({
        kind: "scheduled",
        requestedBy: { id: "schedule", name: "Schedule", email: "schedule" },
      });
      console.log(`scheduled request: ${job.id} ${job.status}`);
    }
    const limitRaw = flag(rest, "--limit");
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 5;
    const results = await runPendingJobs(Number.isFinite(limit) ? limit : 5);
    console.log(JSON.stringify(results, null, 2));
    process.exit(results.every((r) => r.ok || r.message === "overlap" || results.length === 0) ? 0 : 1);
  }

  if (command === "verify") {
    const artifactId = rest.find((a) => !a.startsWith("--"));
    if (!artifactId) usage();
    assertArtifactId(artifactId);
    const keep = has(rest, "--keep");
    const result = await verifyArtifact(artifactId, { keepTarget: keep });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "prune") {
    const result = pruneAfterPublish();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "pin" || command === "unpin") {
    const artifactId = rest.find((a) => !a.startsWith("--"));
    if (!artifactId) usage();
    assertArtifactId(artifactId);
    const catalog = loadCatalog();
    const artifact = catalog.artifacts.find((a) => a.id === artifactId);
    if (!artifact) {
      console.error("Unknown backup artifact.");
      process.exit(1);
    }
    artifact.pinned = command === "pin";
    saveCatalog(catalog);
    console.log(`${command}: ${artifactId}`);
    return;
  }

  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
