import { NextResponse } from "next/server";

import { err, ok } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import { requireAuth, requireRole } from "@/globals/utils/auth";
import { findArtifact, findJob } from "@/globals/server/backups/catalog";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;
const JOB_ID_PATTERN = /^bk_[a-z0-9]{16}$/;

/**
 * GET /api/admin/backups/jobs/[jobId]
 *
 * One durable job plus its artifact (when published). Authorization is
 * rechecked on every read. Detail expansion never exposes credentials, SQL,
 * raw stderr, or absolute infrastructure paths — the catalog stores only
 * safe summaries.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const user = await requireAuth();
    requireRole(user, "ADMIN");
    const { jobId } = await params;
    if (!JOB_ID_PATTERN.test(jobId)) {
      return NextResponse.json(err("Unknown backup job.", "NOT_FOUND"), {
        status: 404,
        headers: NO_STORE,
      });
    }
    const job = findJob(jobId);
    if (!job) {
      return NextResponse.json(err("Unknown backup job.", "NOT_FOUND"), {
        status: 404,
        headers: NO_STORE,
      });
    }
    const artifact = job.artifactId ? findArtifact(job.artifactId) : null;
    return NextResponse.json(ok({ job, artifact }), { status: 200, headers: NO_STORE });
  } catch (error) {
    return respondWithError(error);
  }
}
