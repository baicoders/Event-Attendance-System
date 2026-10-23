-- Additive: existing academic groups and implicit membership rows are unchanged.
ALTER TYPE "EventCategory" ADD VALUE 'CUSTOM';
CREATE TABLE "CustomGroupMembership" (
  "studentId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "position" VARCHAR(160),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CustomGroupMembership_pkey" PRIMARY KEY ("studentId", "groupId"),
  CONSTRAINT "CustomGroupMembership_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomGroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CustomGroupMembership_studentId_key" ON "CustomGroupMembership"("studentId");
CREATE INDEX "CustomGroupMembership_groupId_idx" ON "CustomGroupMembership"("groupId");
