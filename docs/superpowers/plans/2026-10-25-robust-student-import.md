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

- [ ] Pin and implement identifier/name conflicts and recognized enrollment status
  exclusions with source-row diagnostics; preserve historic exact receipt replay.
- [ ] Add bounded batch writes, retaining no-op timestamps, canonical IDs, untouched
  custom memberships/positions, academic groups and atomic receipt rollback.
  Prove against disposable PostgreSQL, including errors/concurrent overlaps.
- [ ] Add bounded XLSX parsing with safe textual identifiers, source sheet/row
  attribution and server-enforced type/size/row limits. Keep CSV compatibility.
- [ ] Add downloadable formula-safe diagnostics, complete summaries, responsive
  preview and actual execution status/recovery; never simulate percentage progress.
- [ ] Benchmark synthetic 100/1,000/3,000/5,000/10,000 new/mixed/repeated imports.
  Measure parsing/validation/writes, sampled peak RSS, query/connection counts and
  batches; verify identities, attendance, groups, positions and QR stability.
- [ ] Run PostgreSQL/HTTP/browser/regression/build/type/lint gates; independent
  critical review, fix findings, document results and manual nonproduction QA.
- [ ] Make incremental Conventional Commits; open a reviewable PR against the
  appropriate development base without merging or altering main.

## Review focus

Cross-namespace identity collisions, mismatched names, excluded statuses and
identical replay; blanks preserving every field/relation; batch failure after
earlier tentative batches; stale/concurrent previews; malicious spreadsheet
expansion and rounded numeric identifiers. Completion requires every brief
deliverable, including a real 5,000-row end-to-end run and 10,000-row stress run.
