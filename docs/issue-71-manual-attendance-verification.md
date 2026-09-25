# Issue 71: manual attendance verification

Manual search uses one cached roster query per event and viewer, ranks locally without requests per keystroke, and renders at most 50 results in ten-row steps. The normal attendance page and operator Sheet send explicit manual actions through the shared guarded operation coordinator. Selected-record reads run for one student only and distinguish loading, failure, no record, and recorded timestamps. The event-scoped student GET branches now enforce event visibility.

## Commands

```bash
DATABASE_URL='file:./dev.db' pnpm install --frozen-lockfile
DATABASE_URL='file:./dev.db' node --import tsx --test $(rg --files -g '*.test.ts' -g '!node_modules/**')
DATABASE_URL='file:./dev.db' npx tsc --noEmit
DATABASE_URL='file:./dev.db' pnpm build
node scripts/test-operator-api.mjs
MANUAL_BROWSER_TEST=1 node scripts/test-operator-api.mjs
```

The TypeScript suite passed 37 tests. The optional browser command needs Python 3, Playwright for Python, and `/usr/bin/google-chrome`. The HTTP script creates a temporary SQLite database, seeds 2,000 students, starts the production server, and removes the database afterward. The browser check covers keyboard selection, Escape, failed selected-record reads, explicit desktop and mobile manual writes, Next student focus, refresh after an eligibility rejection, operator Sheet reopening, and an observed audience change supplied through the event poll. It saves screenshots to `/tmp/issue-71-desktop.png` and `/tmp/issue-71-mobile.png`.

## Observed local measurements

On Linux headless Google Chrome with a synthetic 2,000-student `ALL` event roster, the cold roster GET took 114–160 ms across local runs and its uncompressed response was 436,915 bytes. The normal attendance view issued one initial roster GET; opening manual entry, reopening the operator Sheet, rejecting a removed student, and observing an audience change each caused a refresh. Typing 25 exact IDs after the focus refresh caused no further roster request. Warm input-to-visible-row p95 was 30–64 ms including Playwright overhead. An earlier run overlapped the focus refresh and measured 139 ms, so the warm-only script now waits for that response. These are local measurements, not a device or network guarantee. Camera hardware and a real mobile on-screen keyboard were not exercised in headless Chrome.

`pnpm lint` remains red on pre-existing errors in student form/import and shared files; targeted lint for issue 71 files is clean. The production build and type check complete with the existing unused `_req` warning in `app/api/groups/route.ts`.
