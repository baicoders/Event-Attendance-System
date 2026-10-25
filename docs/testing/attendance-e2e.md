# Attendance end-to-end checks

`pnpm test:e2e:attendance` builds the app, starts an isolated production server behind
Caddy HTTPS, and exercises Android Chrome emulation and desktop administration.
All accounts, students, events, and attendance records are synthetic. The runner
creates a migrated `test_attendance_e2e_*` database and removes it after the run.
It does not use the deployed website, reset your database, reload your Caddy
service, or install a certificate in the system trust store.

## Setup

The runner currently targets Linux with Node/pnpm, local PostgreSQL, Caddy,
Google Chrome, ffmpeg, and Python 3. Dependencies must be installed and the first
production build needs internet for Google Fonts. Event operation is tested
separately with external browser requests blocked.

Install the Python dependency in a virtual environment if needed:

```sh
python3 -m venv .venv-attendance
.venv-attendance/bin/pip install -r scripts/attendance-e2e/requirements.txt
```

Set `TEST_DATABASE_URL` in your ignored `.env`, or export it. It must explicitly
name the `postgres` maintenance database on localhost/127.0.0.1 and use a role with
permission to create and drop databases. There is no fallback to `DATABASE_URL`.
For the repository's development container:

```sh
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres'
E2E_PYTHON=.venv-attendance/bin/python pnpm test:e2e:attendance
```

If Python Playwright is already installed, use `pnpm test:e2e:attendance` directly.
`E2E_CHROME` overrides `/usr/bin/google-chrome`; `E2E_CADDY` overrides `caddy`.
The existing Chrome installation is used, so downloading Playwright browsers is
not required. Ports are allocated on loopback; the existing port 443 service is
left alone. Do not run two copies in the same checkout while building `.next`.

After a production build of the same source, repeat without rebuilding:

```sh
E2E_SKIP_BUILD=1 pnpm test:e2e:attendance
```

To run only the three regression cases:

```sh
E2E_CASES=03,10,15 pnpm test:e2e:attendance
```

`E2E_CASES` accepts comma-separated two-digit case IDs; omitting it runs all 20.
Selected cases are recorded in the JSON report.

This still creates fresh data and restarts the application and proxy. Rebuild
after product changes. Runtime and migration URLs are explicitly overridden for
the disposable database even if `.env.local` points somewhere else.

## What it checks

- Organizer creates a draft and submits it; a desktop admin approves it; a phone
  selects it and records attendance.
- Mobile manual entry finds names, USNs, LRNs, and legacy IDs. Searching and
  viewing details do not write attendance. Duplicate recording preserves evidence.
- Real QR images enter Chrome through simulated camera video, pass through the
  app's actual decoder, and produce database-backed success or rejection.
- Time-in/out, missing time-in, eligibility, five simultaneous operators, and
  stale event modes preserve one record and the original timestamps.
- Fresh login and recording without external internet access; connection failure
  before a write reaches the server; a real committed write whose response is
  lost; deliberate recovery without automatic replay.
- Admin corrections, voids/restores, immutable history, permissions, progress,
  downloaded CSV contents, and printable summaries.

The scanner's decoder is served at `/qr-decoder/zxing_reader.wasm`. Next prepares
it from the installed scanner dependency when loading its configuration, keeping
the JavaScript and WASM versions aligned. A fresh browser can scan using only the
local HTTPS server; no CDN cache or native `BarcodeDetector` is required.

The test runner supplies a temporary CA. Chrome's certificate exception is pinned
only to the fixture leaf public key, and Node independently verifies the proxy's
certificate against its generated CA. The Playwright request driver trusts that
CA for the test process only. No blanket `ignore_https_errors` setting is used.

## Results and failures

Each run writes `test-results/attendance-e2e/<timestamp>-<pid>/` (git-ignored):

- `report.json`: scenario outcomes, failure details, and network/browser diagnostics.
- `database-evidence.json`: independent, read-only PostgreSQL snapshots.
- `build.log`, `app.log`, `caddy.log`, `browser.log`: component output.
- PNG screenshots; failed cases also retain page text and Playwright trace ZIPs.
- CSV/PDF outputs when report checks reach those steps.

Exit status is nonzero for any failed scenario or infrastructure failure. A
product failure remains a failing test; it is not marked skipped or treated as
an expected pass. Diagnostics also include expected injected failures and canceled
Next.js prefetches; use scenario outcomes to identify failures. Browser checks run sequentially and continue after individual
scenario failures. Read failures alongside traces to distinguish a product
problem from a stale selector or missing prerequisite. Fixtures and private
certificate material are temporary and cleaned up; do not terminate the runner
with SIGKILL if you want automatic cleanup.

No real credentials are recorded. Traces contain synthetic session cookies;
share artifacts with the same care as other test-session recordings.

## Physical Android check at school

Automation emulates mobile layout and touch, not a physical Android camera,
router, or device certificate store. Before an event:

1. Use the normal school Wi-Fi and laptop Caddy HTTPS address. Confirm the phone
   trusts the installed school CA without a certificate warning.
2. Disable cellular data/internet while keeping school Wi-Fi connected. In a
   fresh browser session, sign in and scan an actual printed USN/LRN card.
3. Deny camera access, confirm manual entry works, then allow camera access and
   reopen the scanner. Check the rear camera, portrait/landscape, and lighting.
4. Repeat a scan; confirm one attendance record and unchanged first timestamp.
5. Use two to five phones together. Switch the event mode from the laptop and
   verify each phone observes/reviews the new mode before continuing.
6. Lock/unlock or background/resume the phone. Confirm camera release and safe
   refresh. Disconnect/reconnect Wi-Fi; resolve uncertain attempts by checking
   the current record before trying again.
7. Review and correct a synthetic record on the laptop; compare progress and
   exported/printed totals. Keep these checks on designated test data.

“No internet” means LAN access to the laptop and local database still works.
The app has no promised offline attendance queue when the laptop is unreachable.
