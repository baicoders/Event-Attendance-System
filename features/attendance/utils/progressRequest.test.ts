import assert from "node:assert/strict";
import test from "node:test";
import { progressRequestParams } from "./progressRequest";

test("summary keys and URLs discard inactive detail filters", () => {
  const a = progressRequestParams({ groupBy: "SECTION", includeRows: false, bucket: "g:a", status: "ALL", q: "old", page: 9, pageSize: 10 });
  const b = progressRequestParams({ groupBy: "SECTION", includeRows: false, bucket: "all", status: "NOT_YET", q: "", page: 1, pageSize: 50 });
  assert.equal(a, b);
  assert.equal(a, "groupBy=SECTION");
});

test("detail URL carries only the selected view", () => {
  assert.equal(progressRequestParams({ groupBy: "YEAR", includeRows: true, bucket: "y:YEAR_1", status: "CHECKED_IN", q: " Ana ", page: 2, pageSize: 25 }),
    "groupBy=YEAR&includeRows=1&bucket=y%3AYEAR_1&status=CHECKED_IN&q=Ana&page=2&pageSize=25");
});
