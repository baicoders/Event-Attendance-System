import assert from "node:assert/strict";
import test from "node:test";
import { recordInfrastructureFailure } from "./report.mjs";

test("a crashed partial run cannot retain a passed status or lose completed evidence", () => {
  const partial = { status: "running", completed: false, results: [{ name: "login", status: "passed" }] };
  const result = recordInfrastructureFailure(partial, "Browser timed out");
  assert.equal(result.status, "infrastructure_failure");
  assert.equal(result.completed, false);
  assert.deepEqual(result.results, partial.results);
  assert.deepEqual(result.infrastructureErrors, ["Browser timed out"]);
});

test("cleanup failure fails a finished run and preserves earlier infrastructure errors", () => {
  const result = recordInfrastructureFailure({ status: "passed", completed: true, infrastructureErrors: ["earlier"] }, "Cleanup failed");
  assert.equal(result.status, "infrastructure_failure");
  assert.deepEqual(result.infrastructureErrors, ["earlier", "Cleanup failed"]);
});
