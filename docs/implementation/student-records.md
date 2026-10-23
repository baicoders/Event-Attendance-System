# Student records delivery (audit: origin/main ef0e8aa)

Dependency map: Student.id → Record / AttendanceChange foreign keys and QR payloads;
Student school/year enums and Group joins → audience filters, reports, bulk edits;
shared student validation → CRUD, bulk candidates, import classification and receipts.
Import preview uses RepeatableRead; commit rechecks actor and signed content after
command and roster locks, writes and immutable receipts share one transaction.
Existing import blanks overwrite scalar fields and replace all groups. Existing
student POST upserts by id. Both must change before partial records are operational.

Execution order:
1. Add nullable unique USN/LRN, nullable academics, a new partial-record contract,
   safe migration and null-safe consumers. Keep the legacy write contract until PR 2.
2. Switch CRUD to the new contract, preserve omitted edits and canonical IDs;
   update forms, identifiers, scanner validation and attendance lookup.
3. Version the import/receipt contract; match either identifier, block conflicts,
   preserve blank fields and group categories, bind all matches into stale review.
   Preserve v1 receipts and exact replay; update template and fixtures.
4. Compute context-aware issues on read and add a searchable management view.

Identifier policy: existing documented USNs are eleven-character text (including
alphanumeric values). LRN is exactly twelve digits per DepEd Order 22 s. 2012:
https://www.deped.gov.ph/2012/03/20/do-22-s-2012-adoption-of-the-unique-learner-reference-number/
No padding/truncation. No school dataset is present in the repository; school USN
rules and mappings still need confirmation against the actual files.

Migration backfills only eleven-digit legacy IDs, excluding the library branch's
`employees` membership. Other legacy IDs remain untouched and unclassified rather
than guessed. All internal IDs, timestamps, joins and history remain unchanged.
At-least-one-identifier is enforced by the new normal-student write contract;
legacy/unclassified people and employees may exist without either external ID.
A universal database CHECK would break employee registration and legacy records.

Library is absent from main. library-mvp registers employees as Student rows marked
by a SECTION group with slug employees; it scans by internal ID. Preserve that
namespace and do not bring the unmerged feature into these PRs. Integration with
that branch needs a subsequent compatibility check before deployment together.

Verification uses synthetic fixtures and disposable test databases exclusively.
PRs stack in the order above and must not be merged without approval.

PR 1 submitted: https://github.com/baicoders/Event-Attendance-System/pull/107
(56e5983). 167 tests plus export regression, TypeScript, changed-file ESLint and
production build passed. Review nullable-consumer findings were fixed.

PR 2 activates the partial contract only for CRUD and bulk candidates. The v1
import/receipt validator is frozen in legacyStudentSchema until PR 3 versions it.
POST now creates only (duplicates require explicit edit); PATCH merges omitted
fields under the roster lock, supports explicit null clearing, and revalidates the
complete candidate. USN/LRN conflicts include legacy internal-ID namespace matches.
