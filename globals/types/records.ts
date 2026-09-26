import { Record as PrismaRecord  } from "@prisma/client";

export type Record = PrismaRecord;

// Audit actor columns are stamped by the server, never sent by the client
export type NewRecord = Omit<
  Record,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "timein"
  | "timeout"
  | "recordedById"
  | "lastModifiedById"
>

// expectedMode is a transport precondition, not a Record column.
export type CreateRecordInput = NewRecord & { expectedMode?: "TIME_IN" | "TIME_OUT" };
export type RecordWireResult = Omit<Record, "timein" | "timeout" | "createdAt" | "updatedAt"> & {
  timein: string | null;
  timeout: string | null;
  createdAt: string;
  updatedAt: string;
  changed: boolean;
  operation: "TIME_IN" | "TIME_OUT";
};

export type AttendanceStatus = "absent" | "present";
