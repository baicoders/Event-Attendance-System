# Classroom attendance sessions

A class page and start preview are read-only. `getClassroomStartPreview` returns current class/roster revisions, the full live-roster fingerprint, server time, suggested school start time and any active session ID. A valid Start command supplies that fingerprint and both revisions. Recompute under the central roster SHARE lock and Class UPDATE lock before writing; a central transfer/profile/import change rejects a stale preview even when saved class revisions are unchanged.

Start creates one ACTIVE session, frozen class/term/subject/teacher/section context, original policy/configuration, one immutable identity/provenance member per eligible Student.id, and one UNMARKED attendance row per member. Inserts are batched250. Empty rosters are rejected; the supported limit is1,000, and larger rosters fail before any writes rather than truncating. One active session per class is enforced by Class locking and a partial unique index. Multiple finalized/canceled meetings on the same school date are legitimate.

## Time and policy

See [wire time versus school time](classroom-time.md). School dates and policies use Asia/Manila; database wire sessions use UTC. An explicitly offset start instant must be inside the frozen term and at most five minutes ahead of server time. Historical starts inside the term are allowed. A weekly schedule suggests a start on its configured weekdays; otherwise use server now. There is no calendar automation.

Present includes the exact grace boundary. Late begins strictly after it and remains an attended outcome. Freeze original policy at Start. Active policy amendments require an expected lifecycle revision and reason, preserve original policy, and never reclassify earlier marks.

## Lifecycle and snapshots

- ACTIVE starts with UNMARKED, never inferred absence.
- Finalize takes Session UPDATE, checks lifecycle/snapshot revisions, updates only included UNMARKED rows to ABSENT in one set-based statement, batches one immutable change per row, sets FINALIZED and writes audit/receipt in the same transaction.
- Cancel requires a reason and does not update attendance. ACTIVE or mistaken FINALIZED meetings may become CANCELED; all records remain and reports exclude canceled meetings. No reopen/delete endpoint exists.
- Finalized corrections and explicit roster adjustments are handled by the attendance engine. Original member identity/provenance fields never change; later admissions have `originalMember=false`. Exclusion retains the member/result and records disposition/revision.
- Class archival is blocked while a meeting is active, with a Continue session ID. Past sessions remain available after permitted archival.

Session SHARE permits independent attendance writes. Lifecycle/policy/eligibility changes use Session UPDATE. Class SHARE protects current ownership; transfer uses Class UPDATE. Start adds roster SHARE and locks AcademicTerm then Subject before Class UPDATE. Marks never increment a shared session counter. Snapshot/finalization use10s transaction/2s acquisition budgets; ordinary commands retain5s/1.5s, with bounded SQL lock/statement timeouts.

M4 enforces immutable original snapshots, attendance pair PK/composite FK, one result per member at commit, original materialization count, state/timestamp/grace consistency, monotonic revisions, append-only change history and no eligible UNMARKED rows in finalized sessions. The runtime role cannot delete sessions/members/results/history. Application authorization remains necessary; these constraints are not authority grants.

## Endpoints

- GET `/api/classroom/classes/[classId]/start-preview`.
- GET/POST `/api/classroom/classes/[classId]/sessions` (state/date/pagination filters; POST201 or409 ACTIVE_SESSION_EXISTS with Continue ID).
- GET `/api/classroom/sessions/[sessionId]` and `/roster` (default100/page, search/status and optional excluded members).
- POST `/finalize`, `/cancel`, `/policy-amendments` with UUID commands and expected revisions.

All routes require current Class access and owner/admin authority and return private/no-store responses. Receipt replay rechecks current authority before returning the original result, and precedes lifecycle/revision validation. Thus an uncertain Start/finalize acknowledgment remains recoverable after finalization while suspended/former owners cannot recover private results.

Roster response rows, counts and filtering derive from the same attendance read; original membership is stable under Session SHARE. Only included rows contribute to counts. Reports later use these historical members/results, never today's class composition.
