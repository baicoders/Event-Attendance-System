-- Existing records become revision zero without inventing past history.
ALTER TABLE "Record" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "AttendanceChangeAction" AS ENUM ('CREATE', 'TIME_IN', 'TIME_OUT', 'CORRECT', 'VOID', 'RESTORE');

CREATE TABLE "AttendanceChange" (
    "id" BIGSERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "action" "AttendanceChangeAction" NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "eventTitle" TEXT NOT NULL,
    "studentLabel" TEXT NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "commandId" TEXT,
    "commandHash" TEXT,
    "sourceChangeId" BIGINT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttendanceChange_actorId_commandId_key" ON "AttendanceChange"("actorId", "commandId");
CREATE INDEX "AttendanceChange_eventId_studentId_id_idx" ON "AttendanceChange"("eventId", "studentId", "id");
CREATE INDEX "AttendanceChange_eventId_id_idx" ON "AttendanceChange"("eventId", "id");
CREATE INDEX "AttendanceChange_studentId_id_idx" ON "AttendanceChange"("studentId", "id");
CREATE INDEX "AttendanceChange_recordId_idx" ON "AttendanceChange"("recordId");

ALTER TABLE "AttendanceChange" ADD CONSTRAINT "AttendanceChange_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceChange" ADD CONSTRAINT "AttendanceChange_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceChange" ADD CONSTRAINT "AttendanceChange_sourceChangeId_fkey" FOREIGN KEY ("sourceChangeId") REFERENCES "AttendanceChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
