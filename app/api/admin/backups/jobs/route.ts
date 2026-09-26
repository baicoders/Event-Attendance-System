import { NextResponse } from "next/server";

import { ok } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import { requireAuth, requireRole } from "@/globals/utils/auth";
import { listRecentJobs } from "@/globals/server/backups/catalog";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * GET /api/admin/backups/jobs?limit=
 *
 * Recent backup jobs for the operator console. Fresh ADMIN on every read.
 * Job records carry only safe summaries — never credentials, SQL, raw
 * stderr, or absolute infrastructure paths.
 */
export async function GET(req: Request) {
  try {
    const user = await requireAuth();
    requireRole(user, "ADMIN");
    const { searchParams } = new URL(req.url);
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 20;
    const jobs = listRecentJobs(Number.isFinite(limit) ? limit : 20);
    return NextResponse.json(ok({ jobs }), { status: 200, headers: NO_STORE });
  } catch (error) {
    return respondWithError(error);
  }
}
