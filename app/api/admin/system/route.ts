import { NextResponse } from "next/server";

import { prisma } from "@/globals/libs/prisma";
import { ok } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import { requireAuth, requireRole } from "@/globals/utils/auth";

import { version as appVersion } from "@/package.json";

const MIN_AUTH_SECRET_LENGTH = 16;

/**
 * PostgreSQL identity for the operator console, without leaking topology or
 * secrets. Returns the connected database name + server version only — never
 * connection strings, passwords, hostnames or CA material.
 */
async function databaseIdentity(): Promise<{ database: string; serverVersion: string }> {
  const rows = await prisma.$queryRaw<Array<{ database: string; server_version: string }>>`
    SELECT current_database() AS database, version() AS server_version
  `;
  const row = rows[0];
  return {
    database: row?.database ?? "unknown",
    // First line only ("PostgreSQL 17.11 on ...") — no build paths.
    serverVersion: (row?.server_version ?? "unknown").split("\n")[0],
  };
}

/**
 * GET /api/admin/system
 *
 * Read-only environment health for the operator console. It reports whether
 * configuration is *present and valid*, never the values themselves - no secret
 * is returned by this route under any condition.
 */
export async function GET() {
  try {
    const user = await requireAuth();
    requireRole(user, "ADMIN");

    const secret = process.env.AUTH_SECRET ?? "";

    const [students, groups, events, records, users, db] = await Promise.all([
      prisma.student.count(),
      prisma.group.count(),
      prisma.event.count(),
      prisma.record.count(),
      prisma.user.count(),
      databaseIdentity(),
    ]);

    return NextResponse.json(
      ok({
        nodeEnv: process.env.NODE_ENV ?? "unknown",
        database: db,
        authSecret: {
          configured: secret.length > 0,
          meetsMinLength: secret.length >= MIN_AUTH_SECRET_LENGTH,
          // In development an unset secret silently falls back to a shared
          // constant; that is fine locally and fatal in production.
          usingDevFallback:
            secret.length < MIN_AUTH_SECRET_LENGTH &&
            process.env.NODE_ENV !== "production",
        },
        appVersion,
        // Lets an operator confirm the host clock before an event without
        // leaving the app - a wrong clock silently produces wrong timestamps.
        serverTime: new Date().toISOString(),
        counts: { students, groups, events, records, users },
      }),
      { status: 200 },
    );
  } catch (error) {
    return respondWithError(error);
  }
}
