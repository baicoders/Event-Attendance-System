import 'server-only';
import { prisma } from '@/globals/libs/prisma';
import { takeSharedRateLimit } from '@/globals/server/requestRateLimit';

export function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  return takeSharedRateLimit(prisma, key, limit, windowMs);
}
/** Forwarded client IPs are trusted only when the deployment explicitly enables them. */
export function clientKey(req: Request): string {
  if (process.env.TRUST_PROXY_HEADERS !== 'true') return 'untrusted-network';
  const value = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return value && value.length <= 64 ? value : 'unknown-client';
}
