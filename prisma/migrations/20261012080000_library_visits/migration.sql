CREATE TABLE "LibraryVisit" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "visitDay" VARCHAR(10) NOT NULL,
    "personType" VARCHAR(8) NOT NULL,
    "timeIn" TIMESTAMPTZ(3) NOT NULL,
    "timeOut" TIMESTAMPTZ(3),
    "recordedById" TEXT,
    "timeOutRecordedById" TEXT,
    "timeInRequestId" UUID,
    "timeOutRequestId" UUID,
    "administrativelyClosedAt" TIMESTAMPTZ(3),
    "administrativelyClosedById" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LibraryVisit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LibraryVisit_personType_check" CHECK ("personType" IN ('STUDENT', 'EMPLOYEE')),
    CONSTRAINT "LibraryVisit_times_check" CHECK ("timeOut" IS NULL OR "timeOut" >= "timeIn"),
    CONSTRAINT "LibraryVisit_day_check" CHECK ("visitDay" = to_char("timeIn" AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD'))
);
CREATE UNIQUE INDEX "LibraryVisit_timeInRequestId_key" ON "LibraryVisit"("timeInRequestId");
CREATE UNIQUE INDEX "LibraryVisit_timeOutRequestId_key" ON "LibraryVisit"("timeOutRequestId");
CREATE INDEX "LibraryVisit_studentId_visitDay_idx" ON "LibraryVisit"("studentId", "visitDay");
CREATE INDEX "LibraryVisit_visitDay_idx" ON "LibraryVisit"("visitDay");
CREATE UNIQUE INDEX "LibraryVisit_one_open_per_day" ON "LibraryVisit"("studentId", "visitDay") WHERE "timeOut" IS NULL;
ALTER TABLE "LibraryVisit" ADD CONSTRAINT "LibraryVisit_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The database group is authoritative. Safe if an employees group already exists.
INSERT INTO "Group" ("id", "name", "slug", "category", "createdAt", "updatedAt")
VALUES ('library-employees', 'Employees', 'employees', 'SECTION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
