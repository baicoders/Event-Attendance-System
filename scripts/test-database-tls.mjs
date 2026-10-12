// Runs against a newly created PostgreSQL container only. Never reads a school
// database URL or runs the destructive seed. Requires Docker and OpenSSL.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const image = "postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24";
const require = createRequire(import.meta.url);
const { getPgPoolConfig } = require("../globals/libs/dbConfig.ts");
const prismaCli = join(dirname(require.resolve("prisma/package.json")), "build/index.js");
const run = (command, args) => execFileSync(command, args, {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
});
const pause = () => new Promise(resolve => setTimeout(resolve, 200));

test("runtime and Prisma Migrate enforce TLS with the installed drivers", { timeout: 180_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "eas-tls-test-"));
  const container = "eas-tls-test-" + randomUUID();
  const originalCa = process.env.DATABASE_SSL_CA_BASE64;
  t.after(() => {
    spawnSync("docker", ["rm", "-f", container], { stdio: "ignore", timeout: 15_000 });
    rmSync(directory, { recursive: true, force: true });
    if (originalCa === undefined) delete process.env.DATABASE_SSL_CA_BASE64;
    else process.env.DATABASE_SSL_CA_BASE64 = originalCa;
  });

  const path = name => join(directory, name);
  const openssl = args => run("openssl", args);
  for (const name of ["ca", "untrusted-ca"]) {
    openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=" + name, "-addext", "basicConstraints=critical,CA:TRUE",
      "-keyout", path(name + ".key"), "-out", path(name + ".crt")]);
  }
  function sign(name, subject, extensions) {
    openssl(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=" + subject,
      "-keyout", path(name + ".key"), "-out", path(name + ".csr")]);
    writeFileSync(path(name + ".ext"), extensions);
    openssl(["x509", "-req", "-days", "1", "-in", path(name + ".csr"),
      "-CA", path("ca.crt"), "-CAkey", path("ca.key"), "-CAcreateserial",
      "-extfile", path(name + ".ext"), "-out", path(name + ".crt")]);
  }
  sign("server", "tls-test", "subjectAltName=IP:127.0.0.2\nextendedKeyUsage=serverAuth\n");
  sign("client", "tls_client", "extendedKeyUsage=clientAuth\n");
  // Same server key, trusted issuer, wrong hostname: isolates hostname checks.
  writeFileSync(path("mismatch.ext"), "subjectAltName=DNS:wrong.example\nextendedKeyUsage=serverAuth\n");
  openssl(["x509", "-req", "-days", "1", "-in", path("server.csr"),
    "-CA", path("ca.crt"), "-CAkey", path("ca.key"), "-CAcreateserial",
    "-extfile", path("mismatch.ext"), "-out", path("mismatch.crt")]);
  openssl(["pkcs12", "-export", "-in", path("client.crt"), "-inkey", path("client.key"),
    "-out", path("client.p12"), "-passout", "pass:tls-test"]);
  writeFileSync(path("pg_hba.conf"), [
    "local all all trust",
    "hostssl all tls_client 0.0.0.0/0 cert",
    "host all all 0.0.0.0/0 scram-sha-256",
  ].join("\n") + "\n");
  writeFileSync(path("postgresql.conf"), [
    "listen_addresses='*'", "ssl=on",
    "ssl_cert_file='/tmp/db-tls/server.crt'", "ssl_key_file='/tmp/db-tls/server.key'",
    "ssl_ca_file='/tmp/db-tls/ca.crt'", "hba_file='/tmp/db-tls/pg_hba.conf'",
  ].join("\n") + "\n");

  run("docker", ["run", "--detach", "--rm", "--name", container,
    "--publish", "127.0.0.2::5432", "--volume", directory + ":/fixture:ro",
    "--env", "POSTGRES_PASSWORD=tls-test-only", "--env", "POSTGRES_DB=tls_test",
    image, "sh", "-c",
    "mkdir -p /tmp/db-tls && cp /fixture/server.crt /fixture/server.key /fixture/ca.crt /fixture/pg_hba.conf /fixture/postgresql.conf /tmp/db-tls/ && chown -R postgres:postgres /tmp/db-tls && chmod 600 /tmp/db-tls/server.key && exec docker-entrypoint.sh postgres -c config_file=/tmp/db-tls/postgresql.conf"]);
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    const probe = spawnSync("docker", ["exec", container, "pg_isready", "-h", "127.0.0.1"], { stdio: "ignore" });
    if (probe.status === 0) { ready = true; break; }
    await pause();
  }
  assert.ok(ready, "Disposable TLS PostgreSQL did not start");
  const port = run("docker", ["port", container, "5432/tcp"]).trim().split(":").pop();
  const url = "postgresql://postgres:tls-test-only@127.0.0.2:" + port + "/tls_test";
  const sql = statement => run("docker", ["exec", container, "psql", "-U", "postgres", "-d", "tls_test", "-tAc", statement]).trim();
  sql("CREATE ROLE tls_client LOGIN SUPERUSER");

  const ca = readFileSync(path("ca.crt")).toString("base64");
  const wrongCa = readFileSync(path("untrusted-ca.crt")).toString("base64");
  // Exercise the same wrapped base64 accepted in deployment secrets.
  const wrappedCa = ca.match(/.{1,64}/g).join("\r\n");
  process.env.DATABASE_SSL_CA_BASE64 = wrappedCa;
  t.beforeEach(() => { process.env.DATABASE_SSL_CA_BASE64 = wrappedCa; });

  async function query(target, statement = "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()") {
    const pool = new Pool({ ...getPgPoolConfig(target), connectionTimeoutMillis: 3_000 });
    try { return await pool.query(statement); }
    finally { await pool.end(); }
  }
  function migrate(target = url, certificate = wrappedCa) {
    return spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: target, DIRECT_URL: target,
        TEST_DATABASE_URL: target, DATABASE_SSL_CA_BASE64: certificate },
      encoding: "utf8", timeout: 45_000,
    });
  }
  function assertMigration(result, succeeds) {
    const output = (result.stdout || "") + (result.stderr || "");
    if (succeeds) assert.equal(result.status, 0, output);
    else {
      assert.notEqual(result.status, 0, "Migration unexpectedly accepted an invalid TLS connection");
      assert.match(output, /P1011/, output);
    }
  }

  await t.test("runtime connects with each SSL-enabling URL form", async () => {
    for (const options of ["", "?ssl=true", "?ssl=1", "?sslmode=require",
      "?sslmode=verify-full", "?sslnegotiation=direct", "?ssl=1&sslnegotiation=direct"]) {
      assert.equal((await query(url + options)).rows[0].ssl, true, options);
    }
  });
  await t.test("runtime preserves client credentials for mutual TLS", async () => {
    const clientUrl = url.replace("postgres:tls-test-only@", "tls_client@");
    const options = new URLSearchParams({ ssl: "true", sslnegotiation: "direct",
      sslcert: path("client.crt"), sslkey: path("client.key") });
    const result = await query(clientUrl + "?" + options, "SELECT current_user AS name");
    assert.equal(result.rows[0].name, "tls_client");
    await assert.rejects(query(clientUrl), /certificate/i);
  });
  await t.test("runtime rejects an untrusted CA", async () => {
    process.env.DATABASE_SSL_CA_BASE64 = wrongCa;
    await assert.rejects(query(url + "?ssl=1"), /certificate/i);
    process.env.DATABASE_SSL_CA_BASE64 = wrappedCa;
  });
  await t.test("runtime trusts a URL CA when no environment CA is configured", async () => {
    delete process.env.DATABASE_SSL_CA_BASE64;
    const params = new URLSearchParams({ sslrootcert: path("ca.crt"), sslmode: "require" });
    assert.equal((await query(url + "?" + params)).rows[0].ssl, true);
    await assert.rejects(query(url + "?sslmode=require&uselibpqcompat=true"), /certificate/i);
    process.env.DATABASE_SSL_CA_BASE64 = wrappedCa;
  });
  await t.test("Prisma Migrate deploys the actual migrations with the trusted CA", () => {
    assertMigration(migrate(), true);
    assert.equal(sql('SELECT count(*) > 0 FROM "_prisma_migrations" WHERE finished_at IS NOT NULL'), "t");
  });
  await t.test("the Prisma runtime adapter can perform the login identity query", async () => {
    const pool = new Pool(getPgPoolConfig(url + "?ssl=true"));
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
      assert.equal(await prisma.user.findUnique({ where: { email: "tls-test@example.invalid" } }), null);
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  });
  await t.test("pg and Prisma Migrate preserve their client identities on the same direct URL", async () => {
    const params = new URLSearchParams({
      sslcert: path("client.crt"), sslkey: path("client.key"),
      sslidentity: path("client.p12"), sslpassword: "tls-test",
    });
    const target = url.replace("postgres:tls-test-only@", "tls_client@") + "?" + params;
    assert.equal((await query(target, "SELECT current_user AS name")).rows[0].name, "tls_client");
    assertMigration(migrate(target), true);
  });
  await t.test("Prisma Migrate rejects an untrusted or missing CA", () => {
    assertMigration(migrate(url, wrongCa), false);
    assertMigration(migrate(url, ""), false);
  });

  async function reload(statement) {
    const previous = sql("SELECT pg_conf_load_time()");
    sql(statement);
    sql("SELECT pg_reload_conf()");
    for (let attempt = 0; attempt < 50; attempt++) {
      if (sql("SELECT pg_conf_load_time()") !== previous) return;
      await pause();
    }
    assert.fail("Disposable PostgreSQL did not reload TLS configuration");
  }
  await t.test("runtime and Prisma Migrate reject a trusted certificate for the wrong host", async () => {
    run("docker", ["exec", container, "cp", "/fixture/mismatch.crt", "/tmp/db-tls/server.crt"]);
    await reload("SELECT 1");
    await assert.rejects(query(url), /hostname|IP|altnames/i);
    assertMigration(migrate(), false);
  });
  await t.test("runtime and Prisma Migrate refuse plaintext fallback", async () => {
    await reload("ALTER SYSTEM SET ssl = off");
    assert.equal(sql("SHOW ssl"), "off");
    await assert.rejects(query(url), /does not support SSL/i);
    assertMigration(migrate(), false);
  });
});
