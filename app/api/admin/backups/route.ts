import { NextResponse } from "next/server";
import { z } from "zod";

import { err, ok } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import { AuthError, requireAuth, requireRole } from "@/globals/utils/auth";
import { rateLimit } from "@/globals/utils/rateLimit";
import { getBackupConfig } from "@/globals/server/backups/config";
import { enqueueJob } from "@/globals/server/backups/catalog";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

const requestSchema = z.object({}).strict();

/**
 * Verified origin for mutations: a present Origin (or Referer fallback) must
 * match the request host. Absent headers (non-browser callers) are allowed;
 * a mismatch is a 403 CSRF refusal, never a silent accept.
 */
function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const check = origin ?? referer;
  if (!check || !host) return;
  try {
    const checkHost = new URL(check).host;
    if (checkHost !== host) {
      throw new AuthError("Origin verification failed.", 403, "FORBIDDEN");
    }
  } catch (error) {
    if (error instanceof AuthError) throw error;
    // Unparseable Origin/Referer is treated as a mismatch, not ignored.
    throw new AuthError("Origin verification failed.", 403, "FORBIDDEN");
  }
}

/**
 * POST /api/admin/backups
 *
 * Durably records a manual backup request. Returns an acknowledgement only
 * after the request is durably stored; the UI polls the durable job. A
 * request timeout never implies the dump failed. The runner (CLI), not a
 * detached Next.js promise, owns execution.
 *
 * Overlap is skipped, not queued: when a job is already REQUESTED/RUNNING
 * the existing job is returned with `deduped: true`.
 */
export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    requireRole(user, "ADMIN");
    assertSameOrigin(req);

    if (!rateLimit(`backups:${user.id}`, 10, 5 * 60_000)) {
      return NextResponse.json(err("Too many backup requests. Wait and retry.", "RATE_LIMITED"), {
        status: 429,
        headers: NO_STORE,
      });
    }

    requestSchema.parse(await req.json().catch(() => ({})));

    const config = getBackupConfig();
    if (!config.configured) {
      return NextResponse.json(
        err(config.configuredReason ?? "Backup runner is not configured.", "BACKUP_UNCONFIGURED"),
        { status: 409, headers: NO_STORE },
      );
    }

    const job = enqueueJob({
      kind: "manual",
      requestedBy: { id: user.id, name: user.name, email: user.email },
    });
    // enqueueJob returns the pending job when overlap exists — surface that
    // so the UI can explain "already running" instead of silently queuing.
    // A job created by this request is <2s old and owned by this principal.
    const createdNow =
      Date.now() - Date.parse(job.requestedAt) < 2000 && job.requestedBy.id === user.id;
    return NextResponse.json(ok({ job, deduped: !createdNow }), {
      status: createdNow ? 201 : 200,
      headers: NO_STORE,
    });
  } catch (error) {
    return respondWithError(error);
  }
}
