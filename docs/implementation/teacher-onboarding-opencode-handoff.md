# OpenCode handoff: teacher onboarding and guide redesign

> Follow-up, 2026-11-26: the deferred saved-demo smoke is resolved. The private runner now uses a fresh `node:http` connection (`agent: false`) for progress reads after its synchronous browser child. The browser and enclosing runner both pass; saved onboarding and all application table counts remain unchanged. See the current verification record for final preview details. The original handoff below is retained as history.

## Start here

- Worktree: `/home/kirbysmashyeet/.codex/worktrees/f391/event-attendance-system`
- Branch: `feat/classroom-teacher-module` (HEAD was `ca0f0fc` at task start).
- Implementation is finished and **uncommitted**. The worktree already contained substantial unrelated feature changes before this task. Preserve all of them; do not reset, clean, rebase, merge, or recreate the demo.
- The user requested that further verification be deferred and that this handoff be prepared. No additional verification was started after that request.

## What changed

The authenticated onboarding route now has a centered immersive layout with ordinary navigation hidden, Back/Save and exit, three labeled chapters, and a sticky primary action. It supports two introduction screens, class basics/sections, creation or reuse of an existing owned class, roster review with focused exception sheets, attendance settings with a schedule disclosure, fictional scan/manual/finalization practice, and a saved completion summary. Completing setup opens classes or the existing start-review screen; it never starts a meeting.

`screen` query parameters support refresh and history while server-derived readiness constrains forward movement. Draft and command ownership remains mounted across substeps/help. Save and exit preserves setup drafts or valid class edits without acknowledging review checkpoints. Same-request retries and atomic first-class linking are retained. Reviews bind to the displayed roster fingerprint/configuration revision; explicit reload refreshes roster data. Independent edit types cannot silently rebase unseen revisions. Blank grace remains invalid, explicit zero remains valid, and reasons use the server's trimmed representation when comparing saved drafts.

Added `/class/help` with eight bookmarkable lessons, introduction/practice replay, Settings entry **Teacher guide & help**, and redirect from `/class/onboarding?help=1`. Contextual help preserves task state/focus beside rosters, scanner/manual attendance, finalization and report selection. Scanner processing pauses while its help is open. Practice is local fictional data; its optional camera only previews video. Illustrations are separate warm SVG assets, with native controls, compact-zoom wrapping, 48px select choices and reduced-motion sheet alternatives.

No new dependencies, migrations, persisted onboarding schemas/step identifiers, completion checks, or server write contracts were introduced.

## Main files

- `features/classroom/components/onboarding/TeacherOnboarding.tsx`: mounted journey/controller.
- `.../onboarding/JourneyRoster.tsx`, `PracticeLesson.tsx`: roster sheets and local practice.
- `features/classroom/utils/onboardingJourney.ts` and `.test.ts`: readiness mapping, practice, validation, revision binding and canonical comparison.
- `features/classroom/hooks/useJourneyNavigation.ts`: pending-save navigation protection.
- `features/classroom/components/ClassFields.tsx`: reusable native field groups also used by `ClassForm.tsx`.
- `features/classroom/components/help/*`, `app/(classroom)/class/help/page.tsx`: guide lessons, hub and task-preserving help sheets.
- `ClassroomShell.tsx`, Settings/onboarding route files, scanner/manual/finalization/report components and `components/ui/index.tsx`: integration and touch targets.
- `public/classroom/guide/*.svg`: three illustrations following the written sketch specification; the actual sketch image was unavailable in this context.
- `docs/teachers/classroom-guide.md`: updated teacher instructions.
- `docs/testing/teacher-onboarding-redesign.md`: detailed evidence and limitations.

## Verification already completed

- Classroom unit suite: **91 passed** (`unit-final.log`).
- Classroom/account database suite: **97 passed** (`db-final.log`).
- Final production onboarding browser/API walkthrough passed (`onboarding-release.log`): new/existing/empty/archived/restricted teachers, skips, save/exit, invalid input, lost/malformed acknowledgement recovery, duplicate-free creation, concurrent review/reload, padded irregular reason saving, all four widths **375/768/1440/1920**, effective **187px / 200% zoom on every screen**, reduced-motion assertion, 48px option measurement, focus/keyboard, zero practice attendance calls, zero replay writes and explicit real-start confirmation.
- Final roster and report browser/API suites passed (`rosters-release.log`, `reports-release.log`).
- Full real-WASM scanner/manual attendance browser suite passed, including scanner-help pause/resume and 35/100/101/220-student rosters (`attendance-diagnostic.log`).
- Account presentation/restricted-state browser suite passed (`account-verified.log`).
- Independent TypeScript, zero-warning scoped lint and whitespace checks passed. Final isolated production build passed (`build-release.log`, exit marker `0`). Build retains the pre-existing unused `_req` warning in `app/api/groups/route.ts`.
- One early manual-correction browser run timed out; the diagnostic full rerun logged the real correction request and passed without changing attendance implementation.

Evidence directory: `.superpowers/teacher-journey/`. Screenshots cover 48 screen/width combinations. Do not delete prior `.superpowers` directories; they contain the saved demo and other plans' artifacts.

## Local demo and preserved data

- App: **http://localhost:3000**
- Original QR/account hub: **http://localhost:3002**
- Running artifact: `.superpowers/teacher-journey/build-release`
- Ownership metadata: `.superpowers/classroom-demo/running.json` (at handoff: app PID 1041588, QR PID 1041640; verify ownership before stopping any process).
- Original saved PostgreSQL cluster was stopped after the environment restart. It was restarted unchanged using `.superpowers/sdd/2026-11-02-classroom-attendance-teacher-module/postgres`, loopback port **55491**. Existing data was never seeded, reset or migrated.
- Fresh counts before and immediately after refresh matched for **all 29 public tables**: **9 users, 290 students, 6 classes, 22 Classroom sessions, 1,214 Classroom attendance rows**. A subsequent read-only walkthrough also preserved every application table count. Expired `RequestRateLimit` metadata changed from 9 rows to 2 during logins; it is recorded separately.
- The saved account named `newteacher` **already completed setup** and has a saved Database Systems class. Preserve its completion; use `?replay=introduction` or `?replay=practice` to preview the journey. Use disposable test accounts for new-teacher write tests.
- Credentials remain only in existing local private manifests/cookie files. Do not paste them into logs or commits.

## Remaining follow-up (deferred by user)

The **saved-demo browser walkthrough passed**: guide, roster/report help and focus, retained report selection, all widths/compact zoom, fictional practice and **zero browser writes**. The enclosing private Node smoke runner has not achieved a clean final exit:

1. It first asserted on an unread QR-hub response body inside Node 22.23.4/Undici. The private runner was changed to consume bodies.
2. Its last attempt passed the entire browser walkthrough, then the post-browser GET in `progress()` failed with `UND_ERR_SOCKET: other side closed` after `spawnSync` blocked the Node event loop. This is the remaining verification issue; there is no accompanying application failure. See `.superpowers/teacher-journey/demo-smoke.log` and `.superpowers/teacher-journey/demo-smoke.mjs`.

Next action, when verification resumes: make the private runner use fresh/closed HTTP connections after the synchronous browser run (for example `Connection: close` or a fresh Undici agent), rerun that read-only smoke and capture fresh counts. Investigate an application issue only if fresh-connection requests reproduce one. Do not reset the already-completed demo account to make the probe pass.

Useful commands (from the worktree):

```sh
pnpm test:classroom:unit
pnpm test:classroom:db
USWAG_TEST_DIST_DIR=.superpowers/teacher-journey/build-release USWAG_TEST_TSCONFIG=.superpowers/teacher-journey/tsconfig.json CLASSROOM_TEST_BROWSER=true node --import tsx scripts/test-classroom-onboarding-api.mjs
node .superpowers/teacher-journey/demo-smoke.mjs
```

Browser/API runners use guarded disposable `test_*` databases via `TEST_DATABASE_URL`; never substitute the saved demo URL. The current implementation does not need another rewrite or dependency install. Keep the feature worktree local and uncommitted unless the user directs otherwise.
