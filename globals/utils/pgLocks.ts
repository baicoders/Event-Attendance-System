import { createHash } from "node:crypto";

/**
 * Transaction-scoped PostgreSQL advisory locks for the guarded-write protocol
 * (issue #51 §4).
 *
 * - Namespaced 64-bit keys, consistently encoded by this helper. A collision
 *   causes extra contention only — full IDs + SQL constraints stay authoritative.
 * - Always `pg_advisory_xact_lock` (transaction-scoped), never session-scoped,
 *   so pooled connections cannot retain a lock after commit/rollback.
 *
 * Namespaces:
 * - `roster:shared` / `roster:exclusive` — freezes eligibility across a write.
 *   Attendance/event writes take the shared form; roster edits, imports, group
 *   membership replacement/deletion and lifecycle writes take the exclusive form.
 * - `record:<eventId>:<studentId>` — exclusive per attendance pair, including
 *   when no Record exists yet.
 * - `command:<id>` — durable replay identity for future correction/receipt
 *   commands (#48/#86/#87); reserved here, not yet issued.
 */

function key64(namespace: string, ...parts: string[]): bigint {
  const digest = createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(parts.join("\0"))
    .digest();
  // 63-bit positive bigint (top bit cleared) — safe for pg bigint arg.
  // No bigint literals (target is ES2017): build via BigInt() arithmetic.
  const eight = BigInt(8);
  const twoFiftySix = BigInt(256);
  const mask = BigInt("9223372036854775807");
  let key = BigInt(0);
  for (let i = 0; i < eight; i++) {
    key = key * twoFiftySix + BigInt(digest[Number(i)]);
  }
  return key & mask;
}

export const ROSTER_SHARED_KEY = key64("eas", "roster", "shared");
export const ROSTER_EXCLUSIVE_KEY = key64("eas", "roster", "exclusive");

export function recordPairKey(eventId: string, studentId: string): bigint {
  return key64("eas", "record", eventId, studentId);
}

export function commandKey(commandId: string): bigint {
  return key64("eas", "command", commandId);
}

export type AdvisoryTx = {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
};

/** `SELECT pg_advisory_xact_lock($1)` — shared roster-state freeze. */
export async function takeRosterSharedLock(tx: AdvisoryTx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROSTER_SHARED_KEY})`;
}

/** Exclusive roster lock for imports/group replacement/deletion/lifecycle. */
export async function takeRosterExclusiveLock(tx: AdvisoryTx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROSTER_EXCLUSIVE_KEY})`;
}

/** Exclusive per-pair lock, deterministic order enforced by callers. */
export async function takeRecordPairLock(
  tx: AdvisoryTx,
  eventId: string,
  studentId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${recordPairKey(eventId, studentId)})`;
}

/** Transaction-scoped advisory lock for a durable command identity. */
export async function takeCommandLock(tx: AdvisoryTx, commandId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${commandKey(commandId)})`;
}

/**
 * Lock an Event row and re-read the authoritative copy.
 * Recording uses `FOR SHARE` (concurrent different-student scans proceed);
 * mode/content/lifecycle mutations and deletion use `FOR UPDATE`.
 */
export async function lockEventRow(
  tx: {
    $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    event: { findUnique(args: unknown): Promise<unknown> };
  },
  eventId: string,
  mode: "SHARE" | "UPDATE",
): Promise<void> {
  if (mode === "SHARE") {
    await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR SHARE`;
  } else {
    await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
  }
}
