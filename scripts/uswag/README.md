# USWAG workbook reconciliation

This CLI reads `USWAG ATTENDANCE.xlsx` (`ATTENDANCE` sheet), validates the seven
expected group counts (95 participants), and reconciles names against existing
students. It needs Node with the repository's installed dependencies and Python 3;
no additional spreadsheet package is needed.

Run the normal data-preserving Prisma migration before using the script. Never
reset the existing database. The CLI requires an explicit local PostgreSQL URL
and never loads `.env` or falls back to `DATABASE_URL`/`DIRECT_URL`. It checks the
actual database name and connected loopback endpoint before inspecting records.

```bash
node --import tsx scripts/uswag/seed.ts \
  --database-url 'postgresql://postgres:postgres@127.0.0.1:5433/event_attendance_dev'
```

The default is a database **read-only transaction**. Standard output contains
counts and the path to a private JSON report under `/tmp/uswag-reconciliation-*`.
The report contains participant names, database candidates, student IDs, positions,
intended assignments, and every unresolved row. Treat it as student data: keep it
outside the repository and do not commit or publish it. Reports are created with
mode `0600` in a private directory. An optional `--report /tmp/new-report.json`
selects a new report path; existing files are never overwritten.

Review the entire report with the event organizer before applying. Pay particular
attention to `.assignments`, `.details`, and `.groups`. Missing names, ambiguous
names, students repeated anywhere in the workbook, existing memberships in other
custom groups, and conflicting positions are never guessed or overwritten. Fix
source spelling or database names only after verifying the student's identity,
then run a fresh dry-run. This script never creates or edits a Student record.

After the user explicitly approves that report's assignments:

```bash
node --import tsx scripts/uswag/seed.ts \
  --database-url 'postgresql://postgres:postgres@127.0.0.1:5433/event_attendance_dev' \
  --apply --approval-report /tmp/uswag-reconciliation-EXAMPLE/report.json
```

An apply operation requires the dry-run fingerprint to match the current workbook,
local target, and complete reconciliation plan. A stale report causes the entire
operation to abort. The CLI creates/reuses the seven custom groups and applies
only the approved, unambiguous assignments. Missing/ambiguous/conflicting rows
remain unresolved and appear in the apply report. A group name/slug collision
aborts the entire apply operation.

Apply runs inside one transaction under the existing exclusive roster advisory
lock. The database's unique student-membership constraint additionally protects
against concurrent writers. Existing identical memberships are skipped; an empty
position can be populated; a different nonempty position is flagged for review.
Repeating a fresh dry-run/apply is idempotent. The script leaves student fields,
academic group memberships, and attendance records untouched.

Name matching uses Unicode-preserving case/spacing/punctuation normalization,
complete stored first and last name components, optional omitted middle names,
and matching middle initials. Comma-separated `Last, First Middle` is supported.
Any normalized collision is ambiguous. There is no fuzzy matching, nickname
resolution, transliteration, or manual override file.

```bash
node --import tsx --test scripts/uswag/reconcile.test.ts
```
