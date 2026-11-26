# Classroom presentation verification

Implemented locally in the existing `feat/classroom-teacher-module` worktree. Prior uncommitted changes were preserved. No push, merge, external deployment, dependency installation, demo seed/reset, migration, or server write-contract change was performed.

## Verification

| Check | Result |
| --- | --- |
| Classroom unit suite | 85 passed |
| Student database and identity migration checks | 17 database tests passed, followed by migration consistency checks |
| Authentication/report database checks | 12 passed |
| Account/password recovery | 10 schema/credential tests and HTTP recovery/revocation/conflict/race checks passed |
| Presentation browser regression | Dialog opening, canonical URLs/refresh, Back/Forward, dismissal, focus/scroll/filter/navigation preservation, long identities, keyboard, 16px margins, pending traversal/application retry, restricted accounts, lazy history, visible saved notes, student deep-link loading/retry/unavailable/change states passed |
| Workspace/access regressions | Workspace switching, independent grants, application/approval/suspension, global disable and 60 legacy method/path boundaries passed |
| Student browser regression | Immediate search-to-profile navigation, correction draft/concurrent edit, printed QR disposition, verification and lost-acknowledgement retry passed |
| Report browser/API regression | Class/student/day/meeting selection, historical identities, private history, rates, full CSV/print/PDF, table-search scope and report-version rejection passed |
| Attendance browser regression | Scanner/manual flow, local-WASM QR identities, duplicate/unknown/ineligible cases, lost/malformed acknowledgements, 35/100/101/220 rosters, scrolling, corrections, finalization/cancellation passed |
| Focused attendance browser regression | All outcomes, review/retry/reload, concurrent marks, read failures after confirmation, view/search preservation, exact large-roster completion and deliberate finalization passed |
| Responsive walkthrough | 40 teacher/admin/access route/state cases at 375/768/1440/1920px; keyboard, reduced motion, empty states and 200% zoom passed, before and after the demo restart |
| Static/build | Independent TypeScript, zero-warning scoped ESLint, whitespace checks and isolated production build passed |

The production build retains the pre-existing unused `_req` warning in `app/api/groups/route.ts`. Browser coverage uses installed Chromium with Playwright emulation; it does not establish physical iOS/Android camera behavior or a separate Safari/Firefox run.

## Bugs reproduced and verified

A read-only fresh review identified retained-list query resets, lost navigation selection, a self-returning Events destination, pending navigation escapes, and technical baseline attribution. These were corrected. The expanded browser regression checks the resulting behavior while the overlay is open and after dismissal. Modern browser traversal is canceled before App Router handles it; popstate restoration and unload protection remain fallbacks. The final test checks the real production guard without experimental listeners, then confirms it releases so Back/Forward work normally.

The student browser also reproduced a pending search timer interrupting profile navigation. Profile activation now flushes and cancels that timer; the existing immediate-click correction regression passes. A viewport measurement initially ran before dynamic viewport geometry settled; the final bounds check waits for the actual geometry and passes down to an effective 187×450 viewport representing 200% zoom from a 375px viewport.

## Reproduction and artifacts

Use `USWAG_TEST_DIST_DIR=.superpowers/classroom-presentation/build-final` with the existing scripts. `scripts/test-classroom-presentation.mjs` creates a guarded disposable database and runs `scripts/test-classroom-presentation.py`. Existing student/report browser scripts use the revised labels and native report-type radios. API/database/browser write-flow tests use disposable `test_*` databases and explicit `TEST_DATABASE_URL`; none target the saved demo.

Evidence is under `.superpowers/classroom-presentation/`: `build-final.log`, `types-final.log`, `lint-final.log`, `unit.log`, `db.log`, `students.log`, `*-final.log`, `checks-*.json`, `browser/`, `visual/` and `demo-visual/`. Implementation notes are in [classroom-presentation.md](../implementation/classroom-presentation.md).

## Refreshed saved demo

The verified artifact `.superpowers/classroom-presentation/build-final` is running at **http://localhost:3000** with the original database and secrets. The original QR hub remains healthy at **http://localhost:3002**. The owned intermediate preview was stopped.

Fresh counts matched for **all 29 public tables** before restart, after restart, and after the final read-only 40-case walkthrough. Saved totals remain 9 users, 290 students, 6 classes, 22 Classroom sessions, and 1,214 Classroom attendance rows. Rate-limit metadata counts also matched (10 rows). No demo records were seeded, reset, or removed.

Exact evidence: `demo-counts-before.json`, `demo-counts-after.json`, `demo-counts-after-smoke.json`, `restart.log`, and `demo-smoke.log` in the artifact directory. Work remains local and uncommitted.
