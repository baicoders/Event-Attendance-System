import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Client } from "pg";
import {
  getMigrationDatabaseUrl,
  getRuntimePoolConnectionString,
  sslForUrl,
} from "./dbConfig";

test("remote database TLS trusts the configured CA and still verifies certificates", () => {
  const original = process.env.DATABASE_SSL_CA_BASE64;
  const ca = "-----BEGIN CERTIFICATE-----\nexample-root\n-----END CERTIFICATE-----\n";
  process.env.DATABASE_SSL_CA_BASE64 = Buffer.from(ca).toString("base64");

  try {
    assert.deepEqual(sslForUrl("postgresql://db.example.com/postgres"), {
      ca,
      rejectUnauthorized: true,
    });
  } finally {
    if (original === undefined) delete process.env.DATABASE_SSL_CA_BASE64;
    else process.env.DATABASE_SSL_CA_BASE64 = original;
  }
});

test("runtime pool keeps the configured CA when the URL includes SSL parameters", () => {
  const original = process.env.DATABASE_SSL_CA_BASE64;
  const ca = "-----BEGIN CERTIFICATE-----\nexample-root\n-----END CERTIFICATE-----\n";
  const url =
    "postgresql://user:password@db.example.com/postgres?sslmode=require&sslrootcert=%2Fprovider%2Froot.pem&application_name=library";
  process.env.DATABASE_SSL_CA_BASE64 = Buffer.from(ca).toString("base64");

  try {
    const poolUrl = new URL(getRuntimePoolConnectionString(url));
    assert.equal(poolUrl.searchParams.has("sslmode"), false);
    assert.equal(poolUrl.searchParams.has("sslrootcert"), false);
    assert.equal(poolUrl.searchParams.get("application_name"), "library");

    const client = new Client({
      connectionString: poolUrl.toString(),
      ssl: sslForUrl(url),
    });
    const ssl = (client as unknown as { connectionParameters: { ssl: unknown } })
      .connectionParameters.ssl;
    assert.deepEqual(ssl, {
      ca,
      rejectUnauthorized: true,
    });
  } finally {
    if (original === undefined) delete process.env.DATABASE_SSL_CA_BASE64;
    else process.env.DATABASE_SSL_CA_BASE64 = original;
  }
});

test("migration URL uses a private CA file with full certificate verification", () => {
  const originalCa = process.env.DATABASE_SSL_CA_BASE64;
  const originalDirectUrl = process.env.DIRECT_URL;
  const ca = "-----BEGIN CERTIFICATE-----\nexample-root\n-----END CERTIFICATE-----\n";
  process.env.DATABASE_SSL_CA_BASE64 = Buffer.from(ca).toString("base64");
  process.env.DIRECT_URL = "postgresql://user:password@db.example.com:5432/postgres";

  try {
    const url = new URL(getMigrationDatabaseUrl());
    assert.equal(url.searchParams.get("sslmode"), "verify-full");
    const caPath = url.searchParams.get("sslrootcert");
    assert.ok(caPath);
    assert.equal(readFileSync(caPath, "utf8"), ca);
  } finally {
    if (originalCa === undefined) delete process.env.DATABASE_SSL_CA_BASE64;
    else process.env.DATABASE_SSL_CA_BASE64 = originalCa;
    if (originalDirectUrl === undefined) delete process.env.DIRECT_URL;
    else process.env.DIRECT_URL = originalDirectUrl;
  }
});
