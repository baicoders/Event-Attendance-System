-- Add external lookup keys without changing the primary key or any foreign key.
ALTER TABLE "Student" ADD COLUMN "usn" TEXT, ADD COLUMN "lrn" TEXT;
ALTER TABLE "Student" ALTER COLUMN "schoolLevel" DROP NOT NULL,
                      ALTER COLUMN "yearLevel" DROP NOT NULL;

-- Only documented numeric USN-shaped legacy IDs are safe to classify automatically.
-- library-mvp represents employees with this membership; never classify those IDs.
UPDATE "Student" AS s SET "usn" = s."id"
WHERE s."id" ~ '^[0-9]{11}$'
  AND NOT EXISTS (
    SELECT 1 FROM "_GroupToStudent" gs JOIN "Group" g ON g."id" = gs."A"
    WHERE gs."B" = s."id" AND g."slug" = 'employees'
  );
CREATE UNIQUE INDEX "Student_usn_key" ON "Student"("usn");
CREATE UNIQUE INDEX "Student_lrn_key" ON "Student"("lrn");
ALTER TABLE "Student" ADD CONSTRAINT "Student_usn_format"
  CHECK ("usn" IS NULL OR (length("usn") = 11 AND "usn" = btrim("usn")));
ALTER TABLE "Student" ADD CONSTRAINT "Student_lrn_format"
  CHECK ("lrn" IS NULL OR "lrn" ~ '^[0-9]{12}$');
-- At least one identifier is a normal-student application invariant. A universal
-- CHECK would incorrectly reject legacy/unclassified people and library employees.
