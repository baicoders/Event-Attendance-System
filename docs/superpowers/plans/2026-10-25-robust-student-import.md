# Robust student import implementation plan

Spec: the user's attached Robust, High-Volume Student Import System brief.

## Initial audit and design

Current main f624c36 has an ADMIN-only CSV workflow: bounded JSON body, strict CSV
parser, batched snapshot reads, pure classification, signed preview, fresh locked
revalidation, atomic Student writes plus immutable receipt, explicit retry/history.
PostgreSQL unique USN/LRN constraints and the shared roster lock protect identities.
Custom memberships and their positions live in a separate relation and are not
modified. Attendance and canonical QR IDs remain attached to existing Student IDs.

Gaps: writes await nested Prisma operations per changed student; different names
can overwrite an identifier's owner; enrollment statuses are unsupported; XLSX is
unsupported; no row-count cap, issue download, live execution progress, or refresh
recovery for an in-flight command. Prior benchmarks cover 2,000/5,005 creates, not
the specified mixed sizes/10,000 stress test, peak RSS, queries, or connections.

Preserve the current review/atomic receipt architecture. Alternatives are durable
multi-transaction jobs (new schema and recovery complexity) or unchanged sequential
writes (long roster locks). First optimize bounded writes and measure the atomic
path; introduce durable processing only if measured limits require it. Never claim
tentative batch work is committed. No production datasets or database writes.
No schema migration is currently required for batched writes or stricter validation.

The source remains authoritative: every execution revalidates it and current
database state. Any invalid/conflicting/excluded row blocks the entire file;
the administrator corrects/removes rows and reviews again. This preserves the
existing all-or-nothing policy and avoids silent exclusions. Names differing from
an identifier's owner require manual profile correction rather than import overwrite.

## Tasks

- [x] Pin and implement identifier/name conflicts and recognized enrollment status
  exclusions with source-row diagnostics; preserve historic exact receipt replay.
- [x] Add bounded batch writes, retaining no-op timestamps, canonical IDs, untouched
  custom memberships/positions, academic groups and atomic receipt rollback.
  Prove against disposable PostgreSQL, including errors/concurrent overlaps.
- [x] Add bounded XLSX parsing with safe textual identifiers, source sheet/row
  attribution and server-enforced type/size/row limits. Keep CSV compatibility.
- [x] Add downloadable formula-safe diagnostics, complete summaries, responsive
  preview and actual execution status/recovery; never simulate percentage progress.
- [x] Benchmark synthetic 100/1,000/3,000/5,000/10,000 new/mixed/repeated imports.
  Measure parsing/validation/writes, sampled peak RSS, query/connection counts and
  batches; verify identities, attendance, groups, positions and QR stability.
- [x] Run PostgreSQL/HTTP/browser/regression/build/type/lint gates; independent
  critical review, fix findings, document results and manual nonproduction QA.
- [x] Make incremental Conventional Commits; open a reviewable PR against the
  appropriate development base without merging or altering main.

## Review focus

Cross-namespace identity collisions, mismatched names, excluded statuses and
identical replay; blanks preserving every field/relation; batch failure after
earlier tentative batches; stale/concurrent previews; malicious spreadsheet
expansion and rounded numeric identifiers. Completion requires every brief
deliverable, including a real 5,000-row end-to-end run and 10,000-row stress run.

## Evidence ledger (2026-10-25 Asia/Manila)

- Feature branch starts at f624c365ca3a; local and remote main remain at that SHA.
  Untracked school files were neither read nor staged. The user selected main as
  the PR base; no merge is authorized or performed.
- RED: 100 grouped creates took 414 queries. Bounded batch regression now passes
  its <=50-query gate. Mixed changes preserve omitted fields, custom positions,
  attendance and IDs; failing the third batch rolls back everything.
- RED/GREEN: conflicting names, excluded statuses, scientific notation, unsupported
  filenames, row/cell/column caps, source and review issue CSV, progress/recovery,
  XLSX text safety and ZIP/XML allocation regressions.
- Independent review fixed historic replay rejected by newer limits and XLSX
  encoded-coordinate allocation bypasses. Final reviewer disposition: no open
  concrete findings, including sparse ranges, aggregate budgets, ZIP consistency,
  source diagnostics and final classification changes.
- Synthetic mixed service benchmarks passed 1k/3k/5k/10k, with measured phases,
  query counts, memory and connections in docs/verification/student-import-scale.md.
- Production HTTP all-new 1k/3k/5k/10k passed; 10k commit took 25.67 seconds.
  Attendance during long locks rejects safely; explicit later retries succeed.
- Final pnpm build, TypeScript, focused ESLint and diff checks exit 0. Repository
  lint retains five errors/nine warnings in untouched baseline files, documented
  in the implementation report.
- Final pnpm test:student-import exit 0: 75 parser/report/progress tests,
  10 server/token/batch tests and 19 HTTP/fault/concurrency checks. Actual SIGKILL
  after two tentative batches rolls back; restart/check/exact retry succeeds once.
- Corrected broad server-compatible Node invocation: 290 passed/0 failed. React
  rendering separately: 11 passed/0 failed. Existing student bulk API/large/export/
  browser and operator API regressions pass.
- Final browser-only fixture exit 0: real 5k file → worker → preview → confirmation
  → progress → receipt → database count; 25-row DOM/search/375px; actual XLSX
  sheet/row/text identifier; source/review CSV downloads; refresh-only reference
  recovery; lost response/check/exact retry; logout/source/group races; history
  pagination. The pagination fixture waits for new rows rather than the page label.
- Real PostgreSQL 17 backup/isolated restore preserves receipt JSONB/hashes/indexes
  and original roster/history. Version 14 host clients were unsuitable, so the gate
  used PostgreSQL 17 client tooling from the existing image; no deployment service
  was added.
- Full architecture, field policy, migrations, limitations and manual QA are in
  docs/verification/robust-student-import.md.
- Review-ready PR: https://github.com/baicoders/Event-Attendance-System/pull/116,
  base main, feature head feat/robust-student-import. Leave unmerged.
