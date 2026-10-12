import assert from "node:assert/strict";
import { test } from "node:test";
import { sslForUrl } from "./dbConfig";

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
