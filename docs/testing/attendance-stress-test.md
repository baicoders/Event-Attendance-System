# Five-phone event rehearsal

The event target is 3,000 attendees in 30 minutes: **100 people/minute total**, or
one attendee per phone every three seconds. Attendee count is the roster and
transaction volume; only five operators are active simultaneously.
Run one benchmark at a time on the laptop.
On Linux, the command holds a temporary sleep/idle inhibitor when available and
releases it when the command ends. It reports when this is unavailable. Keep the
laptop on mains power with its lid open. A host pause or clock change invalidates
the affected phase; suspend time cannot silently disappear from reported throughput.

## Automated rehearsal

Run from the repository root. PostgreSQL must already be available locally.
`TEST_DATABASE_URL` must explicitly name the local `postgres` maintenance database
with permission to create databases. The runner never uses `DATABASE_URL` as a
test target. It creates a unique `test_attendance_load_*` database, applies real
migrations, and drops only that database during cleanup. No seed/reset/db-push
operation is used.

```bash
# First verify the harness with a short sample (not a capacity certification).
pnpm test:attendance-benchmark
pnpm benchmark:attendance -- --quick --label smoke

# Full event rehearsal: at least 82 minutes plus build/browser checks.
pnpm benchmark:attendance -- --label baseline

# After performance changes, run the identical profile.
pnpm benchmark:attendance -- --label improved
pnpm benchmark:attendance:compare \
  test-results/attendance-load/<baseline-run>/report.json \
  test-results/attendance-load/<improved-run>/report.json
```

The default runs both `/attendance/operator` and `/attendance` separately. Each
gets an equivalent fresh event, a 3,000-student roster, five independent operator
sessions and one administrator viewing 50-row live progress:

| Phase, per screen | Offered workload |
| --- | --- |
| Warm-up, excluded from latency results | 60 seconds, separate event |
| Check-in | 3,000 attendees / 30 minutes |
| Time-out / departure headroom | 3,000 attendees / 10 minutes |
| Correctness checks | Duplicate collisions, stale mode, invalid lookup, timeout-only, failed lookup before a save, discarded response after a committed save |

Five percent of arrivals use manual entry. QR arrivals resolve the scanned code
before saving; manual arrivals refresh/search the roster and check the selected
record. The runner includes screen-specific list reads, eight-second event/stats
polling, mutation-triggered refreshes, and administrator progress polling. GETs
already in flight within the same operator session are coalesced. Writes are
never automatically retried.
Polling clocks restart after completed refetches, including those triggered by
successful writes; the runner does not stack extra fixed polls on top of them.

A short Playwright check first records real QR and manual traffic from both
mobile layouts, verifies polling and full-list activation, blocks external
requests, and reconciles its two writes per screen with PostgreSQL. Its browser
process exits before sustained load starts. It uses the existing Python
Playwright, Google Chrome, FFmpeg, Caddy and OpenSSL prerequisites described in
[attendance E2E setup](attendance-e2e.md). `E2E_PYTHON`, `E2E_CHROME` and
`E2E_CADDY` select alternative installed binaries.
Chromium's specific media-removed `play()` cancellation during explicit camera
closure is retained as a camera-shutdown diagnostic; other page errors fail the
browser check.

Each simulated phone has one attendance operation in flight. Fixed arrival times
continue while a phone is busy: delayed operations form a measured backlog and
drain without being dropped; a slow screen can extend the run substantially.
Backlog counts offered arrivals waiting after an operation completes, per phone;
the phase reports the largest queue seen by any phone.
Missed slots mean delay of at least one complete
per-phone arrival interval. The runner reports actual throughput and backlog;
it does not quietly reduce the offered rate to match a slow server.

Options include `--screen operator|regular|both`, `--attendees 5..3000`,
`--checkin-seconds`, `--checkout-seconds`, `--warmup-seconds`, and `--label`.
`--quick` traverses 100 attendees of the 3,000-person eligible roster, with
60-second check-in, 20-second departure and five-second warm-up. A quick run does
not test a fully populated attendance list or full-duration stability.
`--skip-build` requires a previously built label with an identical source hash.
Builds use their own directory under `test-results/attendance-build`; they do not
replace the normal `.next` build or change the Caddy service.

## Results and interpretation

Each run prints its artifact directory under `test-results/attendance-load/`:

- `report.json`: exact profile, source hash, commit/dirty paths, production build
  ID, workload hash, phase results, endpoint percentiles/bytes, reconciliation and cleanup status.
- `requests.csv`: request-level latency, HTTP status, bytes and expected/unexpected
  failures. `operations.csv`: lookup-to-save latency, scheduling delay and outcomes.
- `resources.jsonl`: host CPU counters, available memory, swap use, generator CPU/RSS,
  and app/Caddy RSS. Missing OS counters are explicitly null. PostgreSQL and other
  applications are included in host totals, not attributed to app RSS.
- Browser request evidence, screenshots/traces and component logs.

Check-in targets are p95 ≤1 second, p99 ≤2 seconds, at least 99.5 completed
attendees/minute (rounding tolerance around 100), no missed slots, and zero
unexpected failures or correctness discrepancies. Latency includes failed
operations. Departure timing is reported as headroom, not subjected to the
check-in latency target. Correctness always gates both phases. Nonzero exit status
means an infrastructure, correctness, cleanup or profile-target failure; examine
the report rather than treating every failure as an attendance product defect.
Host timing interruptions are reported separately from request and data failures.
The comparison command rejects different profiles, different workload hashes,
and incomplete runs.

Database reconciliation checks record uniqueness, expected timestamps/revisions,
audit entries, unchanged first timestamps, and agreement with stats, progress and
event reports. Injected errors remain separately labelled in request evidence.
Ctrl+C/SIGTERM produces an incomplete report and attempts cleanup; SIGKILL or a
power loss cannot guarantee cleanup. Retain artifacts when diagnosing failures.

The load generator shares the laptop, so its overhead and other running workloads
affect measurements. Run baseline and improved profiles sequentially with similar
background activity. Loopback HTTPS tests the app, database and proxy; it does
**not** traverse the Wi-Fi router. Only the phone rehearsal below tests that path.

## Rehearse on the actual five phones

This mode runs a disposable database behind the **existing** Caddy HTTPS address.
Stop the normal Next app first, leaving PostgreSQL and Caddy running. Port 3000
must be free; the runner refuses to stop another server or change Caddy's config.
Use a separate browser session for rehearsal accounts and sign in again to the
normal app when finished.

```bash
# Set this to the root certificate used by your existing Caddy instance.
# Node uses it only for the rehearsal's verified HTTPS client.
export ATTENDANCE_CADDY_CA=/path/to/caddy/pki/authorities/local/root.crt
pnpm benchmark:attendance -- --phones --label phones \
  --base-url https://<laptop-LAN-IP>
```

Without `--base-url`, phone mode derives the address from the repository Caddyfile.
It verifies that login reaches its own synthetic administrator before printing
credentials. The certificate must match the address. Install the existing Caddy
root certificate on each phone/browser before testing; do not bypass certificate
warnings or copy private keys. Caddy documents [local CA trust](https://caddyserver.com/docs/automatic-https#local-https).

The terminal prints five synthetic accounts, the admin account, a temporary
password, and links to both attendance screens and progress. Open the generated
`qr-cards.html` locally and print it or show cards on a separate display. The file
contains 100 synthetic cards, including internal IDs and external USN/LRN codes.
Keep the terminal open throughout the rehearsal.

The primary **near-full** event starts with 2,900 synthetic time-ins and matching
audit entries. Its first 100 students—the printed cards—remain unrecorded, so
your phones can perform fresh scans while loading attendance lists close to the
event's maximum size over real Wi-Fi. A second, empty event is also available for
basic workflow checks. Evidence records the preloaded counts separately from your
live actions; those 2,900 fixture entries are not claims of physical scans.

1. Connect all phones to the event Wi-Fi. Reserve the laptop's LAN address, plug
   it into mains power, disable sleep, and use the same laptop/router placement
   planned for the event. Check trusted HTTPS and camera permission on every phone.
2. Sign in with one distinct account per phone. Compare focused operator mode and
   regular attendance. Keep progress open on the laptop.
3. Have all five scan different cards together, then all scan the same unused card.
   Confirm one stored timestamp; repeating a scan must preserve that timestamp.
4. Mix manual name/USN/LRN entry with QR scanning. Try the actual printed cards,
   rear cameras, lighting, screen brightness and distance planned for the event.
5. Change recording mode deliberately. Confirm every phone observes/reviews the
   new mode. Time out an existing attendee and a student with no time-in; the
   latter must retain an empty time-in and stay out of checked-in totals.
6. Background/resume and lock/unlock phones. Disconnect/reconnect Wi-Fi. For an
   uncertain save, inspect the current record before deliberately scanning again.
   There is no offline attendance queue when the laptop is unreachable.
7. Disable external internet while retaining LAN access, then sign in in a fresh
   session and scan. Check progress and report totals against recorded attendees.
8. Press Ctrl+C on the laptop. Review both events in `phone-evidence.json`, recording which
   physical checks passed. Cleanup stops the rehearsal app and removes its
   database; restart the normal app and sign in again afterward.

Finish roster imports and membership changes before opening check-in. Their
exclusive roster locks can delay scans. Prefer focused operator mode on phones
unless the comparison shows a reason to use the full screen; it avoids polling
two growing attendance lists while manual entry is closed.
