import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "pg";
import {
  getMigrationDatabaseUrl,
  getDirectDatabaseUrl,
  getPgPoolConfig,
} from "./dbConfig";

test("remote database TLS trusts the configured CA and still verifies certificates", () => {
  const original = process.env.DATABASE_SSL_CA_BASE64;
  const ca = "-----BEGIN CERTIFICATE-----\nexample-root\n-----END CERTIFICATE-----\n";
  process.env.DATABASE_SSL_CA_BASE64 = Buffer.from(ca).toString("base64").match(/.{1,40}/g)!.join("\r\n");

  try {
    const ssl = getPgPoolConfig("postgresql://db.example.com/postgres").ssl as { ca?: string; rejectUnauthorized?: boolean };
    assert.equal(ssl.ca, ca);
    assert.equal(ssl.rejectUnauthorized, true);
  } finally {
    if (original === undefined) delete process.env.DATABASE_SSL_CA_BASE64;
    else process.env.DATABASE_SSL_CA_BASE64 = original;
  }
});

test("runtime pool keeps the configured CA when the URL includes SSL parameters", () => {
  const original = process.env.DATABASE_SSL_CA_BASE64;
  const ca = "-----BEGIN CERTIFICATE-----\nexample-root\n-----END CERTIFICATE-----\n";
  const directory = mkdtempSync(join(tmpdir(), "db-pool-ssl-test-"));
  const cert = "-----BEGIN CERTIFICATE-----\nclient-cert\n-----END CERTIFICATE-----\n";
  const key = "-----BEGIN PRIVATE KEY-----\nclient-key\n-----END PRIVATE KEY-----\n";
  const certPath = join(directory, "client.crt");
  const keyPath = join(directory, "client.key");
  writeFileSync(certPath, cert);
  writeFileSync(keyPath, key);
  const params = new URLSearchParams({
    sslmode: "require",
    sslrootcert: "/provider/root.pem",
    sslcert: certPath,
    sslkey: keyPath,
    application_name: "library",
  });
  const url = `postgresql://user:password@db.example.com/postgres?${params}`;
  process.env.DATABASE_SSL_CA_BASE64 = Buffer.from(ca).toString("base64");

  try {
    const config = getPgPoolConfig(url);
    const poolUrl = new URL(config.connectionString!);
    assert.equal(poolUrl.searchParams.has("sslmode"), false);
    assert.equal(poolUrl.searchParams.has("sslrootcert"), false);
    assert.equal(poolUrl.searchParams.has("sslcert"), false);
    assert.equal(poolUrl.searchParams.has("sslkey"), false);
    assert.equal(poolUrl.searchParams.get("application_name"), "library");

    const client = new Client(config);
    const ssl = (client as unknown as { connectionParameters: { ssl: unknown } })
      .connectionParameters.ssl;
    const options = ssl as { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean };
    assert.equal(options.ca, ca);
    assert.equal(options.cert, cert);
    assert.equal(options.key, key);
    assert.equal(options.rejectUnauthorized, true);
  } finally {
    if (original === undefined) delete process.env.DATABASE_SSL_CA_BASE64;
    else process.env.DATABASE_SSL_CA_BASE64 = original;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("every pg URL SSL-enabling form preserves the configured CA", async (t) => {
  const original = process.env.DATABASE_SSL_CA_BASE64;
  const ca = "-----BEGIN CERTIFICATE-----\nexample-root\n-----END CERTIFICATE-----\n";
  process.env.DATABASE_SSL_CA_BASE64 = Buffer.from(ca).toString("base64");
  t.after(() => {
    if (original === undefined) delete process.env.DATABASE_SSL_CA_BASE64;
    else process.env.DATABASE_SSL_CA_BASE64 = original;
  });
  for (const query of [
    "ssl=true", "ssl=1", "sslmode=verify-full", "sslmode=require",
    "sslnegotiation=direct", "ssl=true&sslnegotiation=direct",
  ]) {
    await t.test(query, () => {
      const url = `postgresql://user:password@db.example.com/postgres?${query}`;
      const client = new Client(getPgPoolConfig(url));
      const parameters = (client as unknown as {
        connectionParameters: { ssl: { ca?: string; rejectUnauthorized?: boolean }; sslnegotiation?: string };
      }).connectionParameters;
      assert.equal(parameters.ssl.ca, ca);
      assert.equal(parameters.ssl.rejectUnauthorized, true);
      if (query.includes("sslnegotiation=direct")) {
        assert.equal(parameters.sslnegotiation, "direct");
      }
    });
  }
});

test("migration URL uses a private CA file with full certificate verification", () => {
  const originalCa = process.env.DATABASE_SSL_CA_BASE64;
  const originalDirectUrl = process.env.DIRECT_URL;
  const ca = "-----BEGIN CERTIFICATE-----\nexample-root\n-----END CERTIFICATE-----\n";
  process.env.DATABASE_SSL_CA_BASE64 = Buffer.from(ca).toString("base64");
  process.env.DIRECT_URL = "postgresql://user:password@db.example.com:5432/postgres?sslmode=verify-full&sslrootcert=/unused.pem&sslaccept=accept_invalid_certs&sslidentity=/client.p12&sslpassword=test-password&schema=library";

  try {
    const url = new URL(getMigrationDatabaseUrl());
    assert.equal(url.searchParams.get("sslmode"), "require");
    assert.equal(url.searchParams.get("sslaccept"), "strict");
    assert.equal(url.searchParams.has("sslrootcert"), false);
    const caPath = url.searchParams.get("sslcert");
    assert.ok(caPath);
    assert.equal(readFileSync(caPath, "utf8"), ca);
    assert.equal(statSync(caPath).mode & 0o777, 0o600);
    assert.equal(url.searchParams.get("sslidentity"), "/client.p12");
    assert.equal(url.searchParams.get("sslpassword"), "test-password");
    assert.equal(url.searchParams.get("schema"), "library");
    assert.equal(getDirectDatabaseUrl(), process.env.DIRECT_URL);

    const rotatedCa = "-----BEGIN CERTIFICATE-----\nrotated-root\n-----END CERTIFICATE-----\n";
    process.env.DATABASE_SSL_CA_BASE64 = Buffer.from(rotatedCa).toString("base64");
    const rotatedPath = new URL(getMigrationDatabaseUrl()).searchParams.get("sslcert");
    assert.ok(rotatedPath);
    assert.equal(readFileSync(rotatedPath, "utf8"), rotatedCa);
  } finally {
    if (originalCa === undefined) delete process.env.DATABASE_SSL_CA_BASE64;
    else process.env.DATABASE_SSL_CA_BASE64 = originalCa;
    if (originalDirectUrl === undefined) delete process.env.DIRECT_URL;
    else process.env.DIRECT_URL = originalDirectUrl;
  }
});

test("remote pools verify TLS without an environment CA and preserve URL certificate files", (t) => {
  const original = process.env.DATABASE_SSL_CA_BASE64;
  delete process.env.DATABASE_SSL_CA_BASE64;
  const directory = mkdtempSync(join(tmpdir(), "db-url-ca-test-"));
  t.after(() => {
    if (original === undefined) delete process.env.DATABASE_SSL_CA_BASE64;
    else process.env.DATABASE_SSL_CA_BASE64 = original;
    rmSync(directory, { recursive: true, force: true });
  });
  const caPath = join(directory, "root.pem");
  writeFileSync(caPath, "URL root CA");
  const params = new URLSearchParams({ sslrootcert: caPath, sslmode: "require", uselibpqcompat: "true" });
  const client = new Client(getPgPoolConfig(`postgresql://db.example.com/postgres?${params}`));
  const ssl = (client as unknown as { connectionParameters: { ssl: { ca?: string; rejectUnauthorized?: boolean } } }).connectionParameters.ssl;
  assert.equal(ssl.ca, "URL root CA");
  assert.equal(ssl.rejectUnauthorized, true);
  const systemSsl = getPgPoolConfig("postgresql://db.example.com/postgres?ssl=true").ssl as { ca?: string; rejectUnauthorized?: boolean };
  assert.equal(systemSsl.ca, undefined);
  assert.equal(systemSsl.rejectUnauthorized, true);
});

test("remote TLS cannot be disabled through URL options", () => {
  for (const query of ["ssl=0", "ssl=false", "ssl=no-verify", "sslmode=disable", "sslmode=prefer", "sslmode=no-verify"]) {
    assert.throws(() => getPgPoolConfig(`postgresql://db.example.com/postgres?${query}`), /verified TLS/);
  }
});

test("local development keeps its connection string and effective remote hosts use TLS", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const url = `postgresql://${host}/postgres`;
    assert.deepEqual(getPgPoolConfig(url), { connectionString: url });
  }
  const config = getPgPoolConfig("postgresql://localhost/postgres?host=db.example.com&ssl=true");
  assert.equal((config.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized, true);
});

test("remote migrations require strict TLS even without a configured CA", (t) => {
  const originalCa = process.env.DATABASE_SSL_CA_BASE64;
  const originalDirect = process.env.DIRECT_URL;
  delete process.env.DATABASE_SSL_CA_BASE64;
  process.env.DIRECT_URL = "postgresql://db.example.com/postgres?sslrootcert=/trusted-root.pem";
  t.after(() => {
    if (originalCa === undefined) delete process.env.DATABASE_SSL_CA_BASE64;
    else process.env.DATABASE_SSL_CA_BASE64 = originalCa;
    if (originalDirect === undefined) delete process.env.DIRECT_URL;
    else process.env.DIRECT_URL = originalDirect;
  });
  const url = new URL(getMigrationDatabaseUrl());
  assert.equal(url.searchParams.get("sslmode"), "require");
  assert.equal(url.searchParams.get("sslaccept"), "strict");
  assert.equal(url.searchParams.get("sslcert"), "/trusted-root.pem");
  process.env.DIRECT_URL = "postgresql://127.0.0.1/postgres";
  assert.equal(getMigrationDatabaseUrl(), process.env.DIRECT_URL);
});
