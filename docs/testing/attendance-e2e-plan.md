# Attendance E2E implementation plan

Approved scope: reusable local production-build tests behind Caddy HTTPS, Android Chrome attendance, desktop administration, five independent operators, synthetic 2,000-student roster. Test and report; do not fix product behavior.

1. Build an isolated fixture runner with maintenance-URL guards, real migrations, synthetic accounts/roster, temporary Caddy storage, browser-scoped certificate pin, read-only database evidence endpoint, and reliable cleanup.
2. Add browser scenarios for create/submit/approve, QR/manual identifiers, time-in/out, duplicates, eligibility, five operators, mode conflicts, failures before/after commit, progress, corrections/history, exports and print.
3. Run attendance regressions and the new suite twice; document reproducible findings and physical Android checks. Preserve failing assertions for product bugs.

Defaults: use existing Python Playwright and installed Chrome; Node orchestrates fixtures. Block external browser requests for the no-internet scenario; separately simulate lost LAN requests. Do not promise offline queuing or physical-phone validation.
