-- CreateEnum
CREATE TYPE "AccountState" AS ENUM ('ENABLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ClassroomMembershipStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REVOKED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'MEMBER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountState" "AccountState" NOT NULL DEFAULT 'ENABLED';

-- CreateTable
CREATE TABLE "ClassroomMembership" (
    "userId" TEXT NOT NULL,
    "status" "ClassroomMembershipStatus" NOT NULL DEFAULT 'PENDING',
    "departmentOrDesignation" VARCHAR(160) NOT NULL,
    "staffReference" VARCHAR(100),
    "applicationText" VARCHAR(1000) NOT NULL DEFAULT '',
    "appliedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewerId" TEXT,
    "reviewerName" TEXT,
    "decisionReason" VARCHAR(1000),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassroomMembership_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TeacherOnboarding" (
    "userId" TEXT NOT NULL,
    "flowVersion" INTEGER NOT NULL DEFAULT 1,
    "step" VARCHAR(40) NOT NULL DEFAULT 'WELCOME',
    "draft" JSONB NOT NULL DEFAULT '{}',
    "completedAt" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeacherOnboarding_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ClassroomAudit" (
    "id" BIGSERIAL NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" TEXT NOT NULL,
    "classId" TEXT,
    "sessionId" TEXT,
    "studentId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" VARCHAR(1000),
    "commandId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassroomAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassroomCommandReceipt" (
    "actorId" TEXT NOT NULL,
    "commandId" UUID NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "resourceId" TEXT NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "httpStatus" INTEGER NOT NULL DEFAULT 200,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassroomCommandReceipt_pkey" PRIMARY KEY ("actorId","commandId")
);

-- CreateIndex
CREATE INDEX "ClassroomMembership_status_appliedAt_userId_idx" ON "ClassroomMembership"("status", "appliedAt", "userId");

-- CreateIndex
CREATE INDEX "ClassroomAudit_classId_id_idx" ON "ClassroomAudit"("classId", "id");

-- CreateIndex
CREATE INDEX "ClassroomAudit_sessionId_id_idx" ON "ClassroomAudit"("sessionId", "id");

-- CreateIndex
CREATE INDEX "ClassroomAudit_studentId_id_idx" ON "ClassroomAudit"("studentId", "id");

-- CreateIndex
CREATE INDEX "ClassroomAudit_actorId_createdAt_id_idx" ON "ClassroomAudit"("actorId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ClassroomAudit_action_createdAt_id_idx" ON "ClassroomAudit"("action", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ClassroomCommandReceipt_resourceId_createdAt_idx" ON "ClassroomCommandReceipt"("resourceId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClassroomMembership" ADD CONSTRAINT "ClassroomMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherOnboarding" ADD CONSTRAINT "TeacherOnboarding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- All new domain mutations and their receipts share one commit boundary.
ALTER TABLE "ClassroomMembership" ADD CONSTRAINT "ClassroomMembership_revision_check" CHECK (revision >= 0);
ALTER TABLE "TeacherOnboarding" ADD CONSTRAINT "TeacherOnboarding_draft_check" CHECK (jsonb_typeof(draft) = 'object' AND octet_length(draft::text) <= 16384);
ALTER TABLE "ClassroomCommandReceipt" ADD CONSTRAINT "ClassroomCommandReceipt_hash_check" CHECK ("requestHash" ~ '^[a-f0-9]{64}$');
CREATE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Immutable history cannot be changed or deleted' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "ClassroomAudit_immutable" BEFORE UPDATE OR DELETE ON "ClassroomAudit" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER "ClassroomCommandReceipt_immutable" BEFORE UPDATE OR DELETE ON "ClassroomCommandReceipt" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE INDEX "User_accountState_idx" ON "User"("accountState");
