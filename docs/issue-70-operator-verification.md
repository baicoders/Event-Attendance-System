# Issue 70 operator mode verification

## Automated checks

Run from the repository root:

```sh
pnpm test:operator
npx tsc --noEmit
DATABASE_URL='file:./dev.db' pnpm build
```

The database tests create and remove a disposable SQLite database under `/tmp`. The browser coordinator tests use no browser storage. `pnpm lint` currently fails on 13 existing errors in student and shared utility files; ESLint passes when run on the issue 70 files.

The recording helper takes a SQLite writer lock on the event row before reading its mode inside a short transaction. This prevents several deferred readers from all failing at lock upgrade and protects a scan against a concurrent mode change. Its per-operation Prisma transaction limits are 1.5 seconds to begin and 4 seconds to run. Contention or a lost write response is shown as an unknown result; the browser does not replay the write.

In the local disposable fixture, the five-request test sharing the server Prisma client completed in about 0.25–0.33 seconds and preserved one record, the original method, and both write-once timestamps. The two-client mode-switch test completed in about 0.9–1.2 seconds and found no opposite-mode timestamp across 12 interleavings. An exploratory run with five independent Prisma clients took about 40 seconds despite preserving the record invariant. This is a material limit for deployments with several server processes; the issue's requested HTTP baseline and representative-roster benchmark have not been measured.

## Device checks still required

No real HTTPS mobile camera or 2–5 physical-device walkthrough was available in this workspace. Before release, verify permission denial and recovery, camera track release on close and exit, portrait and landscape layout, background/resume refresh, keyboard operation in manual search, and the shared event mode on multiple authenticated devices. Check both the normal attendance page and the focused route with an approved event.
