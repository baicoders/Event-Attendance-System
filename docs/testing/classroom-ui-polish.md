# Classroom usability and platform UI polish

Implemented and verified on 2026-11-13 in the existing `feat/classroom-teacher-module` worktree. No migrations or dependencies were added; no production deployment, push or merge was performed.

## Behavior

- Only an enabled, approved, non-administrator teacher owning the class can preview or start attendance. The locked start authorization precedes command receipt replay. Administrator assistance and Events permissions remain available.
- New attendance receipts carry frozen student names and string USN/LRN values. The client validates their internal identity against the acknowledged attendance; older receipt contents remain unchanged and have snapshot or neutral display fallbacks.
- Active plain session URLs open one unmarked student at a time. Focus uses page one of the existing Unmarked roster with 100 students per refill. Confirmed students cannot return through stale responses. Explicit legacy status/page/excluded URLs, and closed sessions, retain roster review.
- Decisions wait for initialized command recovery and a valid server acknowledgment. Recovery resolves original keys in creation order, including after reload. The current student remains pinned during saves; concurrent marks and exclusions reconcile authoritative records. A failed read cannot invalidate a confirmed save. The 180ms transition respects reduced motion; completion never finalizes automatically.
- Shared ordinary actions are 14px with 48px targets. Application shells cap at 1280px; forms and focused cards remain narrower. Light and dark workspace switchers use explicit colors. Excused is indigo, with text labels for every status.
- Reports retain the historical projection, rate formula, distinct meetings, eligibility, privacy, CSV protection and version guards. Historical name/USN/LRN search filters student rows before pagination, independently of headline metrics, charts and full-report exports. Student history pagination retains its aggregate identity and totals.

## Verification evidence

| Area | Result |
| --- | --- |
| Classroom unit suite | 81 passed, including queue, view state, ordered recovery, storage failure and acknowledgment identity |
| Classroom/auth database suite | 92 passed in disposable PostgreSQL databases |
| Teacher-start and attendance HTTP suites | Passed administrator preview/create/replay denial, role/revocation/ownership checks, all attendance outcomes and legacy receipts |
| Focus browser/API | Passed all four outcomes, reasoned last-mark review, delayed/lost/malformed responses, original-key reload recovery, confirmed-save/read-failure distinction, concurrent marking/exclusion, search/view preferences and camera/manual switching |
| Full shrinking queue boundaries | Real UI processed all 100, 101 and 220 students once each (421 total), with explicit finalization afterward |
| Responsive/accessibility | Focus at 375/768/1440/1920px; keyboard, visible controls, 200% zoom and reduced motion. Reports at 375/1440px and 200% zoom |
| Legacy Classroom mobile | Passed real generated USN/LRN/legacy QR video decoding through local WASM, duplicate/unknown/outside-roster choices, feedback outside loaded search, camera denial, retry audit counts, excluded review, roster pages, correction and lifecycle flows |
| Filtered roster refresh | Surviving row moved 0px; confirmation remained visible; deliberate teacher scrolling was retained |
| Shared workspace browser | Passed expanded/collapsed sidebar, 48px/14px controls, 1280px cap; switcher contrast measured 14.62:1 dark and 19.80:1 light |
| Setup/ownership | Onboarding and roster API/browser suites passed, including first real attendance, resumable setup, concurrency, transfer/replay and archive |
| Reports API/browser | Passed historical lookup, full CSV despite table search, N/A and eligibility, desktop table/mobile details, print PDF, stale export rejection and administrative activity details |
| Events regressions | Operator 32, progress 20, and correction/report/print 28 unit tests passed; operator, progress, export/print stress and student-detail API/browser suites passed |
| Build/types/lint | Production build and independent TypeScript exited 0; scoped lint and diff whitespace checks passed. Existing unused `_req` warning in `app/api/groups/route.ts` remains |

Independent code review found two focused workflow issues and one student-history pagination issue. Each was reproduced before correction, then verified by the relevant browser/database regression. No review findings remain deferred.

Browser camera verification uses Chromium with generated video frames. Physical iOS/Android permission, rotation and backgrounding checks remain the existing release acceptance work; browser emulation does not establish those device outcomes.

## Reproducing checks without disrupting the saved demo

The configuration already supports `USWAG_TEST_DIST_DIR` and `USWAG_TEST_TSCONFIG`. Build into a separate directory and use the same variables for test-app startup. Tests require the explicit local `TEST_DATABASE_URL` maintenance connection and provision/clean their own databases.

- `pnpm test:classroom:unit`
- `node --conditions=react-server --import dotenv/config --import tsx --test --test-concurrency=1 features/classroom/server/*.db.test.ts features/auth/server/*.db.test.ts`
- `pnpm test:classroom:focus`
- `pnpm test:classroom:mobile`
- `CLASSROOM_TEST_BROWSER=true node --import dotenv/config --import tsx scripts/test-classroom-reports-api.mjs`

Logs and screenshots for this walkthrough are retained under `.superpowers/classroom-polish/` and `.superpowers/classroom-tests/`. The final build's exit status is recorded in `build-exit.txt`; independent TypeScript is recorded in `typecheck-exit.txt`. The local build resolves Next's lint plugins through the already-installed `eslint-config-next` dependency directory (`NODE_PATH`); nothing was installed.

## Saved demo

The updated demo runs at **http://localhost:3000**, using `.superpowers/classroom-polish/ready` and its existing manifest/database. The QR/account review hub remains **http://localhost:3002**. Before/after restart counts match: 9 users, 290 students, 8 groups, 6 classes, 21 sessions, 1,144 Classroom attendance rows, 739 Classroom receipts, 5 Events and 24 Events records. No demo seed/reset was run.

The original `.next` build is retained. Changes remain in the existing feature worktree for review.
