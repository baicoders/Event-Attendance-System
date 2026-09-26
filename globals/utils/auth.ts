import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { z } from "zod";

import { prisma } from "@/globals/libs/prisma";

const userRoleEnum = z.enum(["ORGANIZER", "ADMIN"]);
const userStatusEnum = z.enum(["PENDING", "ACTIVE", "REJECTED"]);
const eventStatusEnum = z.enum(["DRAFT", "PENDING", "APPROVED", "REJECTED"]);

type UserRole = z.infer<typeof userRoleEnum>;
type UserStatus = z.infer<typeof userStatusEnum>;
type EventStatus = z.infer<typeof eventStatusEnum>;

export const AUTH_COOKIE = "event-attendance-auth";

const authSessionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  role: userRoleEnum,
  status: userStatusEnum,
  rejectionReason: z.string().nullable().optional(),
  // Optional so sessions signed before this field existed still verify;
  // an absent value reads as "no forced change pending".
  mustChangePassword: z.boolean().optional(),
  // Required: cookies signed before credential versioning existed fail
  // verification here and must sign in again. Never default a missing
  // version to zero — that would revive revoked cookies.
  credentialVersion: z.number().int().nonnegative(),
});

export type AuthSession = z.infer<typeof authSessionSchema>;

export type RequireAuthOptions = {
  /**
   * When true, a valid ACTIVE session with `mustChangePassword` is allowed
   * through. Server-only opt-in for the own-password-change handler — never
   * accept this from HTTP parameters.
   */
  allowForcedPasswordChange?: boolean;
};

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

const DEV_FALLBACK_SECRET = "dev-only-insecure-secret";

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 16) {
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET environment variable (min 16 chars) must be set in production."
    );
  }
  return DEV_FALLBACK_SECRET;
}

function signPayload(payload: string): string {
  return createHmac("sha256", getAuthSecret())
    .update(payload)
    .digest("base64url");
}

// The signed payload wraps the session with an expiry so a captured cookie
// stops verifying after COOKIE_MAX_AGE_SECONDS even if the browser's
// Max-Age is stripped or ignored.
const cookiePayloadSchema = z.object({
  session: authSessionSchema,
  exp: z.number(),
});

// Cookie format: base64url(payloadJson) + "." + HMAC-SHA256 signature.
// The signature prevents clients from forging or tampering with the session.
function serializeSession(session: AuthSession) {
  const exp = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS;
  const payload = Buffer.from(
    JSON.stringify({ session, exp }),
    "utf8"
  ).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}

export class AuthError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 401, code?: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

export async function setAuthSession(session: AuthSession) {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, serializeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearAuthSession() {
  const cookieStore = await cookies();
  cookieStore.delete({ name: AUTH_COOKIE, path: "/" });
}

export async function getAuthSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(AUTH_COOKIE)?.value;

  if (!raw) {
    return null;
  }

  const [payload, signature] = raw.split(".");
  if (!payload || !signature) {
    return null;
  }

  try {
    const expected = Buffer.from(signPayload(payload));
    const provided = Buffer.from(signature);
    if (
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    ) {
      return null;
    }

    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const parsed = cookiePayloadSchema.safeParse(JSON.parse(decoded));
    if (!parsed.success) {
      return null;
    }

    if (parsed.data.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return parsed.data.session;
  } catch {
    return null;
  }
}

/**
 * Cookie session revalidated against the database - the authoritative name,
 * role, status, forced-change flag, and credential version. Returns null when
 * the user no longer exists or the cookie's credential generation no longer
 * matches (password was reset/replaced/recovered since the cookie was signed).
 * A forced-change session is still returned here so the shell, session
 * endpoint, and change-password route can recognize it; use `requireAuth()`
 * (or `assertPasswordChangeCompleted`) to gate business routes.
 */
export async function getFreshAuthSession(): Promise<AuthSession | null> {
  const session = await getAuthSession();
  if (!session) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      rejectionReason: true,
      mustChangePassword: true,
      credentialVersion: true,
    },
  });

  if (!user) {
    return null;
  }

  // Version rejection is separate from usability rejection: a stale cookie
  // becomes "no session" (sign-in prompt), while a current-version
  // forced-change session stays recognizable until the password is replaced.
  if (user.credentialVersion !== session.credentialVersion) {
    return null;
  }

  return user;
}

/**
 * Usable-account decision shared by API routes and server-rendered pages so
 * they cannot diverge. Throws 403 PASSWORD_CHANGE_REQUIRED for a valid
 * forced-change session.
 */
export function assertPasswordChangeCompleted(user: AuthSession) {
  if (user.mustChangePassword) {
    throw new AuthError(
      "Password change required before using the application.",
      403,
      "PASSWORD_CHANGE_REQUIRED",
    );
  }
}

export async function requireAuth(
  options?: RequireAuthOptions,
): Promise<AuthSession> {
  // Revalidate against the database on every protected request so
  // demotions, rejections, deletions, and credential changes take effect
  // immediately instead of at cookie expiry.
  const user = await getFreshAuthSession();
  if (!user) {
    throw new AuthError("Unauthorized", 401, "UNAUTHORIZED");
  }
  assertActiveUser(user);
  if (!options?.allowForcedPasswordChange) {
    assertPasswordChangeCompleted(user);
  }
  return user;
}

export function assertActiveUser(user: AuthSession) {
  if (user.status !== "ACTIVE") {
    throw new AuthError("Account not active", 403, "INACTIVE_USER");
  }
}

export function requireRole(user: AuthSession, allowed: UserRole | UserRole[]) {
  const allowedRoles = Array.isArray(allowed) ? allowed : [allowed];
  if (!allowedRoles.includes(user.role)) {
    throw new AuthError("Forbidden", 403, "FORBIDDEN");
  }
}

export function assertEventOwnership(
  event: { createdById: string | null },
  user: AuthSession
) {
  if (user.role === "ADMIN") {
    return;
  }

  if (!event.createdById || event.createdById !== user.id) {
    throw new AuthError("Forbidden", 403, "FORBIDDEN");
  }
}

export function assertEventVisibility(
  event: { createdById: string | null; status: EventStatus },
  user: AuthSession
) {
  if (user.role === "ADMIN") {
    return;
  }

  const isOwner = !!event.createdById && event.createdById === user.id;
  const isSharedApproved = event.status === "APPROVED";

  if (!isOwner && !isSharedApproved) {
    throw new AuthError("Forbidden", 403, "FORBIDDEN");
  }
}

export function assertEventStatus(
  event: { status: EventStatus },
  allowed: EventStatus | EventStatus[]
) {
  const statuses = Array.isArray(allowed) ? allowed : [allowed];
  if (!statuses.includes(event.status)) {
    throw new AuthError("Invalid event status", 409, "INVALID_STATUS");
  }
}
