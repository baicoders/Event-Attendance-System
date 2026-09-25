import { studentIdSchema } from "@/globals/schemas/studentId";

export type AttendanceMode = "TIME_IN" | "TIME_OUT";
export type OperationContext = { eventId: string; viewerId: string; expectedMode: AttendanceMode };
export type OperationStudent = { id: string; name: string };
export type OperationRequest = { studentId: string; method: "SCANNED" | "MANUAL"; student?: OperationStudent };
export type SaveInput = OperationRequest & { eventId: string; expectedMode: AttendanceMode };
export type SaveResponse = {
  eventId: string; studentId: string; changed: boolean; operation: AttendanceMode;
  timein: string | null; timeout: string | null;
};
export type Outcome = "RECORDED" | "ALREADY_RECORDED" | "REJECTED" | "LOOKUP_FAILED" | "MODE_CHANGED" | "RESULT_UNKNOWN";
export type Attempt = {
  id: number; eventId: string; studentId: string; name?: string; method: OperationRequest["method"];
  expectedMode: AttendanceMode; outcome: Outcome; time?: string; attemptedAt: string; message?: string;
};
export type OperationState = {
  phase: "IDLE" | "LOOKUP" | "SAVING" | "AWAITING_ACKNOWLEDGEMENT";
  lastResult: Attempt | null;
  recent: Attempt[];
};

type Dependencies = {
  lookup: (eventId: string, studentId: string, signal: AbortSignal) => Promise<OperationStudent>;
  save: (input: SaveInput) => Promise<SaveResponse>;
  onChange?: (state: OperationState) => void;
};

function validResponse(response: SaveResponse, input: SaveInput): string | null {
  if (!response || response.eventId !== input.eventId || response.studentId !== input.studentId ||
    response.operation !== input.expectedMode || typeof response.changed !== "boolean") return null;
  const time = input.expectedMode === "TIME_IN" ? response.timein : response.timeout;
  return typeof time === "string" && Number.isFinite(Date.parse(time)) ? time : null;
}

export function createOperationCoordinator({ lookup, save, onChange }: Dependencies) {
  let context: OperationContext | null = null;
  let generation = 0;
  let busy = false;
  let pendingRead: AbortController | null = null;
  let nextId = 0;
  let state: OperationState = { phase: "IDLE", lastResult: null, recent: [] };

  const publish = (next: OperationState) => {
    state = next;
    onChange?.(state);
  };

  const finish = (attempt: Attempt, capturedGeneration: number) => {
    if (capturedGeneration !== generation) return null;
    const needsAck = ["REJECTED", "LOOKUP_FAILED", "MODE_CHANGED", "RESULT_UNKNOWN"].includes(attempt.outcome);
    publish({
      phase: needsAck ? "AWAITING_ACKNOWLEDGEMENT" : "IDLE",
      lastResult: attempt,
      recent: [attempt, ...state.recent].slice(0, 20),
    });
    return attempt;
  };

  return {
    getState: () => state,
    setContext(next: OperationContext | null) {
      if (context?.eventId === next?.eventId && context?.viewerId === next?.viewerId &&
        context?.expectedMode === next?.expectedMode) return;
      const sameViewerAndEvent = !!context && !!next && context.eventId === next.eventId && context.viewerId === next.viewerId;
      context = next;
      generation++;
      pendingRead?.abort();
      publish(sameViewerAndEvent
        ? { ...state, phase: state.phase === "AWAITING_ACKNOWLEDGEMENT" || state.phase === "SAVING" ? state.phase : "IDLE" }
        : { phase: "IDLE", lastResult: null, recent: [] });
    },
    acknowledge() {
      if (state.phase === "AWAITING_ACKNOWLEDGEMENT") publish({ ...state, phase: "IDLE" });
    },
    dispose() {
      generation++;
      context = null;
      pendingRead?.abort();
    },
    async submit(request: OperationRequest): Promise<Attempt | null> {
      if (busy || state.phase === "AWAITING_ACKNOWLEDGEMENT" || !context) return null;
      const parsedId = studentIdSchema.safeParse(request.studentId);
      if (!parsedId.success) {
        return finish({ id: ++nextId, eventId: context.eventId, studentId: "", method: request.method,
          expectedMode: context.expectedMode, attemptedAt: new Date().toISOString(), outcome: "REJECTED",
          message: "Invalid student code. Use manual entry or scan another code." }, generation);
      }
      const studentId = parsedId.data;
      busy = true;
      const captured = context;
      const capturedGeneration = generation;
      const base: Omit<Attempt, "outcome"> = {
        id: ++nextId, eventId: captured.eventId, studentId,
        method: request.method, expectedMode: captured.expectedMode, attemptedAt: new Date().toISOString(),
      };
      const isCurrent = () => capturedGeneration === generation;
      const sameViewerAndEvent = () => context?.eventId === captured.eventId && context?.viewerId === captured.viewerId;
      let writeSent = false;
      try {
        publish({ ...state, phase: request.student ? "SAVING" : "LOOKUP" });
        pendingRead = new AbortController();
        let student: OperationStudent;
        try {
          student = request.student ?? await lookup(captured.eventId, studentId, pendingRead.signal);
        } catch (error) {
          if (!isCurrent()) return null;
          const code = (error as { code?: string })?.code;
          const status = (error as { status?: number })?.status;
          const unavailable = status === 404 || code === "STUDENT_UNAVAILABLE";
          return finish({ ...base, studentId: "", outcome: unavailable ? "REJECTED" : "LOOKUP_FAILED",
            message: unavailable ? "Student unavailable for this event." : "Student lookup failed. No write was sent." }, capturedGeneration);
        }
        pendingRead = null;
        if (!isCurrent()) return null;
        publish({ ...state, phase: "SAVING" });
        const input: SaveInput = { eventId: captured.eventId, studentId, method: request.method, expectedMode: captured.expectedMode };
        writeSent = true;
        const response = await save(input);
        if (!sameViewerAndEvent()) return null;
        const time = validResponse(response, input);
        if (!time) return finish({ ...base, name: student.name, outcome: "RESULT_UNKNOWN",
          message: "The server response could not confirm this attempt." }, generation);
        return finish({ ...base, name: student.name, time,
          outcome: response.changed ? "RECORDED" : "ALREADY_RECORDED",
          message: captured.expectedMode === "TIME_OUT" && !response.timein
            ? "No time-in is recorded for this student. The time-out is stored with time-in left empty."
            : undefined }, generation);
      } catch (error) {
        if (writeSent ? !sameViewerAndEvent() : !isCurrent()) return null;
        const code = (error as { code?: string })?.code;
        const status = (error as { status?: number })?.status;
        const outcome: Outcome = code === "EVENT_MODE_CHANGED" ? "MODE_CHANGED" :
          status && status >= 400 && status < 500 && status !== 408 ? "REJECTED" :
          writeSent ? "RESULT_UNKNOWN" : "LOOKUP_FAILED";
        const message = outcome === "MODE_CHANGED" ? "Event mode changed. Review mode and continue." :
          outcome === "RESULT_UNKNOWN" ? "The server may have recorded this attempt." :
          error instanceof Error ? error.message : "Attendance failed.";
        return finish({ ...base, outcome, message }, writeSent ? generation : capturedGeneration);
      } finally {
        busy = false;
        pendingRead = null;
      }
    },
  };
}
