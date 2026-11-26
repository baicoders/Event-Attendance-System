BEGIN;

-- CreateEnum
CREATE TYPE "StudentQrState" AS ENUM ('RESOLVABLE', 'RETIRED', 'QUARANTINED');

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "profileRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StudentQrCode" (
    "code" VARCHAR(128) NOT NULL,
    "reservedOwnerId" TEXT,
    "studentId" TEXT,
    "state" "StudentQrState" NOT NULL DEFAULT 'RESOLVABLE',
    "originalKind" TEXT NOT NULL,
    "candidateEvidence" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMPTZ(3),

    CONSTRAINT "StudentQrCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "StudentProfileChange" (
    "id" BIGSERIAL NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromRevision" INTEGER,
    "toRevision" INTEGER NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "commandId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentProfileChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentVerification" (
    "id" BIGSERIAL NOT NULL,
    "studentId" TEXT NOT NULL,
    "profileRevision" INTEGER NOT NULL,
    "verifiedContentHash" VARCHAR(64) NOT NULL,
    "state" TEXT NOT NULL,
    "note" TEXT,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "commandId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentProfilePending" (
    "transactionId" BIGINT NOT NULL,
    "studentId" TEXT NOT NULL,
    "before" JSONB,
    "metadata" JSONB NOT NULL,
    "flushed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StudentProfilePending_pkey" PRIMARY KEY ("transactionId","studentId")
);

-- CreateIndex
CREATE INDEX "StudentQrCode_studentId_state_idx" ON "StudentQrCode"("studentId", "state");

-- CreateIndex
CREATE INDEX "StudentProfileChange_studentId_id_idx" ON "StudentProfileChange"("studentId", "id");

-- CreateIndex
CREATE INDEX "StudentProfileChange_actorId_createdAt_id_idx" ON "StudentProfileChange"("actorId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StudentProfileChange_studentId_toRevision_key" ON "StudentProfileChange"("studentId", "toRevision");

-- CreateIndex
CREATE INDEX "StudentVerification_studentId_profileRevision_id_idx" ON "StudentVerification"("studentId", "profileRevision", "id");

-- AddForeignKey
ALTER TABLE "StudentQrCode" ADD CONSTRAINT "StudentQrCode_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfileChange" ADD CONSTRAINT "StudentProfileChange_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentVerification" ADD CONSTRAINT "StudentVerification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve exact text values. Cross-person namespace collisions fail closed.
WITH current_codes AS (
 SELECT id AS code,id AS owner,'INTERNAL_ID' AS kind FROM "Student"
 UNION ALL SELECT usn,id,'USN' FROM "Student" WHERE usn IS NOT NULL
 UNION ALL SELECT lrn,id,'LRN' FROM "Student" WHERE lrn IS NOT NULL
), receipt_rows AS (
 SELECT row FROM "StudentImportBatch" batch CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(batch.result->'rows')='array' THEN batch.result->'rows' ELSE '[]'::jsonb END) AS row
), historical_codes AS (
 SELECT claim.code,row->>'studentId' AS owner,'HISTORICAL_IMPORT' AS kind FROM receipt_rows
 CROSS JOIN LATERAL (VALUES(row->'student'->>'id'),(row->'student'->>'usn'),(row->'student'->>'lrn')) AS claim(code)
 WHERE row->>'status'='CREATE'
 UNION ALL
 SELECT claim.code,row->>'studentId','HISTORICAL_IMPORT' FROM receipt_rows
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(row->'changes')='array' THEN row->'changes' ELSE '[]'::jsonb END) AS change
 CROSS JOIN LATERAL (VALUES(change->>'before'),(change->>'after')) AS claim(code)
 WHERE change->>'field' IN ('usn','lrn')
), codes AS (
 SELECT *,true AS is_current FROM current_codes
 UNION ALL SELECT *,false FROM historical_codes WHERE code IS NOT NULL AND code<>'' AND owner IS NOT NULL
), claims AS (
 SELECT code,count(DISTINCT owner) AS owners,min(owner) AS owner,min(kind) AS kind,bool_or(is_current) AS is_current,
 jsonb_agg(DISTINCT owner) AS evidence FROM codes GROUP BY code
)
INSERT INTO "StudentQrCode" (code,"reservedOwnerId","studentId",state,"originalKind","candidateEvidence")
SELECT code,CASE WHEN owners=1 AND is_current THEN owner END,CASE WHEN owners=1 AND is_current THEN owner END,
 CASE WHEN owners=1 AND is_current THEN 'RESOLVABLE'::"StudentQrState" ELSE 'QUARANTINED'::"StudentQrState" END,
 kind,CASE WHEN owners>1 OR NOT is_current THEN evidence END FROM claims;

ALTER TABLE "StudentQrCode" ADD CONSTRAINT "StudentQrCode_resolvable_owner" CHECK (
 state<>'RESOLVABLE' OR ("studentId" IS NOT NULL AND "reservedOwnerId" IS NOT NULL AND "studentId"="reservedOwnerId")
);
ALTER TABLE "StudentVerification" ADD CONSTRAINT "StudentVerification_state" CHECK (state IN ('VERIFIED','NEEDS_CORRECTION'));
ALTER TABLE "StudentProfileChange" ADD CONSTRAINT "StudentProfileChange_revision" CHECK (
 ("fromRevision" IS NULL AND "toRevision"=0) OR ("fromRevision" IS NOT NULL AND "toRevision"="fromRevision"+1)
);

CREATE FUNCTION school_immutable_student_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Student history is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "StudentProfileChange_immutable" BEFORE UPDATE OR DELETE ON "StudentProfileChange"
 FOR EACH ROW EXECUTE FUNCTION school_immutable_student_history();
CREATE TRIGGER "StudentVerification_immutable" BEFORE UPDATE OR DELETE ON "StudentVerification"
 FOR EACH ROW EXECUTE FUNCTION school_immutable_student_history();

CREATE FUNCTION school_guard_qr_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'QR reservations cannot be deleted' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.code,NEW."reservedOwnerId",NEW."originalKind",NEW."candidateEvidence",NEW."createdAt") IS DISTINCT FROM
    ROW(OLD.code,OLD."reservedOwnerId",OLD."originalKind",OLD."candidateEvidence",OLD."createdAt")
 OR (OLD.state IN ('RETIRED','QUARANTINED') AND NEW.state<>OLD.state)
 OR (NEW."studentId" IS DISTINCT FROM OLD."studentId" AND NOT
     (NEW."studentId" IS NULL AND NEW.state<>'RESOLVABLE' AND NOT EXISTS(SELECT 1 FROM "Student" WHERE id=OLD."studentId"))) THEN
   RAISE EXCEPTION 'QR reservation ownership and blocked states are permanent' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "StudentQrCode_guard" BEFORE UPDATE OR DELETE ON "StudentQrCode"
 FOR EACH ROW EXECUTE FUNCTION school_guard_qr_reservation();

CREATE FUNCTION school_reserve_student_codes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE claim record; reservation "StudentQrCode"%ROWTYPE; grandfathered boolean;
BEGIN
 IF TG_OP='UPDATE' AND NEW.id<>OLD.id THEN RAISE EXCEPTION 'Student IDs are immutable' USING ERRCODE='23514'; END IF;
 FOR claim IN SELECT code,min(kind) AS kind,bool_or(external) AS external FROM
   (VALUES(NEW.id,'INTERNAL_ID',false),(NEW.usn,'USN',true),(NEW.lrn,'LRN',true)) AS c(code,kind,external)
   WHERE code IS NOT NULL GROUP BY code ORDER BY code LOOP
   IF length(claim.code)=0 OR length(claim.code)>128 THEN RAISE EXCEPTION 'Invalid student QR identifier' USING ERRCODE='23514'; END IF;
   INSERT INTO "StudentQrCode" (code,"reservedOwnerId","studentId",state,"originalKind")
     VALUES(claim.code,NEW.id,NEW.id,'RESOLVABLE',claim.kind) ON CONFLICT(code) DO NOTHING;
   SELECT * INTO reservation FROM "StudentQrCode" WHERE code=claim.code FOR UPDATE;
   grandfathered:=false;
   IF TG_OP='UPDATE' THEN
    IF claim.external THEN grandfathered:=claim.code IN (COALESCE(OLD.usn,''),COALESCE(OLD.lrn,''));
    ELSE grandfathered:=claim.code=OLD.id; END IF;
   END IF;
   IF reservation.state='QUARANTINED' AND grandfathered THEN CONTINUE; END IF;
   IF reservation."reservedOwnerId" IS DISTINCT FROM NEW.id OR reservation."studentId" IS DISTINCT FROM NEW.id
     OR (reservation.state<>'RESOLVABLE' AND (claim.external OR NOT grandfathered)) THEN
     RAISE EXCEPTION 'Student QR value is permanently reserved or blocked' USING ERRCODE='23514';
   END IF;
 END LOOP;
 IF TG_OP='UPDATE' AND COALESCE(NULLIF(current_setting('school.student_write',true),'')::jsonb->>'identifierDisposition','')<>'KEEP_ALIAS_CONFIRMED' THEN
  UPDATE "StudentQrCode" SET state='RETIRED',"retiredAt"=clock_timestamp()
  WHERE "reservedOwnerId"=NEW.id AND state='RESOLVABLE' AND code IN (OLD.usn,OLD.lrn)
   AND code IS DISTINCT FROM NEW.usn AND code IS DISTINCT FROM NEW.lrn;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Student_reserve_codes" AFTER INSERT OR UPDATE OF id,usn,lrn ON "Student"
 FOR EACH ROW EXECUTE FUNCTION school_reserve_student_codes();

CREATE FUNCTION school_check_student_codes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person "Student"%ROWTYPE; claim record; reservation "StudentQrCode"%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='Student' THEN SELECT * INTO person FROM "Student" WHERE id=NEW.id;
 ELSE SELECT * INTO person FROM "Student" WHERE id=NEW."studentId"; END IF;
 IF NOT FOUND THEN RETURN NULL; END IF;
 FOR claim IN SELECT code,bool_or(external) AS external FROM
  (VALUES(person.id,false),(person.usn,true),(person.lrn,true)) AS c(code,external)
  WHERE code IS NOT NULL GROUP BY code LOOP
  SELECT * INTO reservation FROM "StudentQrCode" WHERE code=claim.code;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student QR reservation is missing' USING ERRCODE='23514'; END IF;
  -- Existing migration collisions remain blocked, never guessed at.
  IF reservation.state='QUARANTINED' AND reservation."candidateEvidence" ? person.id THEN CONTINUE; END IF;
  IF reservation."reservedOwnerId" IS DISTINCT FROM person.id OR reservation."studentId" IS DISTINCT FROM person.id
    OR (claim.external AND reservation.state<>'RESOLVABLE') THEN
    RAISE EXCEPTION 'Student identifiers disagree with permanent QR reservations' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Student_codes_consistent" AFTER INSERT OR UPDATE ON "Student"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION school_check_student_codes();
CREATE CONSTRAINT TRIGGER "StudentQrCode_consistent" AFTER INSERT OR UPDATE ON "StudentQrCode"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION school_check_student_codes();
CREATE FUNCTION school_retire_deleted_student_codes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "StudentQrCode" SET state='RETIRED',"retiredAt"=clock_timestamp()
 WHERE "studentId"=OLD.id AND state='RESOLVABLE';
 RETURN OLD;
END $$;
CREATE TRIGGER "Student_retire_codes" BEFORE DELETE ON "Student"
 FOR EACH ROW EXECUTE FUNCTION school_retire_deleted_student_codes();

-- Capture one pre-transaction profile across scalar/raw-SQL/implicit join writes.
-- Application services set school.student_write with actor, source, reason and command.
CREATE FUNCTION school_student_snapshot(student_id text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT to_jsonb(s) || jsonb_build_object('groups',COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id',g.id,'slug',g.slug,'name',g.name,'category',g.category) ORDER BY g.id)
  FROM "_GroupToStudent" m JOIN "Group" g ON g.id=m."A" WHERE m."B"=s.id
 ),'[]'::jsonb)) FROM "Student" s WHERE s.id=student_id
$$;
CREATE FUNCTION school_relevant_profile(profile jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN profile IS NULL THEN NULL ELSE jsonb_build_object(
 'id',profile->'id','usn',profile->'usn','lrn',profile->'lrn','firstName',profile->'firstName',
 'lastName',profile->'lastName','middleName',profile->'middleName','schoolLevel',profile->'schoolLevel',
 'yearLevel',profile->'yearLevel','archivedAt',profile->'archivedAt','groups',COALESCE((
 SELECT jsonb_agg(g-'name' ORDER BY g->>'id') FROM jsonb_array_elements(profile->'groups') AS g
 WHERE g->>'category' NOT IN ('HOUSE','CUSTOM')),'[]'::jsonb)) END
$$;
CREATE FUNCTION school_queue_profile(student_id text,original jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE pending "StudentProfilePending"%ROWTYPE;
BEGIN
 SELECT * INTO pending FROM "StudentProfilePending" WHERE "transactionId"=txid_current() AND "studentId"=student_id;
 IF FOUND THEN
  IF pending.flushed THEN RAISE EXCEPTION 'Profile changed after audit was finalized' USING ERRCODE='23514'; END IF;
  RETURN;
 END IF;
 INSERT INTO "StudentProfilePending" ("transactionId","studentId","before",metadata)
 VALUES(txid_current(),student_id,original,COALESCE(NULLIF(current_setting('school.student_write',true),'')::jsonb,'{}'::jsonb));
END $$;
CREATE FUNCTION school_capture_student_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN PERFORM school_queue_profile(NEW.id,NULL);
 ELSIF ROW(NEW."firstName",NEW."lastName",NEW."middleName",NEW.usn,NEW.lrn,NEW."schoolLevel",NEW."yearLevel",NEW."archivedAt") IS DISTINCT FROM
       ROW(OLD."firstName",OLD."lastName",OLD."middleName",OLD.usn,OLD.lrn,OLD."schoolLevel",OLD."yearLevel",OLD."archivedAt") THEN
   PERFORM school_queue_profile(OLD.id,school_student_snapshot(OLD.id));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Student_capture_profile" BEFORE INSERT OR UPDATE ON "Student"
 FOR EACH ROW EXECUTE FUNCTION school_capture_student_profile();
CREATE FUNCTION school_capture_membership_profile() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid text; gid text; category text;
BEGIN
 IF TG_OP='DELETE' THEN sid:=OLD."B";gid:=OLD."A"; ELSE sid:=NEW."B";gid:=NEW."A"; END IF;
 SELECT g.category::text INTO category FROM "Group" g WHERE g.id=gid;
 IF category IS NULL OR category NOT IN ('HOUSE','CUSTOM') THEN
  PERFORM school_queue_profile(sid,school_student_snapshot(sid));
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER "Student_membership_profile" BEFORE INSERT OR DELETE ON "_GroupToStudent"
 FOR EACH ROW EXECUTE FUNCTION school_capture_membership_profile();
CREATE FUNCTION school_capture_group_profiles() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person record;
BEGIN
 IF TG_OP='DELETE' OR ROW(NEW.slug,NEW.category) IS DISTINCT FROM ROW(OLD.slug,OLD.category) THEN
  IF OLD.category::text NOT IN ('HOUSE','CUSTOM') OR (TG_OP='UPDATE' AND NEW.category::text NOT IN ('HOUSE','CUSTOM')) THEN
   FOR person IN SELECT "B" AS id FROM "_GroupToStudent" WHERE "A"=OLD.id ORDER BY "B" LOOP
    PERFORM school_queue_profile(person.id,school_student_snapshot(person.id));
   END LOOP;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER "Group_capture_profiles" BEFORE UPDATE OR DELETE ON "Group"
 FOR EACH ROW EXECUTE FUNCTION school_capture_group_profiles();

CREATE FUNCTION school_flush_student_profiles() RETURNS void LANGUAGE plpgsql AS $$
DECLARE pending record; final_profile jsonb; revision integer;
BEGIN
 FOR pending IN SELECT * FROM "StudentProfilePending" WHERE "transactionId"=txid_current() AND NOT flushed ORDER BY "studentId" LOOP
  final_profile:=school_student_snapshot(pending."studentId");
  IF final_profile IS NOT NULL AND school_relevant_profile(final_profile) IS DISTINCT FROM school_relevant_profile(pending."before") THEN
   IF pending."before" IS NULL THEN revision:=0;
   ELSE revision:=(pending."before"->>'profileRevision')::integer+1; END IF;
   PERFORM set_config('school.profile_flush','active',true);
   UPDATE "Student" SET "profileRevision"=revision WHERE id=pending."studentId" AND "profileRevision"<>revision;
   PERFORM set_config('school.profile_flush','inactive',true);
   final_profile:=jsonb_set(final_profile,'{profileRevision}',to_jsonb(revision));
   IF pending."before" IS NOT NULL AND EXISTS(
    SELECT 1 FROM (VALUES(pending."before"->>'usn'),(pending."before"->>'lrn')) AS old_code(code)
    WHERE code IS NOT NULL AND code IS DISTINCT FROM final_profile->>'usn' AND code IS DISTINCT FROM final_profile->>'lrn'
   ) THEN
    final_profile:=final_profile || jsonb_build_object('_qrDisposition',CASE WHEN pending.metadata->>'identifierDisposition'='KEEP_ALIAS_CONFIRMED' THEN 'KEEP_ALIAS_CONFIRMED' ELSE 'REPRINT_REQUIRED' END);
   END IF;
   INSERT INTO "StudentProfileChange" ("studentId","fromRevision","toRevision","before","after","actorId","actorName",source,reason,"commandId")
   VALUES(pending."studentId",CASE WHEN pending."before" IS NULL THEN NULL ELSE revision-1 END,revision,pending."before",final_profile,
    pending.metadata->>'actorId',COALESCE(pending.metadata->>'actorName','Unattributed database writer'),COALESCE(pending.metadata->>'source','SYSTEM'),
    pending.metadata->>'reason',NULLIF(pending.metadata->>'commandId','')::uuid);
  END IF;
  UPDATE "StudentProfilePending" SET flushed=true WHERE "transactionId"=txid_current() AND "studentId"=pending."studentId";
 END LOOP;
END $$;
CREATE FUNCTION school_finish_student_profiles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM school_flush_student_profiles();
 DELETE FROM "StudentProfilePending" WHERE "transactionId"=txid_current();
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "StudentProfilePending_finish" AFTER INSERT ON "StudentProfilePending"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION school_finish_student_profiles();

INSERT INTO "StudentProfileChange" ("studentId","fromRevision","toRevision","after","actorName",source,reason)
 SELECT id,NULL,0,school_student_snapshot(id),'Migration baseline','BASELINE',
 'Current record at identity-history activation; no earlier edits or verification inferred.' FROM "Student";

CREATE FUNCTION school_guard_student_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."profileRevision"<0 OR (NEW."profileRevision"<>OLD."profileRevision" AND COALESCE(current_setting('school.profile_flush',true),'')<>'active') THEN
  RAISE EXCEPTION 'Profile revisions are maintained by immutable history capture' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Student_guard_revision" BEFORE UPDATE OF "profileRevision" ON "Student"
 FOR EACH ROW EXECUTE FUNCTION school_guard_student_revision();

CREATE INDEX "Student_archivedAt_id_idx" ON "Student"("archivedAt",id);

COMMIT;
