# USWAG setup operator runbook

`pnpm uswag:setup` is the single dedicated setup command. It verifies the private
workbook, identity manifest, provenance and group definitions; plans academic
groups and permanent houses; upserts the 94 approved students; creates/reuses seven
officer groups; assigns workbook positions; and checks event readiness. Apply is
one transaction. No separate student imports, group seeders or officer seeder are
needed. **Do not use `pnpm db:seed`: that is the destructive demo seed.**

## Prepare private inputs and a backup

Use the complete handoff directory outside git, retaining its layout:

```text
/private/uswag/
  01_AUTHORITATIVE/USWAG_ATTENDANCE_2026.xlsx
  01_AUTHORITATIVE/USWAG_2026_APPROVED_SETUP_MANIFEST_95.csv
  01_AUTHORITATIVE/USWAG_2026_SETUP_PROVENANCE.json
  02_GROUP_REVIEW/USWAG_REQUIRED_GROUP_IDENTIFIERS_67.csv
  02_GROUP_REVIEW/group_catalog_review.csv
  02_GROUP_REVIEW/HOUSE_group_seed_catalog.csv
  03_REFERENCE/USWAG_officers_review_PREVIOUS.csv
  03_REFERENCE/USWAG_students_94_ACADEMICS_AND_HOUSES.csv
```

The two reference CSVs provide independently checksummed verification, **not
additional imports**. The general 3,674-student roster is never loaded by this
command. Keep the original source files unchanged. All four provenance checksums
must match. The loader consumes the exact workbook bytes it hashes.

Install the repository's locked dependencies and generate its Prisma client;
Python 3 and the application's migrated PostgreSQL schema are required. Schema
migrations are deployment prerequisites, not run implicitly by this command.

Before applying, take a fresh verified database backup, record its location, and
confirm the restore procedure. Schedule a short maintenance window: apply freezes
roster writes while it validates and commits. `--backup-confirmed` acknowledges
that the operator completed this requirement; it does not create or verify a backup.

Set `USWAG_SETUP_DATABASE_URL` in the operator's private shell environment to the
explicit intended database URL. The CLI never loads `.env` and never implicitly
uses `DATABASE_URL` or `DIRECT_URL`. Prefer `--database-env` to placing credentials
in command arguments/history. Local loopback targets are the default. Authorized
remote runs additionally require `--allow-remote` on both commands and verified
TLS, using the existing `DATABASE_SSL_CA_BASE64` configuration when needed. URL
host/database overrides and insecure remote TLS are rejected. Use a direct database
connection; this maintenance transaction is not designed for a transaction pooler.

## Resolve group approval blockers

The supplied handoff has 67 required academic/house identifiers. Five permanent
houses are established; all 62 other definitions remain pending in the historical
review. Fifteen explicitly require semantic review. Review the school terminology
before approving HT/HRT, WADT/WAD, OMT and Grade 11 pathways; the tool never aliases
or reclassifies them automatically. This does not make any additional attendee an
unresolved identity: the identity target remains 94 approved and one held.

Record decisions in a separate private JSON file. Its hashes bind the exact
required-group CSV and historical catalog (SHA-256 of file bytes). A dry-run report's
`inputHashes.requiredGroups` and `inputHashes.groupCatalog` provide these values.
Each approved definition needs its exact source category, slug and catalog label:

```json
{
  "v": 1,
  "sourceHashes": {
    "requiredGroups": "<SHA-256 of required-group CSV>",
    "groupCatalog": "<SHA-256 of historical catalog CSV>"
  },
  "decisions": [
    {"category": "SECTION", "slug": "synthetic-1a", "name": "Synthetic 1A", "approved": true}
  ]
}
```

The example is synthetic; replace it with reviewed definitions. Unknown/duplicate
decisions or renamed catalog definitions fail validation. For the five identifiers
missing from the historical catalog, explicitly supply the school-approved label
for that exact existing source category/slug. A false or omitted approval remains
a strict blocker. This workflow does not support silently remapping categories or
slugs; if those are wrong, obtain a corrected authoritative handoff and provenance.

## Dry-run, review, then apply

Create `/private` as a private directory accessible only to the operator. Report
files must be new paths outside git; they are created with mode `0600` and never
overwritten. Use the same input and target arguments for dry-run and apply:

```bash
pnpm uswag:setup --dry-run \
  --input-dir /private/uswag \
  --database-env USWAG_SETUP_DATABASE_URL \
  --group-approvals /private/uswag-group-approvals.json \
  --report /private/uswag-review.json

pnpm uswag:setup --apply \
  --input-dir /private/uswag \
  --database-env USWAG_SETUP_DATABASE_URL \
  --group-approvals /private/uswag-group-approvals.json \
  --approval-report /private/uswag-review.json \
  --backup-confirmed \
  --report /private/uswag-completion.json
```

Before group approvals exist, omit `--group-approvals` to obtain a complete blocked
dry-run. Exit `2` means a valid plan contains blockers, `1` means validation/apply
failed, and `0` means the dry-run or apply completed. Event readiness is separate:
a committed roster does not mean the event is approved or live.

Review the **entire private report**, not just console totals. It must contain 95
source rows, 94 approved and one held; group creates/reuses; 94 student actions;
and 94 officer memberships with exact source rows and positions. Group totals are
SSC 13, SSLG 26, CS 14, BA 11, YHS 13, CCJ 12 and House Lords/Ladies 5. Check all
blockers and event readiness before accepting the report. Reports contain student
identifiers and source details: never publish, paste into issues, or commit them.
Console output contains aggregates, a fingerprint and the private report path.

The fingerprint binds exact inputs, group approvals, connected target, current
roster/groups/memberships/events and planned actions. Apply rebuilds the plan after
obtaining the shared application roster lock exclusively and freezing write tables.
Any intervening relevant change rejects the review as `STALE_REVIEW`. Generate a
new report path, rerun the same dry-run command and review again. A second fresh
dry-run/apply is idempotent; unchanged rows keep their timestamps, IDs and positions.

All blockers prevent **every** setup write, including group creation. An existing
student is selected only by approved exact USN. Conflicting names/identifiers,
nonblank academic values, permanent houses, other custom organizations or nonempty
positions are held for review. Nothing is automatically moved, replaced or deleted.
Blank source fields preserve existing values and unrelated academic joins. The
current database permits one custom organization per student; supporting multiple
organizations requires a separately reviewed application/schema change. Attendance
and QR identity are never rewritten. The held attendee never receives a placeholder
student; a future identity resolution needs a newly reviewed authoritative scope.

## Optional event setup through the same command

Without event options, the tool discovers USWAG-title events and checks a unique
candidate. Multiple candidates require an explicit ID. Missing scheduling/ownership
information remains outstanding; no event is invented. To select a known event,
create a private JSON file containing `{"id":"<event-id>"}` and add
`--event-options /private/uswag-event.json` to **both** commands above.

To create an event, supply explicit verified details instead:

```json
{
  "create": {
    "title": "USWAG 2026",
    "ownerId": "<authorized existing owner ID>",
    "location": "<verified venue>",
    "start": "2026-11-01T09:00:00+08:00",
    "end": "2026-11-01T12:00:00+08:00"
  }
}
```

The dates above are illustrative, not an approved schedule. The owner must be an
active ORGANIZER/ADMIN without a required password change. The operator must have
authorization to create the owner's event. Creation uses the app's validation and
creates an owned **DRAFT**, including all seven custom groups. Submission and admin
approval use the existing app workflow; this CLI never approves or edits an existing
event. Repeating the create configuration reuses a discovered event rather than
creating another one. Readiness checks exact eligible membership, not just counts;
extra existing officers are preserved and block readiness, while safe approved
roster additions may still commit. Review event reasons even after a successful apply.

## Failure and recovery

Apply rolls back every setup stage on an error before COMMIT. Reports distinguish
`rolled-back` from `rollback-unconfirmed`. Connection loss while COMMIT is in flight
produces `unknown-commit` and `COMMIT_OUTCOME_UNKNOWN`; the transaction may have
committed. If COMMIT succeeded but report writing failed, the CLI reports
`COMMITTED_REPORT_FAILED`. A synced `commit-pending` report may remain on disk if
the process was killed. **Never assume these cases rolled back or blindly replay
an old approval.** Restore connectivity, run a new read-only dry-run and inspect
the current state. Review/apply that fresh report if anything remains outstanding.
Normal database session termination rolls back an open, uncommitted transaction.

The tool does not deploy, migrate schema, alter the demo seed, submit/approve
events, or merge code. Run it against a populated database only after separate
authorization and backup verification.
