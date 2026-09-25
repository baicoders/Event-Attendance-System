import type { EventStatus } from "@prisma/client";

export type ReadinessCheck = {
  id: "approval" | "audience" | "roster" | "schedule" | "owner" | "recordingMode";
  state: "PASS" | "WARNING" | "INFO" | "BLOCKED";
  code: string;
  detail: string;
};

export type EventReadiness = {
  eventId: string;
  eventUpdatedAt: string;
  evaluatedAt: string;
  basis: "CURRENT_ROSTER_SAVED_EVENT";
  approvalStatus: EventStatus;
  recordingMode: "TIME_IN" | "TIME_OUT";
  recordingAllowed: boolean;
  canManageMode: boolean;
  eligibleCount: number | null;
  summary: "NOT_APPROVED" | "ATTENTION" | "CHECKS_PASSED";
  checks: ReadinessCheck[];
};
