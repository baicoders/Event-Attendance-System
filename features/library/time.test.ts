import assert from "node:assert/strict";
import { test } from "node:test";
import { libraryDay, closingTime, libraryRange, visitStatus } from "./time";

test("Manila date and 5 PM closing respect the calendar boundary", () => {
  assert.equal(libraryDay(new Date("2026-10-11T16:01:00Z")), "2026-10-12");
  assert.equal(closingTime("2026-10-12").toISOString(), "2026-10-12T09:00:00.000Z");
});
test("daily, Monday weekly and monthly ranges use entry dates", () => {
  assert.deepEqual(libraryRange("2026-10-14", "daily"), { start: "2026-10-14", end: "2026-10-14" });
  assert.deepEqual(libraryRange("2026-10-11", "weekly"), { start: "2026-10-05", end: "2026-10-11" });
  assert.deepEqual(libraryRange("2026-10-14", "monthly"), { start: "2026-10-01", end: "2026-10-31" });
  assert.throws(() => libraryRange("2026-02-30", "daily"));
});
test("normal, forgotten, after-hours and librarian closures stay distinguishable", () => {
  const visit = { visitDay: "2026-10-12", timeIn: new Date("2026-10-12T00:00:00Z"), timeOut: null, administrativelyClosedAt: null };
  assert.equal(visitStatus(visit, new Date("2026-10-12T08:59:59Z")), "Inside");
  assert.equal(visitStatus(visit, new Date("2026-10-12T09:00:00Z")), "Missing Time Out");
  assert.equal(visitStatus({ ...visit, timeIn: new Date("2026-10-12T09:15:00Z") }, new Date("2026-10-12T10:00:00Z")), "Individual review required");
  assert.equal(visitStatus({ ...visit, timeOut: closingTime(visit.visitDay), administrativelyClosedAt: new Date() }), "Closed by librarian");
});
