import test from "node:test";
import assert from "node:assert/strict";
import { parseIssueFilters, optionsWithCurrentSelection } from "./filters";
test("a retained program or section filter stays visibly selected after its last assignment is removed", () => {
  const filters = parseIssueFilters(
    new URLSearchParams("program=old-program&section=old-section"),
  );
  assert.equal(filters.program, "old-program");
  assert.equal(
    optionsWithCurrentSelection([], filters.program)[0].value,
    "old-program",
  );
  assert.match(
    optionsWithCurrentSelection([], filters.section)[0].label,
    /old-section/,
  );
});
test("invalid enumerated issue filters do not remain invisibly active", () => {
  const filters = parseIssueFilters(
    new URLSearchParams(
      "schoolLevel=invalid&issue=invalid&recordStatus=invalid&yearLevel=INVALID",
    ),
  );
  assert.equal(filters.schoolLevel, "");
  assert.equal(filters.issue, "");
  assert.equal(filters.recordStatus, "");
  assert.equal(filters.yearLevel, "");
});
