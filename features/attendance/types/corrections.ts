export type RecordSnapshot = {
  version: 1;
  id: string;
  eventId: string;
  studentId: string;
  method: "MANUAL" | "SCANNED";
  timein: string | null;
  timeout: string | null;
  recordedById: string | null;
  lastModifiedById: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type CurrentRecord = Omit<RecordSnapshot, "version">;

export type ReviewRow = { studentId: string; studentLabel: string; record: CurrentRecord | null;
  latestAction: string | null; latestChangeId: string | null; latestChangedAt: string | null; inCurrentAudience: boolean };
export type ReviewPage = { eventId: string; eventTitle: string; page: number; pageSize: number; total: number; items: ReviewRow[] };
export type HistoryChange = { id: string; action: string; recordId: string; actorId: string | null; actorName: string | null;
  reason: string | null; before: RecordSnapshot | null; after: RecordSnapshot | null; sourceChangeId: string | null; createdAt: string };
export type HistoryPage = { eventId: string; studentId: string; eventTitle: string; eventStart: string; eventEnd: string; studentLabel: string; inCurrentAudience: boolean;
  record: CurrentRecord | null; changes: HistoryChange[]; nextBeforeId: string | null; earlierHistoryUnavailable: boolean };
export type CorrectionCommand =
  | { commandId: string; action: "CORRECT"; studentId: string; recordId: string; expectedRevision: number; timein: string | null; timeout: string | null; reason: string }
  | { commandId: string; action: "VOID"; studentId: string; recordId: string; expectedRevision: number; reason: string }
  | { commandId: string; action: "RESTORE"; studentId: string; sourceChangeId: string; reason: string };
export type CorrectionReceipt = { eventId: string; studentId: string; changeId: string; commandId: string;
  action: CorrectionCommand["action"]; before: RecordSnapshot | null; after: RecordSnapshot | null; replayed: boolean };
