import type { OperationState } from "./operationCoordinator";

export function canSubmitAttendance(state: {
  phase: OperationState["phase"];
  modeNotice: boolean;
  hasRefreshError: boolean;
  needsRefresh: boolean;
  modeChanging: boolean;
}) {
  return state.phase === "IDLE" && !state.modeNotice && !state.hasRefreshError &&
    !state.needsRefresh && !state.modeChanging;
}
