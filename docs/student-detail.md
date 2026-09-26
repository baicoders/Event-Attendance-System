# Staff student record

`/students/[id]` is a permanent staff route. It uses the existing student QR (the exact student ID) and the Student Attendance History panel. Overview shows current raw group memberships; history retains its own recorded versus current-roster labels. Roster links carry only a validated return path and recognized roster filters.

## Identity and edit API

`GET /api/students/{id}` requires an active organizer or admin. It returns the existing flattened student fields and raw `groups`, plus `editVersion`. The response is private and uncached. The token is a SHA-256 content validator over student identity, timestamps, editable scalars, and sorted group IDs/categories/slugs. Group display names and timestamps are excluded. It is not a credential, audit revision, or guarantee against a change-and-revert to identical content.

`PATCH /api/students/{id}` accepts:

```json
{
  "expectedVersion": "64-character lowercase hexadecimal token from GET",
  "student": { "id": "same ID as the route", "firstName": "...", "lastName": "...", "middleName": "", "schoolLevel": "COLLEGE", "yearLevel": "YEAR_2", "section": "...", "house": "...", "department": "...", "program": "...", "strand": "" }
}
```

The `student` fields follow `studentSchema`. Extra fields, mismatched IDs, invalid groups, and invalid student values are rejected. The transaction rechecks the principal and current student, compares the token, validates groups, then updates only the existing student and its groups. It never creates a student or changes attendance. An unchanged save returns `changed: false` without updating `updatedAt`; a changed save returns the authoritative flattened student, raw groups, and a new `editVersion`.

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_STUDENT_EDIT` / `STUDENT_ID_MISMATCH` / `INVALID_GROUPS` | The submitted fields, ID, or group choices cannot be used. |
| 401 / 403 | Auth code | The session is missing or no longer active. |
| 404 | `STUDENT_NOT_FOUND` | The student was deleted or never existed. |
| 409 | `STUDENT_EDIT_CONFLICT` | The current content differs from the editor's token. Reload before saving. |
| 409 | `STUDENT_GROUP_REVIEW_REQUIRED` | Raw memberships cannot be represented by the single-value editor. |

The existing POST upsert stays available to roster/import callers. PATCH protects its own edit against a write that happened before its transaction; a later authorized POST can still change the student. After an uncertain network outcome, the page keeps the form values and asks for a fresh read rather than automatically retrying.

## Verification

Run `DATABASE_URL=file:/tmp/student-detail-test.db node --import tsx --test globals/utils/studentDetail.test.ts globals/utils/studentEdit.test.ts` for content and real-adapter transaction tests. After `pnpm build`, run `node scripts/test-student-detail.mjs --browser` for disposable production API and Chrome checks. The fixture creates its own temporary SQLite database and removes it afterward.
