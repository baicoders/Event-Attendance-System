BEGIN;

-- CreateEnum
CREATE TYPE "RosterExceptionKind" AS ENUM ('INCLUDE', 'EXCLUDE');

-- AlterTable
ALTER TABLE "TeacherOnboarding" ADD COLUMN     "classId" TEXT;

-- CreateTable
CREATE TABLE "AcademicTerm" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "normalizedKey" VARCHAR(260) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Manila',
    "archivedAt" TIMESTAMPTZ(3),
    "createdById" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AcademicTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(40),
    "normalizedCode" VARCHAR(80),
    "title" VARCHAR(160) NOT NULL,
    "normalizedTitle" VARCHAR(320) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "createdById" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassOffering" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "primaryTeacherId" TEXT NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "schedule" JSONB,
    "graceMinutes" INTEGER NOT NULL DEFAULT 15,
    "configRevision" INTEGER NOT NULL DEFAULT 0,
    "rosterRevision" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassSection" (
    "classId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassSection_pkey" PRIMARY KEY ("classId","sectionId")
);

-- CreateTable
CREATE TABLE "ClassRosterException" (
    "classId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" "RosterExceptionKind" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassRosterException_pkey" PRIMARY KEY ("classId","studentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcademicTerm_normalizedKey_key" ON "AcademicTerm"("normalizedKey");

-- CreateIndex
CREATE INDEX "AcademicTerm_startDate_endDate_idx" ON "AcademicTerm"("startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_normalizedCode_key" ON "Subject"("normalizedCode");

-- CreateIndex
CREATE INDEX "Subject_normalizedTitle_idx" ON "Subject"("normalizedTitle");

-- CreateIndex
CREATE INDEX "ClassOffering_primaryTeacherId_termId_archivedAt_id_idx" ON "ClassOffering"("primaryTeacherId", "termId", "archivedAt", "id");

-- CreateIndex
CREATE INDEX "ClassOffering_termId_subjectId_idx" ON "ClassOffering"("termId", "subjectId");

-- CreateIndex
CREATE INDEX "ClassSection_sectionId_classId_idx" ON "ClassSection"("sectionId", "classId");

-- CreateIndex
CREATE INDEX "ClassRosterException_studentId_classId_idx" ON "ClassRosterException"("studentId", "classId");

-- AddForeignKey
ALTER TABLE "TeacherOnboarding" ADD CONSTRAINT "TeacherOnboarding_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassOffering" ADD CONSTRAINT "ClassOffering_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassOffering" ADD CONSTRAINT "ClassOffering_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassOffering" ADD CONSTRAINT "ClassOffering_primaryTeacherId_fkey" FOREIGN KEY ("primaryTeacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSection" ADD CONSTRAINT "ClassSection_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSection" ADD CONSTRAINT "ClassSection_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassRosterException" ADD CONSTRAINT "ClassRosterException_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassRosterException" ADD CONSTRAINT "ClassRosterException_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE UNIQUE INDEX "Subject_uncoded_title_unique" ON "Subject"("normalizedTitle") WHERE code IS NULL;
ALTER TABLE "AcademicTerm" ADD CONSTRAINT "AcademicTerm_date_timezone" CHECK ("endDate">="startDate" AND "timeZone"='Asia/Manila' AND revision>=0);
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_revision" CHECK (revision>=0);
ALTER TABLE "ClassOffering" ADD CONSTRAINT "ClassOffering_settings" CHECK (
 "graceMinutes" BETWEEN 0 AND 180 AND "configRevision">=0 AND "rosterRevision">=0
 AND (schedule IS NULL OR (jsonb_typeof(schedule)='object' AND schedule @> '{"v":1}'::jsonb))
);
CREATE FUNCTION school_guard_class_section() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "Group" WHERE id=NEW."sectionId" AND category='SECTION' AND slug<>'employees') THEN
  RAISE EXCEPTION 'Classes may select only official student sections' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ClassSection_category" BEFORE INSERT OR UPDATE ON "ClassSection"
 FOR EACH ROW EXECUTE FUNCTION school_guard_class_section();
CREATE FUNCTION school_guard_selected_section_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.category<>'SECTION' OR NEW.slug='employees') AND EXISTS(SELECT 1 FROM "ClassSection" WHERE "sectionId"=OLD.id) THEN
  RAISE EXCEPTION 'An assigned classroom section cannot change category' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Group_classroom_category" BEFORE UPDATE OF category,slug ON "Group"
 FOR EACH ROW EXECUTE FUNCTION school_guard_selected_section_category();

COMMIT;
