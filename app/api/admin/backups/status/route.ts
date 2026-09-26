import { NextResponse } from "next/server";

import { ok } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import { requireAuth, requireRole } from "@/globals/utils/auth";
import { getBackupStatus } from "@/globals/server/backups/status";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * GET /api/admin/backups/status
 *
 * Canonical backup evidence for the operator console (and #85 health).
 * Fresh active ADMIN only. Private/no-store. Never exposes connection
 * strings, passwords, hosts, SQL, or absolute infrastructure paths.
 */
export async function GET() {
  try {
    const user = await requireAuth();
    requireRole(user, "ADMIN");
    const status = getBackupStatus();
    return NextResponse.json(ok(status), { status: 200, headers: NO_STORE });
  } catch (error) {
    return respondWithError(error);
  }
}
