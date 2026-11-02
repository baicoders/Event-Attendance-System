# Classroom release and recovery runbook

Status: development branch prepared for review; no production release authorization. This runbook is for operators, never teachers. Do not treat passing local tests as permission to migrate or deploy.

## Preconditions and ownership

Record the actual app/worker topology, PostgreSQL/provider/version, runtime pooler/direct endpoints, secret ownership, school HTTPS origin, backup storage/failure domain, pilot teachers and release operator. Verify transaction-scoped locks work through the deployed pooler and budget all app-instance pools. Confirm school field/privacy/retention policy. Use existing staff knowledge to approve teacher applications once; no routine approval queues follow.

Runtime DATABASE_URL must use a non-superuser, non-owner role without CREATEDB/CREATEROLE/schema CREATE. Maintenance DIRECT_URL is the direct non-pooled privileged migration/backup endpoint. Never expose either to the client. Verify TLS with the provider CA; never disable certificate validation remotely. Test fixtures use explicit loopback TEST_DATABASE_URL and their own databases only.

Grant runtime schema USAGE, required application-table SELECT/INSERT/UPDATE/DELETE and sequence USAGE/SELECT. Revoke UPDATE/DELETE/TRUNCATE on append-only ClassroomAudit, ClassroomCommandReceipt, StudentProfileChange, StudentVerification, ClassroomAttendanceChange, AttendanceChange and StudentImportBatch. Revoke DELETE/TRUNCATE on StudentQrCode. Migration history is SELECT-only; runtime cannot own tables/functions or disable triggers. Profile-capture/staging triggers execute with invoker privileges, so preserve required staging/registry rights and verify actual commands with the restricted role. Restrictive triggers additionally reject audit tampering and code retargeting. Privileged maintenance/DBA credentials can bypass these controls and require separate operational protection.

## Rehearse before scheduling production

1. Run `node --conditions=react-server --import tsx scripts/test-classroom-release.mjs` with an explicit loopback maintenance TEST_DATABASE_URL ending `/postgres`. It creates unique databases/role, copies baseline migrations, injects faults only into private copies, and cleans up its owned databases/role. Private evidence is under `.superpowers/classroom-release/`.
2. Verify empty deployment, baseline-backup upgrade, failed M2 transaction rollback/retry, invalid concurrent-index recovery, QR inventory/interrupted backfill, actual restricted-runtime commands and full current-schema restore. Inspect report and individual logs, not merely process exit.
3. Rehearse hosted staging backups with version-matched pg_dump/pg_restore and isolated restore verification. Verify checksums, table/foreign-key/history/receipt counts, report versions and a separately stored backup copy. Same-host local copies are not a separate failure domain or production durability evidence.
4. Run the full [test matrix](../testing/classroom.md) against a production build. Complete [physical-device and teacher trials](../testing/classroom-release-acceptance.md). Validate static local decoder assets, proxy origins, private caching and monitoring.
5. Audit hosted database session timezone and physical historical Event/Record timestamps against known independent evidence. The PrismaPg UTC fix protects new physical instants; it does not establish whether old rows were shifted. Never blanket-shift historical records by eight hours. Any repair requires its own evidence, backup, reviewed scope and authorization.

## Additive rollout sequence

1. Obtain explicit release authorization with reviewed branch/revision, named rollback artifact and completed gates. Keep CLASSROOM_ENABLED=false. Build and retain immutable app artifacts; do not build on teachers' devices.
2. Take and verify a complete backup before migration; record schema/migration revision, checksum, restore evidence and recovery point. Freeze conflicting maintenance/import jobs during the controlled window.
3. Use the direct maintenance endpoint for `pnpm db:deploy`. M1 adds entitlements and MEMBER without changing existing Events grants. M2 adds permanent identity/history/verification with registry triggers. M3 adds academic configuration; M4 adds session snapshots/attendance constraints. M5a–f each creates one concurrent monitoring index.
4. Inspect `_prisma_migrations` for unresolved failures and `pg_index.indisvalid` for all public indexes. Verify original User Events role/status, Student IDs/USN/LRN/groups, Event/Record/AttendanceChange/import receipts against the backup. Never use seed/reset/db-push as a release substitute.
5. Run `pnpm exec tsx scripts/audit-qr-reservations.ts --report PRIVATE_NEW_PATH` read-only. Review private ownership/provenance/conflict output; never publish codes or student details in tickets/logs. Historical import values without proven ownership remain quarantined. Resolve genuine conflicts through a separately reviewed identity investigation, never automatic retargeting.
6. If the reviewed inventory requires backfill, take a fresh verified backup and run `pnpm exec tsx scripts/backfill-qr-reservations.ts --apply --expected-hash REVIEWED_HASH --backup-confirmed`. It rechecks under the roster lock. A changed fingerprint requires a new review. A failed transaction is retried from fresh inventory, never an assumed partial success. Reservations are permanent and must not be purged to reuse a code.
7. Deploy compatible application artifact with Class disabled. Smoke-test Events login/calendar/scan/manual/correction/report/CSV/print, teacher-only Events denials, admin queues and Class closed-access copy. Verify actual restricted runtime grants.
8. For a pilot, set CLASSROOM_ENABLED=true and restrict CLASSROOM_PILOT_USER_IDS to approved pilot IDs. A false enable flag denies everyone; an empty pilot list with enable=true grants all otherwise-authorized Class users. Verify `features/classroom/server/featureFlags.ts` before changing these settings. General enable clears the pilot allowlist while keeping CLASSROOM_ENABLED=true. Keep monitoring/rollback operator available. No teacher receives a further class/roster/attendance approval requirement.
9. Verify A–H, receipt recovery, cross-workspace suspension, onboard→first meeting, finalization and matching exports. Expand only after pilot evidence and operator signoff.

## Failed concurrent index recovery

Each M5 file intentionally runs one CREATE INDEX CONCURRENTLY outside a transaction. Failure can leave the named index invalid and a failed Prisma migration record. Stop promotion; inspect the failing migration SQL and index definition/validity. In a reviewed maintenance window, drop only that invalid artifact with DROP INDEX CONCURRENTLY, then `prisma migrate resolve --rolled-back EXACT_MIGRATION` and rerun deploy using the original immutable SQL. Never blindly mark it applied, modify production migration checksums, or rely on IF NOT EXISTS to accept an invalid index. Transactional M2 failure instead rolls back its schema/data changes; inspect before resolving/retrying.

Verification queries (read-only):

```sql
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL;
SELECT c.relname, i.indisvalid, i.indisready
FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT i.indisvalid;
SELECT state, count(*) FROM "StudentQrCode" GROUP BY state;
SELECT current_user, current_setting('TimeZone');
```

## Disable and compatible application rollback

Disable general enable and clear pilot IDs together; flag changes require app environment reload according to host topology. Protected Class business routes deny new operations and receipt replays; admin application/monitoring remains available for investigation. Pending browser saves remain unconfirmed until explicitly reconciled after service recovery. Do not promise an immediate flag change aborts an already committing transaction.

Keep additive schema, registry, snapshots, audit and receipts. Do not down-migrate or delete Class data to roll back an app. Original main 3135 is **not** an approved rollback target: it lacks MEMBER guards, permanent registry writer protocol and the UTC adapter fix. Use a tested artifact containing those foundations; T9 cd54135 is the candidate before index-only/report changes. Verify its exact dependencies/build/runtime against the latest schema and restored data before accepting it. If compatibility fails, fix forward or keep current code with Class disabled.

Restore is a separate incident procedure: stop writes, preserve the incident database/logs, restore a verified archive into a separate database, validate integrity and Events/Class reports, obtain incident/release authorization, then switch the application endpoint. A backup restore loses post-backup writes and is not a routine application rollback. Reconcile affected attendance before reopening.

## Monitor and stop conditions

Monitor sanitized status/error codes, request correlation, latency, pool/lock timeouts, invalid indexes, backup availability, unknown/quarantined scan counts and persistent receipt failures. Do not log QR text, notes or student payloads. Investigate through admin timelines and immutable history; repeated-correction prompts are review aids, not automatic suspension. Disable Class for authorization leakage, identity misresolution, inconsistent snapshots/finalization or unexplained saved-data loss. Preserve Events independently whenever safe.

The T9 rollback candidate predates Classroom report/monitoring screens. Even if its schema/Events smoke passes, emergency rollback temporarily removes those interfaces; the immutable database evidence remains available to maintenance operators. Prefer a later compatible, fully inspected artifact for the actual release if it preserves more recovery functionality. Candidate smoke evidence never authorizes production use by itself.
