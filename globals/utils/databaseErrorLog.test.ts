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
