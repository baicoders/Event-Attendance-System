# Classroom implementation decisions

Ordered execution rulings retained for review. The approved specification controls product behavior; these record implementation choices and their practical costs. Final review dispositions will be appended after the fresh whole-branch review.

- Ruling: Execute inline, with the skill-required whole-branch review at the end — user approved proceed without selecting delegation; no implementer agents — cost if wrong: slower throughput, reviewed with tests.

- Ruling: Rename T0–T11 headings to Task 0–Task 11 solely for the skill task-brief parser; scope/requirements unchanged.

- Ruling: Local isolated PostgreSQL is 14.24; test against it and retain hosted-version validation as a release gate — cost if wrong: hosted behavior still requires staging checks.

- Task 1: Ruling: Introduce command receipt/locking foundation from T2 in T1 — applications already require durable atomic replay and independent policy checks — cost if wrong: T2 review spans infrastructure across two commits. Keep schema/field names from approved contract.

- Ruling: avoid rerunning unchanged expensive suites solely for task-done bookkeeping; ledger records the actual just-run verification and commit below — developer requires meaningful non-redundant testing. Initial recovery startup failed without a production build; one later load-sensitive login500 did not reproduce with logging, and final suite passed.

- Ruling: exclude ignored .superpowers scratch artifacts from TypeScript file discovery — local PostgreSQL files and isolated dev build types do not belong in application compilation — cost if wrong: only scratch TS files are excluded, all source/tests remain included.

- Ruling: Events service Actor.role accepts MEMBER snapshots as a type only; actual role/account checks always read the locked User. This fixes enum integration in existing workflow tests without trusting a stale caller role.

- Ruling: Last accessibility-label-only fix uses real Next development browser validation here; final production build is repeated with integrated T4 source — avoids building incomplete next-milestone modules solely for an attribute change — cost if wrong: T11/full integration build must still catch any production-specific issue.

- Task 4: Ruling: Add transaction-local StudentProfilePending staging and deferred history capture as defense across ALL scalar/raw-SQL/implicit academic membership writers; services finalize before constructing versioned DTOs/receipts — this prevents omitted writer hooks and guarantees one revision per changed student per transaction — cost if wrong: SQL trigger behavior and maintenance attribution need explicit regression coverage; no production activation before migration review.

- Task 4: Ruling: Baseline/creation profile history uses RESTRICT and is immutable, so history-backed students cannot be hard-deleted even without attendance. Preserve those records, keep archivedAt reserved for a separately authorized administrative retirement flow, and adapt deletion-based disposable fixtures to unique identities — preserves the approved integrity contract — cost if wrong: operators lose destructive reseed/delete convenience and must recreate a deliberately disposable database for demos.

- Task 4: Ruling: Material-write import instrumentation excludes only profileRevision-only bookkeeping while still requiring exact zero-write replay and no-op behavior — history now adds internal revision maintenance beyond the prior three domain writes — cost if wrong: separate profile audit/receipt count tests must continue detecting accidental duplicate history.

- Task 5: Ruling: Keep persistent-roster PostgreSQL cases in classes.db.test.ts rather than a second rosters.db.test.ts fixture — shared combined-class setup verifies the same transaction/ownership/exception requirements with one disposable migration — cost if wrong: test discovery must continue including the classes suite.

- Task 5: Ruling: Administrator catalog PATCH uses the same /api/classroom/terms/[id] and /subjects/[id] resource URLs with requireClassroomAdministrator plus ADMIN command policy, rather than duplicate /api/admin aliases — same ownership/authorization contract, fewer handlers — cost if wrong: clients must follow actual endpoint inventory, not the older example admin prefix.

- Task 6: Ruling: Extend createClassOffering with onboardingExpectedRevision and atomically link TeacherOnboarding.classId in that same command transaction — two separate HTTP saves could strand a created first class after response loss and cause duplicate setup — cost if wrong: class creation now shares one user-scoped onboarding advisory lock, acquired after the command and before the roster/catalog/Class layers. Non-onboarding class creation is unchanged.

- Task 7: Ruling: Pin PrismaPg wire sessions to UTC in getPgPoolConfig, preserve school display/policy timezone Asia/Manila; disposable test database defaults also UTC for bare fixture pools — installed PrismaPg7.10 formats UTC values without offsets and strips returned offsets, which caused observed eight-hour physical storage errors under the cluster Manila default — cost if wrong: runtime/backup/CLI connection startup options must be accepted by hosting, and deployed historical timestamp integrity must be audited before rollout. Never auto-rewrite old Events data. Production default timezone remains unknown and is an explicit release gate.

- Task 8: Ruling: Require raw code when recordScan=true on explicit inclusion and resolve it again to the supplied Student.id, and require expectedAttendanceRevision when finalized re-inclusion would change an existing result — protects identity retirement between dialog/open/save and recent corrections that do not change snapshotRevision — cost if wrong: inclusion DTO has two additional conditional fields; UI must preserve the original scanned code and include row revision for historical re-inclusion.

- Task 9: Ruling: retain bounded uncertain descriptors for the sessionStorage tab lifetime rather than expiring after24h — silently dropping an unresolved Start/correction could cause a different UUID and duplicate meeting/change; privacy cleanup occurs on identity/logout changes — cost if wrong: an old tab may continue showing a recoverable operation until explicitly checked, and closing the tab loses local descriptors (server records remain).

- Task 9: Ruling: use a small owned capture loop with the exact existing barcode-detector3.0.6 decoder as a direct dependency — installed @yudiel2.4.1 stop queue cannot clean up a rejected startup/play promise; own capture tests prove stop on late permission and play failure without patching packages — cost if wrong: shared capture changes require actual Events QR regression and physical-device validation; native scanner overlays/sound are replaced by acknowledgment-driven feedback.

- Task 9: Ruling: derive first-attendance guidance from existing finalized owned meetings rather than storing an onboarding flag inside finalization — avoids onboarding-after-session lock inversion and requires no migration — cost if wrong: canceled/transferred-only history may show the short guidance again; onboarding itself is never forced again.

- Task 9: Ruling: Attendance landing reuses bounded saved-class cards with direct Start/Continue and latest activity; full paginated meeting history is on each Class — keeps the primary returning-teacher action one tap away without an unbounded cross-class attendance feed — cost if wrong: teachers looking for old meetings must choose their class first.

- Task 9: Ruling: modernize the old optional manual browser fixture to populate explicit USNs and simulate loss of COLLEGE eligibility through an optimistic individual school-level correction rather than organizer deletion — display identifiers are now explicit USN/LRN and central deletion is deliberately admin-only/history restricted — cost if wrong: fixture differs from its older deletion scenario; separate authorization/identity tests cover deletion restrictions and Events full E2E covers eligibility rejection.

- Task 10: Ruling: report scope defaults to all historical meetings of the selected term's Class offerings, without re-filtering by mutable current term boundaries — changing term dates must not remove old attendance; optional explicit school-date filters narrow the report — cost if wrong: very large historical selections hit explicit limits and require narrowing.

- Task 10: Ruling: v1 general reports/exports omit excuse notes entirely; own-session attendance remains the place to view/edit notes — avoids spreading excuse-letter contents through aggregate documents and monitoring summaries — cost if wrong: teachers needing private annotated report exports must use session views until an intentional later option is implemented.

- Task 10: Ruling: CSV summary uses the latest included historical snapshot for each student's labels; per-meeting detail CSV retains that meeting's exact labels. Numeric identifiers are prefixed with an apostrophe using an explicit spreadsheet text convention, never a formula — preserves leading zeroes without injecting executable spreadsheet expressions — cost if wrong: raw CSV consumers must treat that prefix as the documented text marker; these attendance exports are not student import files.

- Task 10: Ruling: add six narrow concurrent-index migrations (M5a–f), one SQL statement per file, for global activity ordering/actor/entity filters — audit/verification streams need indexed pagination, and concurrent builds avoid blocking shared student correction/attendance writes — cost if wrong: interrupted concurrent index builds may leave invalid indexes and require the documented explicit operator recovery; fresh-database migrate-deploy tests must prove this installed Prisma/PostgreSQL combination supports the files. An earlier uncommitted ordinary-index draft was replaced before any production use.

- Task 10: Ruling: administrator monitoring reads remain available when the Class business flag is disabled, matching the existing teacher-application queue — administrators need investigation/access history while a module is disabled; these routes still recheck enabled fresh ADMIN authority inside their read transactions — cost if wrong: disabling Class alone does not hide its audit data from administrators, intentionally; teacher business/report routes remain flagged.

- Task 11: Ruling: retain old architecture/domain/conventions in clearly labeled docs/archive/pre-classroom and replace their main entry documents with current authoritative guidance — preserves useful Events history without presenting obsolete LAN/no-tests/11-ID claims as current — cost if wrong: historical deep links may require opening the archive rather than current section anchors.

- Task 11: Ruling: keep existing focused disposable DB fixtures instead of replacing them with one shared database/app orchestrator; add serial aggregate regression runner with per-suite logs/results — preserves independent ownership/cleanup and avoids cross-suite leakage while executing every required legacy check — cost if wrong: migrations/startup repeat and increase verification time. Runtime fixture sentinel/loopback guards prevent production fallback; no production operation performed.

- Task 11: Ruling: treat actual school HTTPS iOS/Android, unfamiliar-teacher trials, hosted latency/topology/timezone/history/backup and explicit production release approval as enforced external release gates — local implementation can provide executable checks and an honest Not run acceptance record, but cannot fabricate school/device/operator evidence or deploy without authorization — cost if wrong: the branch must not be described as production-certified or generally enabled until those gates are completed.
