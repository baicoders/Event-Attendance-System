BEGIN;

-- CreateEnum
CREATE TYPE "ClassroomSessionState" AS ENUM ('ACTIVE', 'FINALIZED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ClassroomAttendanceStatus" AS ENUM ('UNMARKED', 'PRESENT', 'LATE', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "ClassroomAttendanceMethod" AS ENUM ('SCANNED', 'MANUAL', 'FINALIZATION');

-- CreateTable
CREATE TABLE "ClassroomSession" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "state" "ClassroomSessionState" NOT NULL DEFAULT 'ACTIVE',
    "scheduledStartAt" TIMESTAMPTZ(3) NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMPTZ(3),
    "canceledAt" TIMESTAMPTZ(3),
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Manila',
    "graceMinutes" INTEGER NOT NULL,
    "lateAfter" TIMESTAMPTZ(3) NOT NULL,
    "originalPolicySnapshot" JSONB NOT NULL,
    "classSnapshot" JSONB NOT NULL,
    "rosterConfigSnapshot" JSONB NOT NULL,
    "lifecycleRevision" INTEGER NOT NULL DEFAULT 0,
    "snapshotRevision" INTEGER NOT NULL DEFAULT 0,
    "startedById" TEXT NOT NULL,
    "startedByName" TEXT NOT NULL,
    "finalizedById" TEXT,
    "finalizedByName" TEXT,
    "canceledById" TEXT,
    "canceledByName" TEXT,
    "cancellationReason" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassroomSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionRosterMember" (
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "studentSnapshot" JSONB NOT NULL,
    "originSnapshot" JSONB NOT NULL,
    "originalMember" BOOLEAN NOT NULL DEFAULT true,
    "admittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "removedAt" TIMESTAMPTZ(3),
    "removalReason" VARCHAR(1000),
    "membershipRevision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SessionRosterMember_pkey" PRIMARY KEY ("sessionId","studentId")
);

-- CreateTable
CREATE TABLE "ClassroomAttendance" (
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "ClassroomAttendanceStatus" NOT NULL DEFAULT 'UNMARKED',
    "method" "ClassroomAttendanceMethod",
    "markedAt" TIMESTAMPTZ(3),
    "recordedById" TEXT,
    "recordedByName" TEXT,
    "lastModifiedById" TEXT,
    "lastModifiedByName" TEXT,
    "excuseNote" VARCHAR(1000),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassroomAttendance_pkey" PRIMARY KEY ("sessionId","studentId")
);

-- CreateTable
CREATE TABLE "ClassroomAttendanceChange" (
    "id" BIGSERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "reason" VARCHAR(1000),
    "commandId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassroomAttendanceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassroomSession_classId_scheduledStartAt_id_idx" ON "ClassroomSession"("classId", "scheduledStartAt", "id");

-- CreateIndex
CREATE INDEX "ClassroomSession_state_startedAt_idx" ON "ClassroomSession"("state", "startedAt");

-- CreateIndex
CREATE INDEX "SessionRosterMember_studentId_sessionId_idx" ON "SessionRosterMember"("studentId", "sessionId");

-- CreateIndex
CREATE INDEX "SessionRosterMember_sessionId_included_studentId_idx" ON "SessionRosterMember"("sessionId", "included", "studentId");

-- CreateIndex
CREATE INDEX "ClassroomAttendance_sessionId_status_studentId_idx" ON "ClassroomAttendance"("sessionId", "status", "studentId");

-- CreateIndex
CREATE INDEX "ClassroomAttendanceChange_sessionId_id_idx" ON "ClassroomAttendanceChange"("sessionId", "id");

-- CreateIndex
CREATE INDEX "ClassroomAttendanceChange_studentId_sessionId_id_idx" ON "ClassroomAttendanceChange"("studentId", "sessionId", "id");

-- CreateIndex
CREATE INDEX "ClassroomAttendanceChange_actorId_createdAt_id_idx" ON "ClassroomAttendanceChange"("actorId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "ClassroomSession" ADD CONSTRAINT "ClassroomSession_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRosterMember" ADD CONSTRAINT "SessionRosterMember_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClassroomSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRosterMember" ADD CONSTRAINT "SessionRosterMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomAttendance" ADD CONSTRAINT "ClassroomAttendance_sessionId_studentId_fkey" FOREIGN KEY ("sessionId", "studentId") REFERENCES "SessionRosterMember"("sessionId", "studentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomAttendanceChange" ADD CONSTRAINT "ClassroomAttendanceChange_sessionId_studentId_fkey" FOREIGN KEY ("sessionId", "studentId") REFERENCES "SessionRosterMember"("sessionId", "studentId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ClassroomSession_one_active_class" ON "ClassroomSession"("classId") WHERE state='ACTIVE';
ALTER TABLE "ClassroomSession" ADD CONSTRAINT "ClassroomSession_policy" CHECK (
 "timeZone"='Asia/Manila' AND "graceMinutes" BETWEEN 0 AND 180
 AND "lateAfter"="scheduledStartAt"+"graceMinutes"*interval '1 minute'
 AND "lifecycleRevision">=0 AND "snapshotRevision">=0
 AND "originalPolicySnapshot" @> '{"v":1}'::jsonb AND "classSnapshot" @> '{"v":1}'::jsonb
 AND "rosterConfigSnapshot" @> '{"v":1}'::jsonb
 AND COALESCE(("rosterConfigSnapshot"->>'count')::integer BETWEEN 1 AND 1000,false)
);
ALTER TABLE "ClassroomSession" ADD CONSTRAINT "ClassroomSession_state_times" CHECK (
 (state='ACTIVE' AND "finalizedAt" IS NULL AND "canceledAt" IS NULL AND "finalizedById" IS NULL AND "finalizedByName" IS NULL AND "canceledById" IS NULL AND "canceledByName" IS NULL AND "cancellationReason" IS NULL)
 OR (state='FINALIZED' AND "finalizedAt" IS NOT NULL AND "finalizedById" IS NOT NULL AND "finalizedByName" IS NOT NULL AND "canceledAt" IS NULL AND "canceledById" IS NULL AND "canceledByName" IS NULL AND "cancellationReason" IS NULL)
 OR (state='CANCELED' AND "canceledAt" IS NOT NULL AND "canceledById" IS NOT NULL AND "canceledByName" IS NOT NULL AND "cancellationReason" IS NOT NULL AND length(btrim("cancellationReason"))>=3
     AND (("finalizedAt" IS NULL AND "finalizedById" IS NULL AND "finalizedByName" IS NULL) OR ("finalizedAt" IS NOT NULL AND "finalizedById" IS NOT NULL AND "finalizedByName" IS NOT NULL)))
);
ALTER TABLE "SessionRosterMember" ADD CONSTRAINT "SessionRosterMember_snapshot" CHECK (
 "membershipRevision">=0 AND "studentSnapshot" @> '{"v":1}'::jsonb AND "originSnapshot" @> '{"v":1}'::jsonb
 AND COALESCE("studentSnapshot"->>'id'="studentId",false)
 AND ((included AND "removedAt" IS NULL AND "removalReason" IS NULL) OR (NOT included AND "removedAt" IS NOT NULL AND "removalReason" IS NOT NULL AND length(btrim("removalReason"))>=3))
);
ALTER TABLE "ClassroomAttendance" ADD CONSTRAINT "ClassroomAttendance_result" CHECK (
 revision>=0 AND ("excuseNote" IS NULL OR status='EXCUSED')
 AND ((status='UNMARKED' AND revision=0 AND "markedAt" IS NULL AND method IS NULL AND "recordedById" IS NULL AND "recordedByName" IS NULL AND "lastModifiedById" IS NULL AND "lastModifiedByName" IS NULL AND "excuseNote" IS NULL)
 OR (status<>'UNMARKED' AND revision>=1 AND "markedAt" IS NOT NULL AND method IS NOT NULL AND "recordedById" IS NOT NULL AND "recordedByName" IS NOT NULL AND "lastModifiedById" IS NOT NULL AND "lastModifiedByName" IS NOT NULL))
);
ALTER TABLE "ClassroomAttendanceChange" ADD CONSTRAINT "ClassroomAttendanceChange_action" CHECK (action IN ('MARK','CORRECT','FINALIZE_ABSENT'));
CREATE TRIGGER "ClassroomAttendanceChange_immutable" BEFORE UPDATE OR DELETE ON "ClassroomAttendanceChange" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER "ClassroomSession_no_delete" BEFORE DELETE ON "ClassroomSession" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER "SessionRosterMember_no_delete" BEFORE DELETE ON "SessionRosterMember" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER "ClassroomAttendance_no_delete" BEFORE DELETE ON "ClassroomAttendance" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE FUNCTION school_guard_session_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy_changed boolean; lifecycle_changed boolean;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'ACTIVE' OR NEW."lifecycleRevision"<>0 OR NEW."snapshotRevision"<>0
   OR NOT COALESCE((NEW."originalPolicySnapshot"->>'scheduledStartAt')::timestamptz=NEW."scheduledStartAt"
      AND (NEW."originalPolicySnapshot"->>'lateAfter')::timestamptz=NEW."lateAfter"
      AND (NEW."originalPolicySnapshot"->>'graceMinutes')::integer=NEW."graceMinutes"
      AND NEW."originalPolicySnapshot"->>'timeZone'=NEW."timeZone",false) THEN
   RAISE EXCEPTION 'A session starts ACTIVE with its original policy' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW."classId",NEW."startedAt",NEW."originalPolicySnapshot",NEW."classSnapshot",NEW."rosterConfigSnapshot",NEW."startedById",NEW."startedByName",NEW."createdAt")
 IS DISTINCT FROM ROW(OLD.id,OLD."classId",OLD."startedAt",OLD."originalPolicySnapshot",OLD."classSnapshot",OLD."rosterConfigSnapshot",OLD."startedById",OLD."startedByName",OLD."createdAt") THEN
  RAISE EXCEPTION 'Original session snapshots are immutable' USING ERRCODE='23514';
 END IF;
 policy_changed:=ROW(NEW."scheduledStartAt",NEW."timeZone",NEW."graceMinutes",NEW."lateAfter") IS DISTINCT FROM ROW(OLD."scheduledStartAt",OLD."timeZone",OLD."graceMinutes",OLD."lateAfter");
 lifecycle_changed:=policy_changed OR ROW(NEW.state,NEW."finalizedAt",NEW."finalizedById",NEW."finalizedByName",NEW."canceledAt",NEW."canceledById",NEW."canceledByName",NEW."cancellationReason") IS DISTINCT FROM ROW(OLD.state,OLD."finalizedAt",OLD."finalizedById",OLD."finalizedByName",OLD."canceledAt",OLD."canceledById",OLD."canceledByName",OLD."cancellationReason");
 IF NEW.state<>OLD.state AND NOT ((OLD.state='ACTIVE' AND NEW.state IN ('FINALIZED','CANCELED')) OR (OLD.state='FINALIZED' AND NEW.state='CANCELED')) THEN
  RAISE EXCEPTION 'Invalid session lifecycle transition' USING ERRCODE='23514';
 END IF;
 IF (policy_changed AND (OLD.state<>'ACTIVE' OR NEW.state<>'ACTIVE'))
  OR (OLD.state='CANCELED' AND (lifecycle_changed OR NEW."snapshotRevision"<>OLD."snapshotRevision"))
  OR (OLD.state='FINALIZED' AND ROW(NEW."finalizedAt",NEW."finalizedById",NEW."finalizedByName") IS DISTINCT FROM ROW(OLD."finalizedAt",OLD."finalizedById",OLD."finalizedByName"))
  OR NEW."lifecycleRevision"<>OLD."lifecycleRevision"+(CASE WHEN lifecycle_changed THEN 1 ELSE 0 END)
  OR NEW."snapshotRevision" NOT BETWEEN OLD."snapshotRevision" AND OLD."snapshotRevision"+1 THEN
  RAISE EXCEPTION 'Invalid session policy or revision change' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ClassroomSession_snapshot_guard" BEFORE INSERT OR UPDATE ON "ClassroomSession" FOR EACH ROW EXECUTE FUNCTION school_guard_session_snapshot();

CREATE FUNCTION school_guard_member_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed boolean;
BEGIN
 IF ROW(NEW."sessionId",NEW."studentId",NEW."studentSnapshot",NEW."originSnapshot",NEW."originalMember",NEW."admittedAt") IS DISTINCT FROM ROW(OLD."sessionId",OLD."studentId",OLD."studentSnapshot",OLD."originSnapshot",OLD."originalMember",OLD."admittedAt") THEN
  RAISE EXCEPTION 'Original member snapshots are immutable' USING ERRCODE='23514';
 END IF;
 changed:=ROW(NEW.included,NEW."removedAt",NEW."removalReason") IS DISTINCT FROM ROW(OLD.included,OLD."removedAt",OLD."removalReason");
 IF NEW."membershipRevision"<>OLD."membershipRevision"+(CASE WHEN changed THEN 1 ELSE 0 END) THEN
  RAISE EXCEPTION 'Invalid membership revision' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "SessionRosterMember_snapshot_guard" BEFORE UPDATE ON "SessionRosterMember" FOR EACH ROW EXECUTE FUNCTION school_guard_member_snapshot();
CREATE FUNCTION school_guard_classroom_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."sessionId",NEW."studentId",NEW."createdAt") IS DISTINCT FROM ROW(OLD."sessionId",OLD."studentId",OLD."createdAt")
  OR (OLD.status<>'UNMARKED' AND (NEW.status='UNMARKED' OR ROW(NEW."recordedById",NEW."recordedByName") IS DISTINCT FROM ROW(OLD."recordedById",OLD."recordedByName")))
  OR NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION 'Invalid classroom result identity or revision' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ClassroomAttendance_revision_guard" BEFORE UPDATE ON "ClassroomAttendance" FOR EACH ROW EXECUTE FUNCTION school_guard_classroom_result();

-- Deferred checks allow a complete session/roster/result batch in one transaction.
-- The session-wide count runs once per lifecycle/snapshot change, not per result.
CREATE FUNCTION school_check_session_materialization() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_state "ClassroomSessionState"; original_count integer;
BEGIN
 SELECT state,("rosterConfigSnapshot"->>'count')::integer INTO current_state,original_count FROM "ClassroomSession" WHERE id=NEW.id;
 IF (SELECT count(*) FROM "SessionRosterMember" WHERE "sessionId"=NEW.id AND "originalMember")<>original_count
  OR (current_state='FINALIZED' AND EXISTS(SELECT 1 FROM "SessionRosterMember" m JOIN "ClassroomAttendance" a USING("sessionId","studentId") WHERE m."sessionId"=NEW.id AND m.included AND a.status='UNMARKED')) THEN
  RAISE EXCEPTION 'Session roster or finalization is incomplete' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ClassroomSession_materialized" AFTER INSERT OR UPDATE ON "ClassroomSession" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION school_check_session_materialization();
CREATE FUNCTION school_check_member_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE result_status "ClassroomAttendanceStatus"; member_included boolean; member_original boolean; original_count integer; current_state "ClassroomSessionState";
BEGIN
 SELECT a.status,m.included,s.state,m."originalMember",(s."rosterConfigSnapshot"->>'count')::integer INTO result_status,member_included,current_state,member_original,original_count
 FROM "SessionRosterMember" m JOIN "ClassroomSession" s ON s.id=m."sessionId"
 LEFT JOIN "ClassroomAttendance" a USING("sessionId","studentId")
 WHERE m."sessionId"=NEW."sessionId" AND m."studentId"=NEW."studentId";
 IF (TG_TABLE_NAME='SessionRosterMember' AND member_original AND (SELECT count(*) FROM "SessionRosterMember" WHERE "sessionId"=NEW."sessionId" AND "originalMember")<>original_count)
  OR result_status IS NULL OR (current_state='FINALIZED' AND member_included AND result_status='UNMARKED') THEN
  RAISE EXCEPTION 'Every member needs a result; finalized eligible members cannot be unmarked' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "SessionRosterMember_result_required" AFTER INSERT OR UPDATE ON "SessionRosterMember" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION school_check_member_result();
CREATE CONSTRAINT TRIGGER "ClassroomAttendance_final_state" AFTER INSERT OR UPDATE ON "ClassroomAttendance" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION school_check_member_result();

COMMIT;
