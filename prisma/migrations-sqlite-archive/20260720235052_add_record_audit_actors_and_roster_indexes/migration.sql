-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Record" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "timein" DATETIME,
    "timeout" DATETIME,
    "recordedById" TEXT,
    "lastModifiedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Record_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Record_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Record_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Record_lastModifiedById_fkey" FOREIGN KEY ("lastModifiedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Record" ("createdAt", "eventId", "id", "method", "studentId", "timein", "timeout", "updatedAt") SELECT "createdAt", "eventId", "id", "method", "studentId", "timein", "timeout", "updatedAt" FROM "Record";
DROP TABLE "Record";
ALTER TABLE "new_Record" RENAME TO "Record";
CREATE UNIQUE INDEX "Record_eventId_studentId_key" ON "Record"("eventId", "studentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Event_status_start_idx" ON "Event"("status", "start");

-- CreateIndex
CREATE INDEX "Student_updatedAt_id_idx" ON "Student"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "Student_lastName_firstName_id_idx" ON "Student"("lastName", "firstName", "id");

-- CreateIndex
CREATE INDEX "Student_schoolLevel_yearLevel_lastName_firstName_id_idx" ON "Student"("schoolLevel", "yearLevel", "lastName", "firstName", "id");
