# Reviewed USWAG setup

## Intent and approved scope

Implement the supplied USWAG setup specification as one CLI: verify private
sources, plan prerequisite groups, upsert 94 approved students, assign seven
officer groups and workbook positions, and assess event readiness. Default is
read-only; apply requires review of the exact dry-run. One source attendee stays
held without a placeholder identity. No populated database runs, deployment,
main-branch integration, or private data in commits.

## Approach

Extend the existing explicit-target USWAG safety pattern with a separate combined
setup entry point. Reuse the workbook reader, strict importer classification and
shared roster lock. Apply explicit additive writes rather than the bulk import
writer, which replaces academic joins. A sequence of independent imports cannot
provide atomicity. A destructive demo seed cannot preserve existing data.

The CLI accepts external workbook, manifest, provenance and reviewed group
catalog paths. Provenance binds exact SHA-256 file bytes and counts; manifest
source row, organization, attendee display and position must match the workbook.
Approved registrar identities resolve exclusively through exact USNs. Other
identifier namespaces are checked for conflicts, never used to select targets.
Approved display aliases are accepted without name-based lookup.
Excluded enrollment statuses are rejected before planning any writes.

## Plan and apply contract

Every group definition has an explicit category, name, slug and approval state.
Unknown, ambiguous or misclassified definitions block apply. The five permanent
houses are fixed. Existing groups are reused only when their identity agrees.
The 67 source-referenced academic groups and seven officer groups are planned
together. No guessing academic aliases or Grade 11 pathway semantics.

The plan includes creates/updates/no-ops and blockers for all 94 students and
memberships, plus the held source row and event readiness. Empty optional fields
preserve values. A conflicting existing academic value, permanent house,
identity or nonempty officer position is held for review rather than discarded.
Unrelated memberships and attendance remain untouched. Existing custom
memberships in another organization block apply under the current one-group
constraint; this task does not silently migrate schema or move memberships.

Dry-run uses a read-only repeatable-read transaction. Apply validates the actual
target endpoint, takes the exclusive roster lock and database locks protecting
planned state, rebuilds the plan and rejects a stale fingerprint before writing.
Fingerprint binds exact input bytes, target identity, full relevant before-state
and proposed operations. One transaction applies groups, student scalars, additive
academic joins and officer assignments; unchanged rows keep timestamps and IDs.
Local-only default; remote requires explicit permission and verified TLS using
existing database configuration. No implicit environment database fallback.

Private reports are exclusive-created mode 0600, with aggregate-only console
output and redacted failures. Reports distinguish blocked, rolled back,
committed, and unknown commit outcomes. Apply requires backup acknowledgement.

## Events

Without explicit event inputs report outstanding scheduling/ownership information.
Discover existing USWAG-title candidates read-only; multiple candidates require
an explicit event ID, and no selection silently skips a discovered event.
An explicit existing event is checked for CUSTOM scope, all seven intended groups,
exact approved roster (including extra-member detection), and approval status.
Optional creation accepts explicit title, owner, real start/end and location;
requires an active authorized actor and creates only an owned DRAFT through the
same lifecycle rules as the app. Submission/approval remains the app workflow.
Never edit an existing event audience or approve it implicitly.
Extra members in reused officer groups are preserved and reported as event
readiness blockers. They do not prevent the approved 94 roster additions unless
they conflict with an approved identity or assignment.

## Verification and delivery

Use synthetic 95-row workbooks/manifests, group catalogs and disposable migrated
PostgreSQL databases. Cover all-new/existing/mixed identities, blank preservation,
aliases, exact USN selection, conflicts, 67-group planning, seven membership
totals, event eligibility/positions, stale review, idempotence, concurrency,
rollback and interrupted transactions. Run focused checks, TypeScript, production
build and independent review. Deliver granular commits and one primary PR with
one operator runbook. Missing provenance/catalog or school semantic decisions
remain explicit input blockers; no production completion claim is made.
Before implementation inspect live branches and overlapping PRs. Reproduce the
67 required groups and 50 missing against a synthetic fresh-demo group catalog.

## Implementation choices

Keep TypeScript and node-postgres already used by the repository. Do not change
demo seed or database schema. Conservative academic conflicts block instead of
replacing nonblank existing memberships, preserving the requested information.
Private input formats are versioned and documented with synthetic examples.

## Handoff inspection

The complete handoff archive provides the missing provenance and catalogs. All
four supplied provenance checksums agree with their source files. The manifest
has 95 rows, 94 approved unique USNs and one held row. Workbook source rows,
attendee labels and positions agree. The required catalog contains 67 identifiers;
15 explicitly need semantic approval and the historical review decisions remain
pending. Inputs are available; those decisions must remain apply blockers until
recorded explicitly. The implementation must consume the supplied formats,
preserve their original hashes, and accept a separate source-bound private group
approval file rather than rewrite the provenance-bound originals.
