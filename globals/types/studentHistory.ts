export type HistoryView = "recorded" | "current-roster";
export type HistoryOutcomeFilter = "all" | "attended" | "late" | "missing";
export type HistoryDisplayState = "PRESENT" | "LATE" | "INCOMPLETE_RECORD" |
  "ABSENT_CURRENT_ROSTER" | "NOT_YET_CHECKED_IN" | "NOT_STARTED" | "REVIEW_REQUIRED";

export type StudentHistoryRow = {
  eventId: string;
  title: string;
  category: string;
  start: string;
  end: string;
  allDay: boolean;
  recordId: string | null;
  timein: string | null;
  timeout: string | null;
  method: string | null;
  currentlyEligible: boolean;
  countedInComparison: boolean;
  derivedOutcome: "PRESENT" | "LATE" | "ABSENT";
  displayState: HistoryDisplayState;
  comparisonExclusionReason: "OUTSIDE_CURRENT_AUDIENCE" | "NOT_BEFORE_TODAY" | "INVALID_SCHEDULE" | null;
};

export type StudentHistoryResponse = {
  student: { id: string; displayName: string; schoolLevel: string; groups: string[] };
  evaluatedAt: string;
  timeZone: "Asia/Manila";
  range: { from: string; to: string; basis: "EVENT_START_DATE" };
  view: HistoryView;
  comparisonBasis: "CURRENT_ROSTER_SCHEDULED_BEFORE_TODAY";
  summary: {
    recordedRows: number;
    recordedTimeIns: number;
    incompleteRecordedRows: number;
    recordedTimeInsOutsideCurrentScope: number;
    comparisonEvents: number;
    comparisonAttended: number;
    comparisonAbsent: number;
    comparisonRatePercent: number | null;
    excludedFromComparison: number;
  };
  rows: StudentHistoryRow[];
  rowCount: number;
  page: number;
  pageSize: number;
};
