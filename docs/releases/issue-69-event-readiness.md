# Issue 69: Event readiness

Saved event details and the selected attendance event expose the same on-demand
checklist. It reports approval, current audience and roster count, schedule,
owner, and recording mode. Only approval reflects the existing event-level
recording gate. The other warnings are advisory. Time-out still requires a
prior time-in for each student, and scheduled dates do not constrain scans.

The server reads event metadata, validates the saved scope, and counts matching
students in one short transaction. It reuses Audience Preview's canonical
filter, returns no roster or attendance records, and writes no readiness state.
All-day schedule ordering uses Manila calendar dates, including at month
boundaries; equal timed instants remain valid. Existing event write validation
is unchanged.
The count can change after a roster edit on another device; the timestamp and
Check again button make that visible. Cached results are labeled as previous
checks during refresh or after a failed refresh. The checklist does not test camera,
network, backup, or device clock readiness.

## Verification

Run focused tests and static checks from the repository root:

```bash
pnpm exec tsx --test globals/utils/eventReadiness.test.ts globals/utils/buildEventStudentFilter.test.ts globals/schemas/audiencePreview.test.ts
TZ=UTC pnpm exec tsx --test globals/utils/eventReadiness.test.ts
pnpm exec tsc --noEmit
pnpm exec eslint app/api/events/'[eventId]'/readiness/route.ts globals/utils/eventReadiness.ts globals/utils/eventReadiness.test.ts globals/utils/audiencePreview.ts globals/hooks/useEventReadiness.ts features/calendar/components/EventReadinessPanel.tsx features/calendar/components/EventDrawer.tsx features/attendance/components/AttendancePageHeader.tsx globals/hooks/useGroups.ts globals/utils/queryKeys.ts
DATABASE_URL='file:/tmp/event-readiness-issue-69.db' pnpm build
```

Run the HTTP fixture only against a disposable database. The seed deletes all
rows in its target, and the fixture creates saved events for its role checks.

```bash
DATABASE_URL='file:/tmp/event-readiness-issue-69.db' pnpm exec prisma db push
DATABASE_URL='file:/tmp/event-readiness-issue-69.db' pnpm exec prisma db seed
DATABASE_URL='file:/tmp/event-readiness-issue-69.db' AUTH_SECRET='disposable-readiness-test-secret-69' pnpm start --port 3109
# In another shell:
python3 scripts/verification/check-event-readiness-api.py
```

The fixture compares readiness with Audience Preview across all nine event
categories, checks that repeated reads leave business rows unchanged, checks
anonymous/inactive/owner/admin/shared-event visibility, confirms a nonowner
cannot manage mode, verifies time-out wording, and checks that the response
contains no owner email or password.
It uses the seed's local admin and organizer accounts. Its default URL and DB
can be changed with `READINESS_BASE_URL` and `READINESS_DB`.

The Audience Preview regression fixture was also run against a fresh
`file:/tmp/issue67-audience-readiness.db` database and a server on port 3110:

```bash
DATABASE_URL='file:/tmp/issue67-audience-readiness.db' pnpm exec prisma db push
DATABASE_URL='file:/tmp/issue67-audience-readiness.db' AUTH_SECRET='disposable-readiness-test-secret-69' pnpm start --port 3110
# In another shell:
DATABASE_URL='file:/tmp/issue67-audience-readiness.db' AUDIENCE_TEST_BASE_URL='http://127.0.0.1:3110' pnpm exec tsx scripts/test-audience-preview.ts
```

Browser walkthrough: the approved event checklist was opened in attendance at
390 px in headless Chrome. The drawer was opened at 390 px and its refresh
button was confirmed enabled outside the fieldset. A delayed refresh marked
cached data as a previous check; a blocked request showed the persistent
failure warning, and Check again recovered after network access was restored.
Both views had 390 px document width with no horizontal
overflow. A desktop calendar drawer displayed the same panel. The attendance
disclosure opened with a focused button and Space key. Camera permission, a
physical scan, and venue network checks were not exercised.
