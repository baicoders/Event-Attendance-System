-- Intentionally one nontransactional statement: PostgreSQL concurrent index
-- creation keeps normal attendance/profile writes available. On failure inspect
-- pg_index validity before an explicitly authorized migration retry.
CREATE INDEX CONCURRENTLY "StudentProfileChange_createdAt_id_idx" ON "StudentProfileChange"("createdAt",id);
