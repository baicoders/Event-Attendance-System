# Attendance correction release notes

Issue #48 adds an `AttendanceChange` journal, revisioned current `Record`, and an owner/admin review screen at `/attendance/corrections?eventId=…`. The journal preserves server-authored before/after images, attribution and a reason after a void deletes the current record. Its BigInt IDs are decimal strings in every API. Existing records start at revision zero, with no invented earlier history.

## Deploy after the PostgreSQL baseline

1. Confirm issue #51's PostgreSQL baseline, runtime pool, direct migration URL, backup and restore rehearsal are in place. Stop all old application writers before the schema and code transition; old builds do not append history.
2. Back up PostgreSQL and test the backup on a separate target. Apply `pnpm exec prisma migrate deploy` with the reviewed `DATABASE_URL` and `DIRECT_URL`. The additive migration follows `20260926075853_init_postgres_baseline` and preserves existing IDs, actor links and nullable timestamps.
3. Start the new application build and reload scanner/manager tabs. The old bodyless `DELETE /api/records/[recordId]` now returns `400 CORRECTION_REQUIRED` so it cannot erase attendance without a reason.
4. Rehearse login, time-in, timeout-only capture, correction, void, history and restore on a disposable PostgreSQL database before accepting live writes. Check the same event/student across two independent clients.

The journal has restrictive event/student foreign keys. A history-only pair still blocks deletion of its parents. Development seed deletes journal entries first and must never run on an event database.

## Operations and recovery

- Owners and admins can review current, voided and out-of-current-audience evidence. Other active organizers retain ordinary approved-event recording rights but cannot read manager reasons.
- Correction and restoration require an approved event. A corrected record retains at least one time; timeout-only evidence is valid. Void retains the former deletion ability on any event status. Restore requires the latest pair-owned void, no active record, and current student eligibility.
- The editor shows Asia/Manila time; the API requires offset-bearing timestamps. Out-of-schedule times prompt review but are not forbidden. A stale editor keeps its proposed values. After a lost response, **Retry exact command** reuses the immutable command ID and payload; a replay receipt describes the original commit, not necessarily current evidence.
- Reports, downloads and print tabs are snapshots. Regenerate them after a correction. Prisma Studio or old application code must not edit `Record` during operation because that bypasses revision and history.

Once this build accepts an audited write, a rollback to old code or an older backup can lose/bypass accepted evidence. Stop writers and reconcile before any restore. Direct database edits are outside the application audit trail; the journal is not cryptographic tamper proofing.

## Disposable verification

`node scripts/test-attendance-migration.mjs` applies the committed baseline and change SQL to a populated disposable PostgreSQL database, preserving a timeout-only record at revision zero and testing foreign-key retention after void. The Node fixtures provision separate PostgreSQL databases through real `migrate deploy` and the production adapter. `node scripts/test-attendance-corrections.mjs` exercises authenticated API paths against a production build. `node scripts/test-attendance-visual.mjs` checks 375px and 1440px review views and opens the mobile editor, writing screenshots under `/tmp/issue48-*.png`.

The September 26 disposable PostgreSQL verification passed populated migration SQL, fresh `migrate deploy`, migration-to-schema diff, authenticated API, mobile/desktop browser checks, and the 123-test repository Node suite. Typecheck, changed-file lint and the production build passed. Repository-wide `pnpm lint` still reports 12 errors in untouched student and shared UI files; those are separate from this change. Re-run these checks before deployment. Measure scanner, same-pair, different-pair, mode and roster contention on deployment-like infrastructure; local figures are diagnostic, not a production capacity guarantee.

The disposable local PostgreSQL probe on September 26, 2026 used 2,000 students and five independent clients. Ten serial scans succeeded (roughly 53–101 ms each); five different-pair scans succeeded at p50 118.7 ms and p95 136.5 ms; five same-pair requests succeeded at p50 72.1 ms and p95 88.1 ms, with one material write and four no-ops. A scan held behind a 100 ms roster-exclusive lock completed in 137.1 ms. This small same-host sample does not establish a production capacity limit.
