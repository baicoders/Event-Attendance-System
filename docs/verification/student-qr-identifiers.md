# Student directory actions and paired QR identifiers

## Behavior

Manage, Address Student Record Issues, and Import now share the directory header. Manage opens the QR center. The two administrative actions retain their active-admin visibility and existing server authorization.

QR cards encode USN by default, or LRN when no USN exists. The QR center's Preferred QR identifier control changes preview cards, modal cards, and the printed grid together. Each card labels the identifier actually encoded. When the preferred identifier is absent, the card uses the other available identifier. Records with neither external identifier retain their existing internal-ID QR fallback.

Student profiles and QR dialogs offer a selector when both identifiers exist. A profile's larger QR dialog retains its selected identifier. The same dialog is reused by student lists and attendance screens.

## Pairing audit

- `Student.usn` and `Student.lrn` remain distinct fields. Student IDs remain the canonical keys for links, memberships, imports, and attendance records.
- `studentRecordSchema`, student create/edit services, and reviewed import classification preserve both identifier strings and reject duplicate or split identities. Partial edits do not erase an unspecified paired identifier.
- `resolveStudentIdentity` resolves internal ID, USN, and LRN together and rejects ambiguous matches. Both scanned and manual attendance reach this resolver, then enforce the same event eligibility before writing one canonical attendance record.
- QR card generation now uses `resolveQRIdentifier`; no numeric conversion occurs, so leading zeros are preserved.
- QR roster search, manual attendance search, event audience/progress/review searches, and student CSV export already support both fields. Single-record URLs continue to use canonical IDs; lookup hooks encode path/query values safely.
- Existing internal-ID QR codes remain accepted by the existing attendance lookup.

Changing an external identifier changes its QR payload; reprint cards that use the changed identifier. Switching the displayed identifier does not edit the student or attendance data.

## Verification

- 3 QR rendering tests check encoded SVG data against the selected USN/LRN, fallback behavior, leading zeros, and preview/print consistency.
- 4 existing QR scope/search tests pass.
- 34 focused tests pass across student validation, partial edits, identifier migration, import classification/upsert, manual search, and scanner coordination.
- TypeScript, scoped ESLint, production build, and independent code review pass.
- The disposable API/browser fixture verifies desktop/mobile header placement, admin/organizer visibility, paired profile/modal choices, mixed-roster fallback, printed QR payloads, identifier lookup/search/export, and one attendance record for both codes.
- The fixture rasterizes the actual displayed/printed SVGs and decodes them using the scanner's already-installed ZXing dependency. Both decoded values successfully record attendance against the same canonical student.

```bash
node --import tsx --test features/students/components/StudentQRCard.test.ts features/students/utils/qrScope.test.ts
# After a production build; creates and cleans its own migrated test database:
BROWSER=1 TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres' \
  node scripts/test-student-identifiers-api.mjs
```

Screenshots: `/tmp/student-directory-actions-desktop.png` and `/tmp/student-directory-actions-mobile.png`.

No schema migration, production write, or real student import is required for this change. Existing workbook and review files were preserved.
