# Issue 70 operator mode verification

## Automated checks

Run from the repository root:

```sh
pnpm test:operator
npx tsc --noEmit
DATABASE_URL='file:./dev.db' pnpm build
pnpm benchmark:operator
```

The database tests create and remove a disposable SQLite database under `/tmp`. The browser coordinator tests use no browser storage. `pnpm lint` currently fails on 13 existing errors in student and shared utility files; ESLint passes when run on the issue 70 files.

The recording helper takes a SQLite writer lock on the event row before reading its mode inside a short transaction. This prevents several deferred readers from all failing at lock upgrade and protects a scan against a concurrent mode change. Its per-operation Prisma transaction limits are 1.5 seconds to begin and 4 seconds to run. Contention or a lost write response is shown as an unknown result; the browser does not replay the write.

In the disposable test fixture, five concurrent requests sharing the server Prisma client preserved one record, the original method, and both write-once timestamps. The two-client mode-switch test found no opposite-mode timestamp across 12 interleavings.

The separate-thread benchmark uses a 500-student roster and distinct students for each request. Across two local runs, two operators took **262–373 ms baseline / 280–439 ms guarded** wall time; five took **510–547 ms baseline / 580–594 ms guarded**. All requests succeeded. The baseline is a proxy for the previous route's read/read/create path; it omits HTTP, cookie authentication, and query invalidation. A separate exploratory run with five synchronous Prisma clients on *one JavaScript thread* took about 40 seconds because each SQLite busy wait blocked the lock holder's event loop. The separate-thread result is more representative of several server workers, but the requested authenticated HTTP benchmark and physical-device test remain outstanding.

## Device checks still required

No real HTTPS mobile camera or 2–5 physical-device walkthrough was available in this workspace. Before release, verify permission denial and recovery, camera track release on close and exit, portrait and landscape layout, background/resume refresh, keyboard operation in manual search, and the shared event mode on multiple authenticated devices. Check both the normal attendance page and the focused route with an approved event.
