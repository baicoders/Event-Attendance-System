type RecordTimes = { timein: Date | string | null; timeout: Date | string | null };

export type ManualRecordState =
  | { kind: "NOT_REQUESTED" | "LOADING" | "ERROR" | "NO_RECORD" | "NO_TIME_IN" }
  | { kind: "READY"; record: RecordTimes };

export function manualRecordState(selected: boolean, loading: boolean, error: boolean, record: RecordTimes | null): ManualRecordState {
  if (!selected) return { kind: "NOT_REQUESTED" };
  if (loading) return { kind: "LOADING" };
  if (error) return { kind: "ERROR" };
  if (!record) return { kind: "NO_RECORD" };
  if (!record.timein) return { kind: "NO_TIME_IN" };
  return { kind: "READY", record };
}

export function detailActionDisabled(mode: "TIME_IN" | "TIME_OUT", state: ManualRecordState) {
  if (mode === "TIME_OUT") {
    return state.kind === "NO_RECORD" || state.kind === "NO_TIME_IN" ||
      (state.kind === "READY" && !!state.record.timeout);
  }
  return state.kind === "READY";
}
