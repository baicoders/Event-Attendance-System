# Issue 67: Event audience preview

The event form now shows the current eligible student count and a searchable,
paginated roster before the event is saved. Search changes the preview page and
match count only; it never changes the event scope. The preview is advisory:
later roster or group edits can change eligibility. It creates no event or
attendance records.

The shared eligibility filter now returns the documented school-level audience
for `COLLEGE` and `SHS` events with no groups. This also changes current results
for existing events in attendance lookup, stats, and reports. Historical records
and group assignments are not rewritten. Scoped categories remain a union of
selected groups and fail closed when no groups remain. `YEAR` still matches
YEAR-group membership, which current roster writes do not populate; the form
explains this limitation rather than mapping group names to `Student.yearLevel`.

The API accepts only category, group IDs, optional editable event ID, bounded
search, page, and page size. It returns total eligible and search-match counts
separately, plus a 50-row default page (100 maximum), scope signature, and
evaluation timestamp. Count and page are read in one transaction. New-event
preview requires an active organizer or admin. Existing edit preview uses the
same owner and lifecycle gates as event editing. A read-only saved-event view
does not offer unsaved-scope preview.

## Verification

Focused tests:

```bash
node --import tsx --test globals/utils/buildEventStudentFilter.test.ts globals/schemas/audiencePreview.test.ts
```

API fixture on a disposable database (run from the repo root):

```bash
DATABASE_URL=file:/tmp/issue67-audience-integration.db node_modules/.bin/prisma db push
DATABASE_URL=file:/tmp/issue67-audience-integration.db AUTH_SECRET=local-audience-verification-secret pnpm build
DATABASE_URL=file:/tmp/issue67-audience-integration.db AUTH_SECRET=local-audience-verification-secret PORT=3100 node_modules/.bin/next start
# In another shell:
DATABASE_URL=file:/tmp/issue67-audience-integration.db AUDIENCE_TEST_BASE_URL=http://127.0.0.1:3100 node --import tsx scripts/test-audience-preview.ts
```

The fixture verifies all nine categories against saved-event student lookup
and attendance writes, duplicate group IDs, group union, leading-zero IDs,
search count vs total count, 1-row pages, empty and invalid group scopes,
YEAR messaging, and active/anonymous/inactive/owner/non-owner/admin access. It expects
an otherwise empty disposable database; use a fresh scratch file per run when
checking exact counts. Type-check and production build passed. Focused lint on
the new preview files passed; repository-wide lint still reports 13 existing
errors in other files.

At 2,003 students in the disposable SQLite database, six warm production HTTP
requests on this development laptop measured a 21.3 ms median for count-only
and 24.9 ms for a 50-row first page (`ALL` scope). These are local observations,
not service-level targets.

The create drawer was exercised at 375 px in Chromium: count, preview open,
student-ID search, close, preserved title, no event created by preview, and
submit for review. The page had no horizontal overflow. A draft edit drawer
was also opened at desktop width; its count and roster loaded, and closing
the preview preserved the title.
