import assert from "node:assert/strict";
import test from "node:test";
import { assertLocalMaintenanceUrl, buildTestEnv } from "./safety.mjs";

test("fixtures require an explicit local PostgreSQL maintenance URL", () => {
  for (const url of [undefined, "file:test.db", "postgresql://u:p@remote.example/postgres", "postgresql://u:p@localhost/event_attendance_dev", "postgresql://u:p@localhost/event_attendance_prod", "postgresql://u:p@localhost/other_live_data", "postgresql://u:p@localhost/postgres?host=remote.example", "postgresql://u:p@localhost/postgres?dbname=real_data"]) {
    assert.throws(() => assertLocalMaintenanceUrl(url));
  }
  assert.doesNotThrow(() => assertLocalMaintenanceUrl("postgresql://u:p@127.0.0.1:5433/postgres"));
});

test("test processes cannot inherit a real runtime database or a remote CA", () => {
  const fixture = "postgresql://u:p@127.0.0.1:5433/test_e2e_123";
  const env = buildTestEnv({ DATABASE_URL: "remote", DIRECT_URL: "remote", DATABASE_SSL_CA_BASE64: "remote-ca", AUTH_SECRET: "live", PATH: "/bin" }, fixture, "test-secret");
  assert.equal(env.DATABASE_URL, fixture);
  assert.equal(env.DIRECT_URL, fixture);
  assert.equal(env.AUTH_SECRET, "test-secret");
  assert.equal(env.DATABASE_SSL_CA_BASE64, "");
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.PATH, "/bin");
  assert.throws(() => buildTestEnv({}, "postgresql://u:p@localhost/live", "secret"));
  assert.throws(() => buildTestEnv({}, "postgresql://u:p@localhost/test_e2e_123?host=remote.example", "secret"));
});
