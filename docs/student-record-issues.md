# Address Student Record Issues

Administrators can open Student management → **Address Student Record Issues**
(`/students/issues`) to review total, complete and incomplete student counts.
Filters include school level, issue, missing House, missing identifier type,
completeness, known program/year/section, and name/USN/LRN search.

Open **Edit record**, supply confirmed information, then save. The profile badges
update from the saved record. Returning to the filtered issue list preserves the
filters and reloads current roster data. A resolved issue disappears immediately.
Group selections use configured groups; no school mappings are guessed.

Completeness requires House, section, school level and year level; known College
records additionally need program and department, and known SHS records need strand.
Middle name remains optional. Either USN or LRN is sufficient at any school level;
an LRN-only student has no missing-USN issue merely for lacking USN. Both identifier
flags apply only to legacy records with neither identifier. Dedicated missing-USN
and missing-LRN filters still help find records to enrich without declaring those
legitimate identities invalid. Employee memberships are excluded from student issues.

Issues are derived by the centralized `getStudentDataIssues` function whenever
records are displayed, rather than stored in the database. Manual edits, CSV
imports and bulk group assignments therefore cannot leave persisted flags stale.
Existing roster cache invalidation refetches active lists after writes.

These are completion tasks, not attendance blocks. Partial students can attend
ALL events; scoped attendance continues to require actual known memberships.
The interface does not fill missing data, infer school levels or make assignments.
