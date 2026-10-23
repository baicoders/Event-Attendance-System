-- Preserve historical receipts while allowing the new reviewed-upsert contract.
-- Retain every existing structural, count and UTF-8 byte limit check.
ALTER TABLE "StudentImportBatch" DROP CONSTRAINT "StudentImportBatch_result_check",
ADD CONSTRAINT "StudentImportBatch_result_check" CHECK (
  "contractVersion" IN (1, 2) AND jsonb_typeof("result") = 'object'
  AND "result" ? 'v' AND "result" ? 'rows'
  AND "result"->>'v' = "contractVersion"::text
  AND jsonb_typeof("result"->'rows') = 'array'
  AND jsonb_array_length("result"->'rows') = "totalRows"
  AND octet_length("result"::text) <= 10485760
);
