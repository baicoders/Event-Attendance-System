export function assertLocalMaintenanceUrl(value) {
  if (!value) throw new Error("Set TEST_DATABASE_URL explicitly; attendance E2E never uses DATABASE_URL as a fallback.");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/postgres" || url.search || url.hash) {
    throw new Error("Attendance E2E requires a local PostgreSQL maintenance database named postgres.");
  }
}

export function buildTestEnv(parent, url, secret) {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      !/^\/test_[a-z0-9_]+$/.test(parsed.pathname) || parsed.search || parsed.hash) {
    throw new Error("Refusing to run against a non-disposable database.");
  }
  return { ...parent, DATABASE_URL: url, DIRECT_URL: url, DATABASE_SSL_CA_BASE64: "", AUTH_SECRET: secret, NODE_ENV: "production" };
}
