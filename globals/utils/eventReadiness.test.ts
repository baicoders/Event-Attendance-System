import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateEventReadiness, type ReadinessInput } from "./eventReadiness";

const base: ReadinessInput = {
  id: "event-1", updatedAt: new Date("2026-09-25T00:00:00Z"),
  status: "APPROVED", category: "ALL", start: new Date("2026-09-28T00:00:00Z"),
  end: new Date("2026-09-28T04:00:00Z"), allDay: false, isTimeout: false,
  createdById: "owner-1", owner: { name: "Maria Santos", status: "ACTIVE" },
  viewer: { id: "owner-1", role: "ORGANIZER" }, eligibleCount: 487,
  invalidAudience: false, evaluatedAt: new Date("2026-09-25T01:00:00Z"),
};

const evaluate = (changes: Partial<ReadinessInput> = {}) => evaluateEventReadiness({ ...base, ...changes });
const check = (result: ReturnType<typeof evaluate>, id: string) => result.checks.find((item) => item.id === id)!;

describe("event readiness evaluator", () => {
  it("passes an approved event without warnings and shows Manila schedule", () => {
    const result = evaluate();
    assert.equal(result.summary, "CHECKS_PASSED");
    assert.equal(result.recordingAllowed, true);
    assert.equal(result.canManageMode, true);
    assert.match(check(result, "schedule").detail, /Sep 28, 2026.*8:00.*12:00/);
    assert.deepEqual(result.checks.map((item) => item.id), ["approval", "audience", "roster", "schedule", "owner", "recordingMode"]);
  });

  for (const status of ["DRAFT", "PENDING", "REJECTED"] as const) {
    it(`${status} blocks recording while retaining all checks`, () => {
      const result = evaluate({ status, eligibleCount: 0 });
      assert.equal(result.summary, "NOT_APPROVED");
      assert.equal(result.recordingAllowed, false);
      assert.equal(result.canManageMode, false);
      assert.equal(check(result, "roster").code, "EMPTY_AUDIENCE");
    });
  }

  it("warnings do not change existing approved-event permission", () => {
    const result = evaluate({ eligibleCount: 0, owner: null, category: "YEAR", isTimeout: true });
    assert.equal(result.summary, "ATTENTION");
    assert.equal(result.recordingAllowed, true);
    assert.equal(result.recordingMode, "TIME_OUT");
    assert.match(check(result, "recordingMode").detail, /prior time-in/);
    assert.equal(check(result, "audience").code, "YEAR_GROUP_LIMITATION");
    assert.equal(check(result, "owner").code, "OWNER_MISSING");
  });

  it("distinguishes invalid scope from a valid empty roster", () => {
    const result = evaluate({ invalidAudience: true, eligibleCount: null });
    assert.equal(check(result, "audience").code, "AUDIENCE_INVALID");
    assert.equal(check(result, "roster").code, "AUDIENCE_COUNT_UNAVAILABLE");
    assert.equal(result.eligibleCount, null);
  });

  it("reports inactive owner and leaves mode management to owner or admin", () => {
    const other = evaluate({ viewer: { id: "other", role: "ORGANIZER" }, owner: { name: "Maria", status: "REJECTED" } });
    assert.equal(other.canManageMode, false);
    assert.equal(check(other, "owner").code, "OWNER_INACTIVE");
    assert.equal(evaluate({ viewer: { id: "admin", role: "ADMIN" }, owner: null }).canManageMode, true);
  });

  it("accepts equal timed dates and same-day all-day dates", () => {
    const same = new Date("2026-09-30T00:00:00Z");
    assert.equal(check(evaluate({ start: same, end: same }), "schedule").state, "PASS");
    assert.equal(check(evaluate({ start: new Date("2026-09-30T10:00:00Z"), end: new Date("2026-09-30T00:00:00Z"), allDay: true }), "schedule").state, "PASS");
    assert.equal(check(evaluate({ start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-09-30T00:00:00Z") }), "schedule").code, "SCHEDULE_INVALID");
    assert.equal(check(evaluate({ start: new Date("2026-09-30T16:00:00Z"), end: new Date("2026-09-30T15:00:00Z"), allDay: true }), "schedule").code, "SCHEDULE_INVALID");
  });
});
