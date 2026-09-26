import "server-only";

const DEV_FALLBACK_SECRET = "dev-only-insecure-secret";

/**
 * Shared server-only accessor for the HMAC secret used by signed tokens
 * (auth cookies, bulk preview tokens, ...).
 *
 * Reads the same configured `AUTH_SECRET` the session cookie uses, with the
 * same dev fallback and production fail-fast behavior. Callers must apply
 * their own domain separation (distinct purpose string) so a token for one
 * purpose can never verify as another.
 */
export function getServerSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 16) {
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET environment variable (min 16 chars) must be set in production.",
    );
  }
  return DEV_FALLBACK_SECRET;
}
