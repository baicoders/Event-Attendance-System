# Classroom UI overhaul verification

Implementation inventory: `docs/implementation/classroom-ui-overhaul.md`. Approved visual reference and base commit are recorded there. Changes remain on `feat/classroom-teacher-module`; no push, merge, deployment, dependency installation, migration, demo seed or reset was performed.

## Evidence

| Check | Result |
| --- | --- |
| Classroom unit suite | 85 passed, including most-specific navigation and permission-aware primary meeting actions |
| Classroom/auth database suite | 97 passed in disposable databases; focused overview suite 5 passed |
| Overview reads | Full-scope totals/filtering beyond a 20-class page; transfer, archives, same-day distinct meetings, Manila boundaries, canceled exclusions, excluded roster members, empty scope and access changes |
| HTTP regressions | All eight existing Classroom suites passed; new overview privacy/access suite passed |
| Four-width walkthrough | 40 route/state cases at 375/768/1440/1920px; no horizontal overflow or clipped selectors; teacher working pages also checked at 200% zoom |
| Keyboard and motion | Select/menu keyboard operation, visible focus return; reduced-motion contexts; decision-sheet focus trap and restoration at 375/1440px |
| Focus attendance | All outcomes, corrections, delayed/lost/malformed responses, original-key reload recovery, confirmed-save/read-failure distinction, concurrent changes, scanner/manual switching and 100/101/220 exact completion passed |
| Scanner/manual regression | Local-WASM USN/LRN/legacy QR decoding, duplicate/unknown/ineligible scans, camera denial, roster paging, correction, finalization and cancellation passed; surviving filtered row shifted 0px |
| Classes and rosters | Inline catalog creation selection, sections/schedule/grace, creation lost-ack retry, persistent additions/exclusions, URL search/reload and ownership/concurrency passed |
| Student corrections | Retained draft/concurrent surname, reasoned correction, explicit QR alias handling, verification and lost-ack single history row passed |
| Onboarding | Saved drafts, welcome malformed-ack retry, atomic first-class lost-ack reload, roster/settings resume, tutorial, completion and repeatable Settings help passed; real attendance only after explicit Start |
| Teacher access/reviews | Nine browser groups and five database cardinality assertions passed: all access states, first application, approve/reject/suspend/revoke/restore, required reasons, stale-version rejection and identical-request uncertain retry |
| Reports/print | Historical identity/enrollment, rates/N/A, table search scope, private student history, full CSV/print/PDF, same-version exports and stale-version rejection passed |
| Events regressions | Operator 32, progress 20 and report/export/print utility 15 tests passed; workspace browser confirms switching, independent grants, 48px/14px controls, 1280px cap and switcher contrast |
| Static validation | Isolated production build passed; independent TypeScript and scoped ESLint passed; whitespace checks passed |

The production build retains the existing unused `_req` warning in `app/api/groups/route.ts`; scoped changed-file lint is clean.

## Bugs reproduced and corrected

- Same-route Attendance navigation changed the URL without changing the selected view. The list hook now subscribes to Next search parameters and uses the documented native history integration. The original production build failed the new view-switch assertion; the updated build passes while preserving search/term.
- Newly created subjects were lost when Radix's hidden select briefly emitted an empty value before the new option appeared. The shared controlled select ignores that transient empty event; deliberate clearing uses an explicit nonempty sentinel. The unchanged inline-create browser assertion passes after the correction.
- Mobile class-form selectors were clipped by grid children retaining intrinsic minimum widths. Shared form groups allow those children to shrink; the walkthrough checks the control bounds against their card as well as page overflow.
- Controlled teacher decision sheets did not return focus after Escape. A shared focus composition now restores the initiating control; strong focus assertions pass at both tested widths. Catalog and student correction sheets use the same behavior.
- Dynamic entry navigation occasionally remained on its list despite valid server Flight responses. Review and setup entry links now fetch on activation with `prefetch={false}`. Normal production checks confirm a single successful full Flight navigation, without interception, errors or browser fallback. The underlying framework cause was not established.
- Review also caught intermediate form-width, roster identifier-label and onboarding destination gaps; these were corrected before final verification.

## Reproduction and artifacts

Use `USWAG_TEST_DIST_DIR` and `USWAG_TEST_TSCONFIG` for isolated builds/test apps. Database/API/browser suites require explicit `TEST_DATABASE_URL` and use guarded `test_*` disposable databases. Never point write-flow tests at the saved demo.

The read-only route walkthrough is `scripts/test-classroom-overhaul-browser.py`; pass an explicit `CLASSROOM_UI_FIXTURE`, `CLASSROOM_TEST_BASE` and optional `CLASSROOM_UI_ARTIFACTS`. It logs in and reads existing fixtures without saving classes, profiles, applications or attendance. New overview and teacher-review harnesses are `scripts/test-classroom-overview-api.mjs` and `scripts/test-classroom-teacher-review-browser.mjs`.

Builds/logs/screenshots are under `.superpowers/classroom-overhaul/` and `.superpowers/classroom-tests/`. Detailed test results and retained failed-run evidence are `/tmp/classroom-overhaul-api-results.json`, `/tmp/classroom-overhaul-browser-results.json`, `/tmp/classroom-overhaul-review.md` and `/tmp/classroom-overhaul-teacher-review-report.md`.

Browser camera checks use generated video and Chromium emulation. They do not establish physical iOS/Android camera permission, rotation or backgrounding behavior.

## Saved demo

The updated demo is running at **http://localhost:3000** using `.superpowers/classroom-background/build`; the QR/account hub remains **http://localhost:3002**. The existing database and secrets were reused.

A fresh baseline was captured at 2026-11-13T09:44:36.964Z immediately before the guarded restart. All **29 public table counts matched** after restart and again after the read-only representative-page walkthrough. Current saved totals include 9 users, 290 students, 6 classes, 22 Classroom sessions, 1,214 attendance rows, 744 Classroom command receipts, 5 Events and 24 Events records. No demo seed/reset was run.

Health checks and teacher overview/classes/attendance/students/settings/reports/active-session pages passed. Administrator teachers/classes/catalog/activity/settings and actual Review-link navigation passed. Intermediate preview servers were stopped; the final demo and original QR hub remain running.

Before/after evidence is in `.superpowers/classroom-overhaul/demo-counts-{before,after,after-smoke}.json`; restart and smoke logs are `/tmp/classroom-overhaul-demo-restart.log` and `/tmp/classroom-overhaul-demo-smoke.log`. Two normal final-artifact workspace runs passed without intercepted requests, fallback navigation, client errors or failed scripts. All changes remain local in the existing feature worktree.


## Continuous background follow-up

Classroom now paints its pale-indigo-to-white canvas across the full-height content column, including bottom clearance and side gutters. Page wrappers are transparent; standalone access screens use the white document background. Settings, short/empty views and long working pages keep their existing content dimensions and white cards.

Scoped lint, TypeScript and an isolated production build passed. Viewport/canvas checks covered 375/768/1440/1920px, including access states; Settings screenshots and detailed checker notes are under `.superpowers/classroom-background/`. The current local demo artifact is `.superpowers/classroom-background/build`; fresh restart/count evidence is retained in that directory.

The refreshed demo passed representative teacher/admin page and Review-link checks. All 29 public table counts matched before restart, after restart and after the read-only walkthrough; the original QR hub remains healthy on port 3002.


## Presentation follow-up

The latest Settings/account-dialog, student-details, report-selection and Lucide follow-up is documented in [classroom-presentation.md](classroom-presentation.md). The current local demo artifact is `.superpowers/classroom-presentation/build-final`; all 29 public table counts matched across its restart and final read-only walkthrough. The original QR hub remains on port 3002. Earlier sections retain evidence from the preceding overhaul/background revisions.


## Final continuation — 2026-11-26

The existing worktree already contained the implemented overhaul and subsequent account/onboarding improvements. These changes were preserved. Final visual review corrected narrow meeting-history rows so dates and outcome summaries receive a full-width line on phones; a browser geometry assertion protects that layout. The route walkthrough now waits for the Subject control to finish loading before testing keyboard interaction and targets the visible onboarding heading, excluding the hidden practice lesson.

Fresh checks on the current source: **91 unit tests**, **97 disposable-database tests**, independent TypeScript, zero-warning scoped ESLint, whitespace checks, and an isolated production build passed. The only build warning remains the existing unused `_req` in `app/api/groups/route.ts`. The running build matches the current runtime source.

The current saved demo is **http://localhost:3000**, served from `.superpowers/overhaul-resume/build`; the existing QR/account hub is **http://localhost:3002**. The original PostgreSQL cluster was restarted unchanged. All 29 public table counts matched across the final preview refresh. The guide/help/practice smoke and enclosing Node runner both pass with unchanged saved onboarding and application counts. The earlier stale post-browser HTTP connection is resolved in the private runner using a fresh connection.

Fresh evidence is retained under `.superpowers/overhaul-resume/`, including `unit.log`, `db.log`, `tsc.log`, `lint.log`, `build.log`, `build-exit.txt`, `smoke-final.log`, fresh table-count snapshots and mobile/desktop screenshots. Prior regression evidence above remains applicable; the final continuation introduced no permission, write-contract, report-calculation or attendance-recovery changes. All feature changes remain local and uncommitted.

Final refreshed-build route sweep: **41 teacher/admin/access route-state cases passed at 375/768/1440/1920 px**, including 200% zoom, keyboard menus/selects, role navigation, empty states, retained Attendance filters, and full-width mobile meeting identities. No browser application writes occurred. Results and screenshots: `.superpowers/overhaul-resume/final-browser/`; log: `routes-final.log`.
