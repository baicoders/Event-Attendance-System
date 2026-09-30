# Student masterlist import implementation plan

Authoritative approved specifications: GitHub #99 and #100 and the user's execution brief. Execute autonomously in dependency order, one branch/PR per issue. Main agent owns integration and transaction decisions; bounded agents audit or implement independent units.

## Reconciliation and design

Live main is 07d4ceb, matching the issue audit baseline. PostgreSQL/Prisma 7 adapter, shared/exclusive roster advisory locks, fresh auth, existing content-version projection and Group management remain authoritative. No lifecycle schema exists. No schema migration for #99.

Use a strict v1 request `{v, fileName, sourceHash, csv}` rather than browser-classified rows. Sending canonical UTF-8 CSV lets both boundaries repeat structural validation and preserves physical row numbers and actual source hashing. Commit adds `previewToken`; #100 adds `commandId`. File and complete HTTP request each have a 10 MiB technical bound (JSON escaping/envelope count toward the HTTP bound); no row cap. Hashing/parsing happen before write locks.

## #99 tasks

1. Parser and pure classifier (`features/students/import/contract.ts`, `csv.ts`, `classify.ts`, tests): write failing fixtures, run them, implement, re-run. Exact eleven headers, BOM/CRLF, quoted multiline values, malformed quotes/header errors, empty input, duplicate IDs, all domain fixtures. Normalize names/id per shared schema, optional blanks, lowercase/trim Group slugs; do not repair enums or IDs. Classify complete raw memberships and expose exact field diffs/unknown category+slug counts.
2. Server service (`server.ts`, `token.ts`, `http.ts`) and preview/commit routes: failing PostgreSQL API fixture first. Fresh usable ADMIN, bounded streaming request, RepeatableRead preview with bounded set reads. Compact signed digest binds actor/source/input/ordered rows/current Student versions/Group identity and names/times. Commit takes roster lock then fresh reads, compares review fingerprint, rejects stale with zero writes, creates/updates only, skips no-ops, atomic transaction. Legacy route explicitly rejects unreviewed writes.
3. Focused UI components: source, review table/summary/filter/search/pagination, blocked Groups, result. Reuse GroupFormSheet with create defaults/locked category/onCreated; Settings unaffected, groups anchor. useConfirm names file/actor/counts/partial-file semantics. Honest unknown outcome, no mutation retries; protect against late source/account responses. Invalidate students/audience/events/progress/records/reports after known success.
4. Verification: disposable PG fixtures with independent clients and rollback triggers, protected roster/attendance concurrency, 2000 and 5005 measurements, real browser desktop+375px keyboard source/replacement/parser/review/groups/stale/confirmation/result/unknown/overflow. Run import, bulk, attendance/operator regressions, tsc, changed-file ESLint, repo lint baseline, build. Adapt HTTP benchmark and current docs; no production data.
5. Re-read #99, independent whole-branch review, fix findings and repeat affected/full gates. Conventional commits. Open focused review-ready PR, Closes #99. Merge only if normal required checks/review gates and policy permit; otherwise stack #100.

## #100 tasks (after #99 review-ready)

1. Add StudentImportBatch model/migration: actor+UUID unique, attribution/filename/hash/count metadata, versioned validated JSONB, timestamptz, committedAt+id history index. Fresh and #99 upgrade tests preserve rows; no backfill.
2. Extend same commit service with actor+command transaction advisory lock BEFORE roster lock, receipt lookup, requestHash exact collision handling. Validate signature and actor before replay; allow expiry on existing exact receipt only, enforce expiry for first execution. Roster writes and compact receipt insert share one transaction. Replay returns original receipt without roster reads or writes.
3. ADMIN-only bounded cursor history, detail, actor-scoped command check. History does not select JSONB. Client freezes exact request+UUID on confirmation, explicit check/retry after unknown, protects logout/account switch. Receipt historical filters/search and current-state wording; independently created Groups stay independent.
4. PostgreSQL first/replay/concurrent duplicate/collision/cross-user/later-state/rollback/response loss tests; migration and dump/restore receipts. Final 2000/5005 receipt size/memory/latency measurements and browser history/retry/privacy/mobile. Repeat #99 and regressions/typecheck/lint/build.
5. Independent review and final combined contract audit; focused PR Closes #100 with dependency/base if stacked, exact verification and measurements. Complete goal only when both PRs and all evidence satisfy the specs.

## Review focus

Review digest must include absent-to-present student creation, complete current membership identities, and Group display renames. All-unchanged imports are valid. Unknown result never enables implicit retry or editable frozen commands. Missing command receipt cannot prove no in-flight execution. Old expired review exact replay must preserve later roster edits. Byte boundaries apply before unbounded parsing and are checked client and server. Ordinary student rows remain read-only; no absent student updates. Receipt result creation/insertion failure must roll back students.

## Evidence ledger

- Phase 0: clean main fetched; #99/#100 bodies and comments read; main equals audit baseline. Main branch protection API reports no branch protection; this alone does not establish merge review completion. User authorizes branch/PR creation and conditional merge.

- #99: authoritative parser/classifier/token/body/hash fixtures and all Node tests passed (146/146). Disposable PG API/stale/rollback/actor/Group/roster/attendance checks passed. 2,000 and 5,005 row preview/commit measurements are recorded in docs/student-import.md; attendance waits preserve rollback and explicit retry semantics.
- #99 independent review found a late Group creation callback crossing file generations. The browser reproduced the failure; callbacks now bind the source and generation, and expanded desktop/375px browser regressions pass.
- #99 final production build, TypeScript, changed-file ESLint and diff checks pass. Existing bulk API/large/export/browser and operator API fixtures pass. Repository lint has seven untouched errors/twelve warnings versus twelve errors/twelve warnings on clean main. No schema or production DB changes.

- #99 PR101 merged at e597403 after independent review/fix, PostgreSQL/browser/build gates and live merge policy/check audit (no required rules/checks). #100 branched from synced main.
- #100 RED: old build accepted missing command UUID; new actor-scoped lock helper was absent. Added receipt model/migration and extended the original commit service with guard -> command lock -> lookup -> fresh first-execution roster revalidation -> changes plus validated receipt in one transaction. Exact replay bypasses roster work.
- #100 pure contracts/builder and frozen-command/history/detail UI implemented. First TypeScript and all Node tests pass (160/160); full production PostgreSQL/browser gates remain in progress.

- #100 independent read-only review found no product correctness/security blocker; its minor omitted-UUID byte measurement was corrected to the actual dispatched body.
- #100 final production PG suite passes18checks including supported manual-edit later-state replay, expired exact replay with zero Student/Group operations, receipt persistence/runtime-validation rollback, held duplicate-command serialization, equal-time history/auth and both measuredloads. Strict fresh/upgrade+real wholeDBPG17 restore preserves receipt fields/hash/results/indexes and previous data.
- #100 full desktop/375px browser checks pass: real lost-response check/exactretry zero repeatedwrites, missing-check honestunknown, sameUUID firstexecutionafterpre-dispatchabort, historicaldetail/filter/search/historypagination, latecheckaccountswitch andlatedetaillogout. Initial keyboardfixture timing was stabilized by authenticated readiness and native focus assertions; actual Enter selection remains covered.
- Final build/typecheck/160 Node tests/bulk API+large+browser/operator API/generalbackup regressions pass. Measurements and attendance safe-busy implications are in docs/student-import.md. Final focused command, changed-file lint and existing repo lint baseline are checked before commit/PR.

- Release gate: pnpm test:student-import exit0 (all focused tests and16PGchecks); changed-file ESLint25files exit0; gitdiffcheckclean. Repository lint is unchanged at7errors/12warnings in baselinefiles. Full combined pipeline audit found no ADMIN/review/staleness/receipt bypass, implicit Group creation, omitted/noop mutation, partialcommit or oldreplayrestoration path. Both issue scopes are implementation-complete; #100 PR is the remaining integration action.
