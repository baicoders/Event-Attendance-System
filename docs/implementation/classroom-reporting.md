# Historical reports and administrative monitoring

All Class reports use `loadAuthorizedClassroomReport` → `buildClassroomReport`. JSON, CSV and print consume this projection; none query today's directory to reconstruct past eligibility. Events reports retain their existing services and calculations.

## Scope and calculation

`GET /api/classroom/reports` accepts `sessionId` or `termId`, optional `classId`, canonical `studentId`, inclusive `from`/`to` school dates, `page` and `pageSize`≤100. Class-term, daily, session and student-term are UI views over these selection fields. Student-term always intersects currently owned classes; administrators may inspect all. A guessed foreign Class/session is404. Directory access grants no additional attendance access.

Only included members of FINALIZED meetings contribute. ACTIVE and CANCELED meetings are counted separately as exclusions. Multiple meetings on a school date retain separate IDs. Missing membership is Not enrolled, never an invented absence; an included finalized Unmarked/missing result is an integrity error. Current profile/section/term-name/date edits cannot remove old eligibility. Explicit report date filters narrow a selection; mutable current term boundaries do not implicitly re-filter its history.

`CLASSROOM_RATE_V1`: Attended = Present + Late; numerator = Attended; denominator = Present + Late + Absent; Excused is separate and excluded. Eligible student-meetings = denominator + Excused. Zero denominator is N/A. Round to one decimal only after adding counts; never average row percentages. This is a system reporting convention, not an official school policy.

Summary identity labels come from that student's latest included historical meeting in the selection. Meeting-detail CSV preserves each meeting's exact snapshot labels. Stable Student.id groups rows even if a name/USN/LRN was corrected later. Excuse notes are omitted from general reports; authorized session views retain them.

## Read consistency and version preconditions

The loader opens PostgreSQL RepeatableRead, locks the fresh enabled User and Classroom membership, and locks selected Class rows in sorted order. Ownership transfer cannot race the authorized response preparation. A changed locked row triggers serialization failure; retry once only after confirmed rollback. Independent PostgreSQL barrier tests prove a queued old-owner read is denied after transfer and a queued membership read is denied after suspension.

A deterministic SHA256 reportVersion covers policy version, actor, normalized selection, included/excluded session headers, lifecycle/snapshot revisions, frozen identities/membership disposition and attendance status/revisions. Preparation timestamps and display pagination are outside the fingerprint. Repeated reads with unchanged data have the same version. A later central profile correction does not change it; an attendance correction, cancellation or explicit session roster change does.

`GET /api/classroom/reports/export` and `/class/reports/print` require `expectedReportVersion`. A mismatch returns409 REPORT_CHANGED for CSV or a print error page containing no student rows. The teacher refreshes the prepared report and then exports the new version. Downloads verify CSV content type and X-Report-Version before saving. No silently different CSV is produced. Successful CSV/PRINT preparation writes CLASSROOM_REPORT_PREPARED with real actor, filters, version, purpose/format and counts. It records preparation, not delivery or physical printing, and contains no student roster or excuse contents.

Limits are500 selected meetings and100,000 retained member rows, checked before loading the full projection. Oversized selections return REPORT_TOO_LARGE, never a truncated export. JSON rows/entries are paginated independently from whole-selection totals. CSV/print use the complete bounded projection, rather than the displayed page. Administrative school-wide selections may need a class or date filter.

## CSV and print

CSV formats SUMMARY and DETAIL use the shared CSV escaping utility, UTF8 BOM and explicit Asia/Manila timestamps. SUMMARY has one row per student with full counts/rate; DETAIL has one row per eligible student/meeting with that meeting's labels and contribution. Numeric identifiers carry an apostrophe text prefix to protect leading zeroes without spreadsheet formulas. Other formula prefixes, quotes, commas and line breaks are escaped. These are attendance exports, not student import files. Empty selections emit headers; X-Report-Version still identifies the prepared selection.

The server-authenticated `(print)/class/reports/print` page is outside the Events shell, supports teacher-only MEMBER accounts, sets private/no-store and force-dynamic, and shares the summary projector. Print tables repeat headers and avoid splitting rows; student-term print includes eligible meeting details. No public report token or attachment system is introduced. Physical print/PDF documents remain point-in-time snapshots and do not update after corrections.

## Administrative accountability

`GET /api/admin/classroom/activity` merges bounded summaries from ClassroomAudit, ClassroomAttendanceChange, StudentProfileChange and StudentVerification. Optional actor/class/session/student/entity/action/school-date filters and an opaque `(createdAt,source,id)` cursor provide stable pagination, including timestamp ties across sources. List queries select summaries only, not full audit JSON. Class/session/entity filters intentionally restrict the timeline to that scope; clear them to include global profile/verification activity. Migration baselines are omitted by default.

`GET /api/admin/classroom/activity/[source]/[id]` returns immutable before/after, real actor, reason and references. It recursively omits excuseNote fields from attendance/class audits. Profile details retain `_qrDisposition` so alias confirmation versus reprinting remains inspectable. Verification details compare both current student revision and content hash; old assertions explicitly show as stale. Detail response size is capped at2MiB of actual UTF8, including multibyte text. Oversized details direct administrators to class and individual histories.

Review prompts identify at least three attendance or profile corrections for the same student in the last30 days within the selected actor/course scope. They link to evidence and never suspend anyone. Historical date filters apply to the timeline; these prompts explicitly retain their separate last30-day window.

Teacher detail exposes minimal account/membership information, class count and the latest100 access decisions, with a link to the fully paginated timeline. Teacher-owned classes and activity remain directly accessible to administrators; assistance writes still require a reason and record the administrator. Class suspension/revocation uses the independent membership and leaves Events grants unchanged.

Monitoring reads require fresh enabled ADMIN authority, including inside the transaction. They remain available with the Class business flag off, matching the application review queue, so administrators can investigate while attendance is disabled. Teacher business/report endpoints remain feature flagged. No new approval queue is added beyond the teacher application.

## Index migrations M5a–f

Six additive indexes support global timestamp ordering, actor filters and entity history. Each migration contains exactly one CREATE INDEX CONCURRENTLY statement outside an explicit transaction. Fresh disposable migrate-deploy runs prove compatibility with installed Prisma7.10/PostgreSQL14. Normal attendance/profile DML stays available while an index builds. No production migration has been run.

Interrupted concurrent builds can leave invalid indexes. Before a production retry, an authorized operator must inspect pg_index validity and migration history, remove only the invalid index from that failed migration using the approved recovery procedure, mark that migration rolled back, and retry. Do not blindly use IF NOT EXISTS (it could accept an invalid index), drop history tables, or down-migrate student identity/session history. The deployment runbook provides the release gate/recovery checklist.
