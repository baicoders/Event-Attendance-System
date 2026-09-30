-- Additive only: existing imports have no fabricated receipt/backfill.
CREATE TABLE "StudentImportBatch" (
    "id" TEXT NOT NULL,
    "commandId" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorNameSnapshot" TEXT NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "sourceFileHash" VARCHAR(64) NOT NULL,
    "normalizedInputHash" VARCHAR(64) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "createdCount" INTEGER NOT NULL,
    "updatedCount" INTEGER NOT NULL,
    "unchangedCount" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "contractVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "StudentImportBatch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StudentImportBatch_counts_check" CHECK (
      "totalRows" > 0 AND "createdCount" >= 0 AND "updatedCount" >= 0 AND "unchangedCount" >= 0
      AND "totalRows" = "createdCount" + "updatedCount" + "unchangedCount"
    ),
    CONSTRAINT "StudentImportBatch_hashes_check" CHECK (
      "sourceFileHash" ~ '^[a-f0-9]{64}$' AND "normalizedInputHash" ~ '^[a-f0-9]{64}$'
      AND "requestHash" ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT "StudentImportBatch_result_check" CHECK (
      "contractVersion" = 1 AND jsonb_typeof("result") = 'object'
      AND "result" ? 'v' AND "result" ? 'rows'
      AND "result"->>'v' = '1' AND jsonb_typeof("result"->'rows') = 'array'
      AND jsonb_array_length("result"->'rows') = "totalRows"
      AND octet_length("result"::text) <= 10485760
    )
);
CREATE UNIQUE INDEX "StudentImportBatch_actorId_commandId_key" ON "StudentImportBatch"("actorId", "commandId");
CREATE INDEX "StudentImportBatch_committedAt_id_idx" ON "StudentImportBatch"("committedAt", "id");
