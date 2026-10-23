import assert from "node:assert/strict";
import { test } from "node:test";
import { databaseErrorLog } from "./databaseErrorLog";

test("database diagnostics expose the TLS reason and code without the query or credentials", () => {
  const error = Object.assign(new Error("Query with private values"), {
    code: "P1011",
    meta: { driverAdapterError: { cause: { kind: "TlsConnectionError", reason: "self-signed certificate in certificate chain" } } },
  });
  assert.deepEqual(databaseErrorLog(error), {
    name: "Error", code: "P1011", kind: "TlsConnectionError",
    detail: "self-signed certificate in certificate chain",
  });
});

test("database diagnostics redact connection strings and exclude raw query errors", () => {
  const error = Object.assign(new Error("secret query"), {
    code: "P1001",
    meta: { driverAdapterError: { cause: { kind: "DatabaseNotReachable", originalMessage: "Cannot reach postgresql://user:secret@db.example.com/db?token=secret" } } },
  });
  const diagnostic = JSON.stringify(databaseErrorLog(error));
  assert.equal(diagnostic.includes("secret"), false);
  assert.equal(diagnostic.includes("[REDACTED_URL]"), true);
  assert.deepEqual(databaseErrorLog(new Error("private query")), { name: "Error" });
  assert.deepEqual(databaseErrorLog(null), {});
});

test("database diagnostics omit query parameter values from driver and raw-query errors", () => {
  // PostgreSQL 22P02 repeats the invalid parameter in its message; the installed
  // Prisma pg adapter preserves it as originalMessage and meta.message.
  const detail = 'invalid input syntax for type integer: "synthetic-private-value"';
  const error = { name: "PrismaClientKnownRequestError", code: "P2010", meta: {
    message: detail,
    driverAdapterError: { cause: { kind: "InvalidInputValue", originalCode: "22P02", originalMessage: detail } },
  } };
  assert.deepEqual(databaseErrorLog(error), {
    name: "PrismaClientKnownRequestError", code: "P2010", kind: "InvalidInputValue", driverCode: "22P02",
  });
  assert.deepEqual(databaseErrorLog({ code: "P2010", meta: { message: detail } }), { code: "P2010" });
});

test("connection diagnostics redact URLs containing literal quote characters", () => {
  const error = { meta: { driverAdapterError: { cause: {
    kind: "DatabaseNotReachable", originalMessage: "Cannot reach postgresql://user:s'cret@db.example.com/db",
  } } } };
  assert.deepEqual(databaseErrorLog(error), {
    kind: "DatabaseNotReachable", detail: "Cannot reach [REDACTED_URL]",
  });
});
