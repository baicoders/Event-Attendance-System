import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { getServerSecret } from "./serverSecret";
import { reviewFingerprint } from "./studentContentVersion";
import type { BulkAction } from "../schemas/studentBulk";
import type { BulkPreviewTarget } from "../types/studentBulk";

export { buildBulkPreviewRows } from "./studentBulkPreview";
export type { PreviewStudentInput, PreviewTargetInput } from "./studentBulkPreview";

export const BULK_TOKEN_PURPOSE = "student-bulk-commit-v1";
export const BULK_TOKEN_VERSION = 1;
export const BULK_TOKEN_TTL_MS = 10 * 60 * 1000;

export type BulkTokenPayload = {
  v: number;
  purpose: string;
  userId: string;
  studentIds: string[];
  action: BulkAction;
  targetId: string;
  targetSlug: string;
  targetName: string;
  targetCategory: "SECTION" | "HOUSE";
  contentVersions: Record<string, string>;
  reviewFingerprint: string;
  preparedAt: number;
  expiresAt: number;
};

export class BulkTokenError extends Error {
  code: string;
  status: number;
  issues?: unknown;
  constructor(message: string, code: string, status = 409, issues?: unknown) {
    super(message);
    this.name = "BulkTokenError";
    this.code = code;
    this.status = status;
    this.issues = issues;
  }
}

function b64urlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function b64urlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signPayload(payloadB64: string): string {
  return createHmac("sha256", getServerSecret())
    .update(`${BULK_TOKEN_PURPOSE}.${payloadB64}`)
    .digest("base64url");
}

/** Sign a purpose-versioned preview token binding user, IDs, target and versions. */
export function signBulkPreviewToken(payload: BulkTokenPayload): string {
  const body = b64urlEncode(JSON.stringify(payload));
  return `${body}.${signPayload(body)}`;
}

/** Verify signature, purpose, expiry and user binding. Throws BulkTokenError. */
export function verifyBulkPreviewToken(
  token: string,
  expectedUserId: string,
): BulkTokenPayload {
  const [body, signature] = token.split(".");
  if (!body || !signature) {
    throw new BulkTokenError("Invalid preview token.", "STALE_PREVIEW", 409);
  }
  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = Buffer.from(signPayload(body));
    provided = Buffer.from(signature);
  } catch {
    throw new BulkTokenError("Invalid preview token.", "STALE_PREVIEW", 409);
  }
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    throw new BulkTokenError("Invalid preview token.", "STALE_PREVIEW", 409);
  }
  let parsed: BulkTokenPayload;
  try {
    parsed = JSON.parse(b64urlDecode(body)) as BulkTokenPayload;
  } catch {
    throw new BulkTokenError("Invalid preview token.", "STALE_PREVIEW", 409);
  }
  if (parsed.v !== BULK_TOKEN_VERSION || parsed.purpose !== BULK_TOKEN_PURPOSE) {
    throw new BulkTokenError("Invalid preview token.", "STALE_PREVIEW", 409);
  }
  if (parsed.userId !== expectedUserId) {
    throw new BulkTokenError(
      "This preview belongs to a different account.",
      "STALE_PREVIEW",
      409,
    );
  }
  if (!Number.isFinite(parsed.expiresAt) || Date.now() > parsed.expiresAt) {
    throw new BulkTokenError("This preview has expired.", "PREVIEW_EXPIRED", 409);
  }
  return parsed;
}

/** Build the signed token payload for a clean preview (no blocked rows). */
export function buildBulkTokenPayload(input: {
  userId: string;
  orderedIds: string[];
  action: BulkAction;
  target: BulkPreviewTarget;
  contentVersions: Record<string, string>;
  beforeLabels: Array<{ id: string; slug: string | null; name: string | null }>;
  preparedAt?: number;
}): BulkTokenPayload {
  const preparedAt = input.preparedAt ?? Date.now();
  return {
    v: BULK_TOKEN_VERSION,
    purpose: BULK_TOKEN_PURPOSE,
    userId: input.userId,
    studentIds: [...input.orderedIds],
    action: input.action,
    targetId: input.target.id,
    targetSlug: input.target.slug,
    targetName: input.target.name,
    targetCategory: input.target.category,
    contentVersions: { ...input.contentVersions },
    reviewFingerprint: reviewFingerprint({
      targetId: input.target.id,
      targetSlug: input.target.slug,
      targetName: input.target.name,
      targetCategory: input.target.category,
      beforeLabels: input.beforeLabels,
    }),
    preparedAt,
    expiresAt: preparedAt + BULK_TOKEN_TTL_MS,
  };
}
