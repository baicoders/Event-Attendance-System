import 'server-only';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
let nextPruneAt = 0;

export async function pruneExpiredRequestLimits(db: PrismaClient): Promise<number> {
  return db.$executeRaw`DELETE FROM "RequestRateLimit" WHERE key IN (SELECT key FROM "RequestRateLimit" WHERE "resetAt" < statement_timestamp() - interval '1 day' ORDER BY "resetAt" LIMIT 1000 FOR UPDATE SKIP LOCKED)`;
}

/** Atomic across app instances; keys are hashed so emails/IPs are not stored as labels. */
export async function takeSharedRateLimit(db: PrismaClient, key: string, limit: number, windowMs: number) {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1) throw new Error('Invalid rate limit configuration');
  if (Date.now() >= nextPruneAt) {
    nextPruneAt = Date.now() + 60000;
    // Expiry cleanup is bounded; failure must not weaken the actual admission check.
    await pruneExpiredRequestLimits(db);
  }
  const bucketKey = createHash('sha256').update(key).digest('hex');
  const rows = await db.$queryRaw<Array<{ allowed: boolean }>>`
    INSERT INTO "RequestRateLimit" (key, hits, "resetAt")
    VALUES (${bucketKey}, 1, statement_timestamp() + ${windowMs} * interval '1 millisecond')
    ON CONFLICT (key) DO UPDATE SET
      hits = CASE WHEN "RequestRateLimit"."resetAt" <= statement_timestamp() THEN 1 ELSE LEAST("RequestRateLimit".hits + 1, ${limit + 1}) END,
      "resetAt" = CASE WHEN "RequestRateLimit"."resetAt" <= statement_timestamp() THEN statement_timestamp() + ${windowMs} * interval '1 millisecond' ELSE "RequestRateLimit"."resetAt" END
    RETURNING hits <= ${limit} AS allowed`;
  return rows[0].allowed;
}
