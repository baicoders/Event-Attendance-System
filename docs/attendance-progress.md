# Live attendance progress (#72)

The progress page is available from **View progress** on an approved event in Attendance. It reads the current eligible roster and recorded time-ins. A time-out does not remove a checked-in student. A time-out-only record remains stored and available through **Review records without time-in** in the existing attendance table and the individual record lookup, but is **not** counted as checked in by progress, live stats, the default live records list, overview, or the event report. This intentionally changes the report outcome introduced for time-out-only rows in the later manual-attendance work, so all current-population readers agree on one check-in rule.

`GET /api/events/[eventId]/progress` returns the whole-event totals, one chosen breakdown, and optionally one bounded detail page in a single authenticated read transaction. It accepts `groupBy=SECTION|DEPARTMENT|PROGRAM|STRAND|HOUSE|YEAR`, `includeRows=0|1`, `bucket=all|none|multiple|g:<group-id>|y:<YearLevel>`, `status=NOT_YET|CHECKED_IN|ALL`, literal name/ID search `q` (up to 100 characters), a positive one-based `page`, and `pageSize=10|25|50|100`. The endpoint rejects a group key from the wrong category or a deleted group. Without `includeRows=1`, it omits student rows. Detail search and status never change summary denominators. `evaluatedAt` and `audienceSignature` describe the read; neither is a historical roster snapshot or a guarantee that later pages see the same population.

The page polls only while visible, every eight seconds, with a 15-second client timeout. It retains clearly labelled same-event data after a network refresh error and hides protected data after access denial. Polling and page-to-page reads can see different current rosters; exports needing one frozen roster belong in the export workflow.

## Verification

The focused domain and disposable SQLite suite is `pnpm test:progress`. The HTTP fixture is `pnpm test:progress-api` after a production build; it compares progress with stats, both record-list modes, the event report, and overview, and checks authorization and invalid filters. Run `PROGRESS_BROWSER_TEST=1 pnpm test:progress-api` for the two-session desktop/mobile Playwright check, and separately run `PROGRESS_BENCHMARK=1 pnpm test:progress-api` for the 2,000-student measurement. Browser verification needs Python Playwright and Google Chrome at `/usr/bin/google-chrome`.

For a build without using a real event database, set `DATABASE_URL` to a disposable SQLite file, run `pnpm exec prisma db push`, then `pnpm build`. The HTTP script creates and deletes its own separate temporary database.

The September 25, 2026 local runs used an Intel Core i5-8350U laptop (8 logical CPUs, 11 GiB RAM), a production Next server, 2,000 eligible students, five authenticated viewing/recording clients, 20 progress HTTP requests per run, and ten successful recording requests per run. The requested detail page was 50 rows. Measurements varied with local contention:

| Measure | Run 1 | Run 2 | Final build |
| --- | ---: | ---: | ---: |
| Progress response size | 11,232 bytes | 11,232 bytes | 11,282 bytes |
| Progress HTTP p50 / p95 | 378 / 678 ms | 650 / 1,150 ms | 139 / 355 ms |
| Recording HTTP p50 / p95, dashboard requests closed | 478 / 771 ms | 577 / 850 ms | 241 / 388 ms |
| Recording HTTP p50 / p95, concurrent progress requests | 1,098 / 1,302 ms | 1,766 / 2,062 ms | 711 / 855 ms |
| Direct read Prisma query events, including transaction statements | 11 | 11 | 11 |
| Recording failures | 0 | 0 | 0 |

The direct query event count comes from a separate instrumented call to the same read service; it is not an HTTP server query trace. The HTTP timings include local request, authentication, and server work. This is a small synthetic local sample, not a production latency guarantee. Run 2 missed the proposed one-second p95 progress target, and recording latency rose under concurrent reads in both runs. These results warrant watching the deployment laptop under real load before promising a refresh or scan latency.

The browser fixture completed a two-session check-in update, overall/group/status drill-down, keyboard heading focus, and a 375-pixel viewport without page-wide horizontal overflow. It observed five desktop progress requests while opening and changing the view. The report and print pages do not mount the progress poller; the HTTP fixture also exercises the report endpoint after the count correction.
