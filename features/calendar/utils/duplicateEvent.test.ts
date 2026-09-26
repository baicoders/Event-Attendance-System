import { test } from "node:test";
import assert from "node:assert/strict";
import type { Event } from "../../../globals/types/events";
import { ApiError } from "../../../globals/utils/api";
import { copyEventDefaults, isDuplicateRangeWhollyPast, isUnknownCreateOutcome, makeDuplicatePayload } from "./duplicateEvent";

const source = {
  id: "source", title: "Foundation Day", location: null,
  description: "Annual event", category: "DEPARTMENT", allDay: true,
  includedGroups: [{ id: "group-a" }, { id: "group-b" }],
  start: new Date("2026-09-21T00:00:00Z"), end: new Date("2026-09-21T00:00:00Z"),
  status: "APPROVED", createdById: "another-user", reviewedById: "admin",
  reviewedAt: new Date(), rejectionReason: "old review", isTimeout: true,
  createdAt: new Date(), updatedAt: new Date(), records: [{ id: "record" }],
  acknowledgeAudienceChange: true,
} as unknown as Event;

test("copy defaults contain only reusable fields and an independent group array", () => {
  const defaults = copyEventDefaults(source);
  assert.deepEqual(Object.keys(defaults).sort(), [
    "allDay", "category", "description", "includedGroups", "location", "title",
  ]);
  assert.deepEqual(defaults.includedGroups, ["group-a", "group-b"]);
  defaults.includedGroups.pop();
  assert.equal(source.includedGroups.length, 2);
});

test("past-range check preserves today's all-day and timed boundaries", () => {
  const now = new Date(2026, 8, 25, 12, 0);
  assert.equal(isDuplicateRangeWhollyPast(new Date(2026, 8, 24), true, now), true);
  assert.equal(isDuplicateRangeWhollyPast(new Date(2026, 8, 25), true, now), false);
  assert.equal(isDuplicateRangeWhollyPast(new Date(2026, 8, 25, 11, 59), false, now), true);
  assert.equal(isDuplicateRangeWhollyPast(new Date(2026, 8, 25, 12, 0), false, now), false);
  assert.equal(isDuplicateRangeWhollyPast(new Date(2027, 0, 1), true, now), false);
});

test("create payload has fresh dates and no source identity or metadata", () => {
  const start = new Date("2026-10-01T09:00:00+08:00");
  const end = new Date("2026-10-01T10:00:00+08:00");
  const payload = makeDuplicatePayload(copyEventDefaults(source), start, end);
  assert.deepEqual(Object.keys(payload).sort(), [
    "allDay", "category", "description", "end", "includedGroups", "location", "start", "title",
  ]);
  assert.equal(payload.start.getTime(), start.getTime());
  assert.equal(payload.end.getTime(), end.getTime());
  assert.equal("id" in payload, false);
});

test("lost or unreadable create responses warn about an unknown outcome", () => {
  assert.equal(isUnknownCreateOutcome(new TypeError("Failed to fetch")), true);
  assert.equal(isUnknownCreateOutcome(new ApiError("Invalid server response", 201)), true);
  assert.equal(isUnknownCreateOutcome(new ApiError("Group not found", 400)), false);
});
