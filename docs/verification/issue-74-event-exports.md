# Issue 74 export verification

Verified on the `feat/issue-74-event-exports` worktree against a disposable SQLite database on 2026-09-25. The fixture database and generated browser artifacts stayed under `/tmp`.

## Commands and results

- `node --import tsx --test globals/utils/buildEventStudentFilter.test.ts globals/schemas/audiencePreview.test.ts globals/utils/reportGroups.test.ts globals/utils/reportTime.test.ts globals/utils/csvExport.test.ts features/reports/utils/eventExport.test.ts`: 16 passed, 0 failed.
- `npx tsc --noEmit`: passed.
- `npx eslint` on the changed TypeScript/TSX files: passed with no warnings. Repository-wide `pnpm lint` still reports 12 errors in existing student/shared files outside this change.
- `DATABASE_URL=file:/tmp/issue74-build.db AUTH_SECRET=... pnpm build`: passed. Its only lint warning is the existing unused `_req` in `app/api/groups/route.ts`.
- `scripts/test-event-export.ts` against the production server: passed for all five presets, current-population counts, section keys, CSV serialization, direct print access, active/owner/admin visibility, unknown and duplicate parameters, and provisional access.
- `scripts/test-event-export-browser.ts` in headless Chrome: report picker prepared full and late results; the 390 px mobile sheet kept controls reachable; the normal attendance Export link pointed to the selected event's picker; the existing attendance sheet retained student rows; the summary omitted the roster.
- Headless Chrome printed a long group summary as five A4 pages. Extracted PDF text showed the group header on every page and the TOTAL row on the last page.
- A 10,001-student audience returned `413 EXPORT_TOO_LARGE`. A warm request completed in about 0.1 seconds after the count-first bound check. The first request after server startup took about 10 seconds, including cold start.
- `scripts/benchmark-event-export.ts` with 2,000 eligible students and five concurrent operators returned coherent full exports of about 1.1 MiB each in 0.69–1.75 seconds. A concurrent record write took 1.88 seconds. Query count was not instrumented.
- LibreOffice Calc 25.8 imported the fixture's full CSV with column 7 (Student ID) set to Text using the [documented CSV filter code](https://help.libreoffice.org/latest/en-GB/text/shared/guide/csv_params.html). The resulting workbook stored `00000000001` as a string. Opening CSV without this import choice is not claimed to preserve leading zeros.

## Scope notes

Each preparation captures one current event/roster/record evaluation. Two separate CSV or print requests can show different preparation times and values. The fixture includes a Record with no time-in and no time-out as an absent row. Current canonical attendance rules treat a timeout-only Record as attended; this work preserves that rule from the newer main branch.
