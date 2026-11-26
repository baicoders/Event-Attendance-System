# Teacher onboarding and guide redesign verification

Verified locally in the existing `feat/classroom-teacher-module` worktree. Prior feature changes and saved demo data are retained. No dependencies, migrations, persisted step/schema changes, or server write-contract changes were introduced.

## Checks

| Check | Evidence |
| --- | --- |
| Classroom unit regressions | 91 passed, including URL readiness, fictional finalization, blank/zero grace, displayed-version acknowledgements and independent configuration/roster revisions and canonical saved reasons |
| Classroom/account database regressions | 97 passed; includes creation replay, concurrent changes, transferred/archived classes, attendance, report scope and account access |
| Guided browser/API journey | New/existing/empty/unavailable/restricted teachers; introduction/practice skips; draft and settings Save and exit; malformed/lost acknowledgements; duplicate-free creation after reload; concurrent roster/settings review and recovery; completion and explicit real Start confirmation |
| Help/practice isolation | No real attendance requests during practice; no browser writes during replay; exact one real meeting after explicit confirmation; contextual-sheet focus restoration |
| Regular class/roster browser/API | Combined sections, optional schedule/grace, subject creation, retained irregular additions/exclusions, creation retry and reload passed |
| Report browser/API | Class/student/day/meeting selection, version-bound exports and printable PDF, historic identities, privacy and monitoring passed |
| Attendance browser | Real local-WASM QR decoding, scanner pause/resume during help, denied camera fallback, duplicate/unknown/outside-roster cards, manual correction, retry identity, finalization/cancellation and 35/100/101/220-student rosters passed |
| Account presentation browser | Responsive dialogs, history/focus restoration, pending-submission protection, lazy student history and restricted states passed |
| Static/build | Independent TypeScript, zero-warning scoped lint, whitespace check and isolated production build passed |

The final accessibility walkthrough adds 375/768/1440/1920px and an effective 187px viewport representing 200% zoom to every guided screen, plus keyboard activation, focus return, and a computed reduced-motion assertion for help sheets. The final release walkthrough passed all of these checks, including 48px subject choices and a saved padded irregular-student reason.

## Regressions fixed

Reviews bind to the roster fingerprint/configuration version actually displayed. Remote changes require an explicit reload and fresh review. Reload refreshes the roster query as well as onboarding progress. Confirming one edit type never advances an unseen revision of the other type. Each screen saves its relevant field group; Save and exit validates all pending fields. A blank required grace value is invalid, including when the saved policy is zero.

The compact header now wraps at 200% zoom. Onboarding/help sheets suppress spatial animation when reduced motion is requested. Confirmed internal substep navigation bypasses only its synchronous history operation; pending/unconfirmed writes still block browser traversal and external links. Background read failures keep drafts mounted.

One initial attendance run timed out while a correction sheet stayed open. The diagnostic rerun recorded the real Late correction request and passed the complete scanner/manual/finalization suite without an attendance implementation change. Diagnostic artifacts are retained.

## Reproduction and artifacts

Use `USWAG_TEST_DIST_DIR=.superpowers/teacher-journey/build-release` and `USWAG_TEST_TSCONFIG=.superpowers/teacher-journey/tsconfig.json`. Existing browser/API runners create guarded disposable `test_*` databases through `scripts/pg-test-db.mjs`; they never target the saved demo. Set `CLASSROOM_TEST_BROWSER=true` for onboarding, roster and report runners.

Evidence is in `.superpowers/teacher-journey/`: `unit-final.log`, `db-final.log`, `types-final.log`, `lint-release.log`, `build-release.log`, `onboarding-release.log`, `rosters-verified.log`, `reports-verified.log`, `attendance-diagnostic.log`, `account-verified.log`, and `screenshots/`.

The production build retains the existing unused `_req` warning in `app/api/groups/route.ts`. Browser checks use installed Chromium/Playwright with permission emulation and fake video; they do not establish physical-device camera behavior or Safari/Firefox results.

The approved sketch image was unavailable in this context. Separate warm SVG illustrations follow the supplied written specification. Work remains local and uncommitted.

## Saved demo and deferred final smoke

The verified artifact `.superpowers/teacher-journey/build-release` is running at **http://localhost:3000**; the original QR hub is at **http://localhost:3002**. All 29 public table counts matched across refresh. Application counts remained 9 users, 290 students, 6 classes, 22 sessions and 1,214 attendance rows after a read-only walkthrough. Only expired rate-limit metadata changed (9 → 2). Existing `newteacher` completion was preserved; replay was used instead of resetting it.

The saved-demo browser walkthrough passed with zero writes. Its enclosing private Node runner later failed on a stale HTTP connection (`UND_ERR_SOCKET`) during the post-browser progress GET. Further verification was deferred at the user's request. See [the OpenCode handoff](../implementation/teacher-onboarding-opencode-handoff.md) for exact state and the next action.


## Deferred smoke resolved — 2026-11-26

Restored the existing PostgreSQL cluster and verified artifact without seeding or resetting data. The read-only guide/help, retained report selection, four-width/compact-zoom, focus return and fictional practice walkthrough passed. The enclosing Node runner also exited successfully after replacing pooled post-child-process progress fetches with fresh `node:http` connections (`agent: false`). Saved onboarding matched before/after and every application table count remained unchanged; authentication changed only rate-limit metadata. Evidence: `/tmp/classroom-overhaul-resume-smoke-fresh.log` and `.superpowers/overhaul-resume/demo-counts-after-smoke.json`.
