import { randomInt } from "crypto";

// No framework imports here on purpose: the local recovery CLI imports this
// module, so `next/headers` and `server-only` must stay out of the graph.
// The HTTP routes own cookie emission; this module owns conditional DB writes.

// No 0/O/1/l/I - the password gets read aloud or copied off a screen during
// an event, and an ambiguous character there costs more than the lost entropy.
export const TEMP_PASSWORD_ALPHABET =
  "abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789";
export const TEMP_PASSWORD_LENGTH = 12;

export function generateTemporaryPassword(): string {
  let password = "";
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    password += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return password;
}

/**
 * Minimal structural type for the Prisma delegate surface this module needs.
 * Accepts both the global PrismaClient and an interactive-transaction client,
 * without importing server-only helpers. Args are intentionally `any`: Prisma's
 * generated delegate types are invariant-heavy and a precise structural mirror
 * would reject the real client — the compare-and-set shape (where + data) is
 * what matters here.
 */
export type CredentialDb = {
  user: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateMany(args: any): Promise<{ count: number }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findUnique(args: any): Promise<any>;
  };
};

export const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  rejectionReason: true,
  mustChangePassword: true,
  credentialVersion: true,
} as const;

/**
 * Own password replacement guarded against stale verification. The caller
 * verifies `currentPassword` against `verifiedPasswordHash` and computes
 * `newPasswordHash` BEFORE calling, so hashing never holds a write lock.
 * Returns the updated public user, or null when another credential change
 * won the race (version/hash/status moved under us).
 */
export async function applyOwnPasswordChange(
  db: CredentialDb,
  args: {
    userId: string;
    expectedCredentialVersion: number;
    verifiedPasswordHash: string;
    newPasswordHash: string;
  },
): Promise<Record<string, unknown> | null> {
  const result = await db.user.updateMany({
    where: {
      id: args.userId,
      credentialVersion: args.expectedCredentialVersion,
      password: args.verifiedPasswordHash,
      status: "ACTIVE",
    },
    data: {
      password: args.newPasswordHash,
      mustChangePassword: false,
      credentialVersion: { increment: 1 },
    },
  });

  if (result.count === 0) {
    return null;
  }

  return db.user.findUnique({
    where: { id: args.userId },
    select: { ...PUBLIC_USER_SELECT },
  });
}

/**
 * Admin-issued reset guarded against stale review. Preserves role/status by
 * construction (only password/flag/version are written). Returns the updated
 * target row, or null when the reviewed version no longer matches.
 */
export async function applyAdminPasswordReset(
  db: CredentialDb,
  args: {
    targetId: string;
    expectedCredentialVersion: number;
    tempPasswordHash: string;
  },
): Promise<Record<string, unknown> | null> {
  const result = await db.user.updateMany({
    where: {
      id: args.targetId,
      credentialVersion: args.expectedCredentialVersion,
    },
    data: {
      password: args.tempPasswordHash,
      mustChangePassword: true,
      credentialVersion: { increment: 1 },
    },
  });

  if (result.count === 0) {
    return null;
  }

  return db.user.findUnique({
    where: { id: args.targetId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      credentialVersion: true,
    },
  });
}

/**
 * Legacy plaintext-to-scrypt upgrade that cannot overwrite a newer credential.
 * Only replaces the exact stored value that was verified; a concurrent reset
 * changes the stored value first, so this becomes a no-op (count 0).
 */
export async function applyLegacyPasswordUpgrade(
  db: CredentialDb,
  args: {
    userId: string;
    verifiedStoredValue: string;
    newPasswordHash: string;
  },
): Promise<boolean> {
  const result = await db.user.updateMany({
    where: {
      id: args.userId,
      password: args.verifiedStoredValue,
    },
    data: { password: args.newPasswordHash },
  });

  return result.count > 0;
}
