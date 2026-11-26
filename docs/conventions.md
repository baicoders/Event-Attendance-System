# Implementation conventions

Current November 2026 guidance. [Historical conventions](archive/pre-classroom/conventions.md) preserve background only; do not copy their obsolete authentication, QR, seed or deployment assumptions.

## Routes and capabilities

Use route groups `(auth)`, `(main)` Events, `(classroom)` Class `(classroom-access)` applications, `(classroom-admin)` administration, `(account)` identity settings and `(print)` bare server print. Keep existing Events URLs stable. API middleware enforces origin/cache policy, while route/service guards enforce permissions. Never infer authorization from workspace query/cookie/navigation or role names alone. Use identity-only guards for account/application actions, Events guards for legacy Events and explicit Class/admin guards otherwise. Teacher-only MEMBER users must fail every Events business endpoint.

Return shared ok/error envelopes via `respondWithError`; parse bounded bodies and Zod inputs before commands. Never return Prisma records containing password, sensitive notes or unrestricted relations as a convenience. Prefer explicit DTOs. Protected responses are private/no-store. A stale credential or revoked membership is rechecked inside the database operation, including receipt replay.

## Service writes

Class writes use `classroomCommand`, original UUID, normalized request hash, current actor and immutable audit in one transaction. Follow User→membership→command→roster→catalog/Class→Session→pair lock order, sorting peers. Do not acquire a broader lock after a narrower one. Do not retry an unknown commit with a fresh UUID. Expected revisions reject lost updates; conflict UI preserves drafts. Read code in the owning server module and real DB tests before adding a writer.

Student writes follow the shared [identity protocol](implementation/classroom-student-identity.md), including raw SQL/import/group joins. Never recycle or silently retarget a printed identifier; quarantine uncertainty. Never make teacher authorization imply admin import/delete/merge access. An audit row must commit or roll back with its data change, not be written afterward or only logged to stdout.

Use getPgPoolConfig for runtime/direct pg clients; it verifies remote TLS and pins UTC startup options required by the installed PrismaPg adapter. School display and date interpretation use Asia/Manila, never the browser default. Prisma schema-only constraints are insufficient where migrations add partial indexes/triggers/checks.

## Client behavior

Use the shared fetchApi, query keys, Query invalidation, forms/buttons/dialogs/toasts and design tokens. Class card/sheet interactions use48px targets and pages of 100 students. Preserve search/filter/page/scroll on marks. Preferences in URLs are allowlisted and never contain commands, codes or authorization claims. Clear private caches and camera state on identity/workspace changes.

Attendance never optimistically claims saved. Distinguish sending, acknowledged, failed and unconfirmed. Persist bounded unconfirmed descriptors before sending, keep original key/payload for explicit receipt-first retry, and warn that tab close/signout removes local recovery details. No automatic offline queue. Camera only captures strings; business resolution stays server-side. QrCamera owns cleanup, local WASM decoding and late permission-track disposal; do not reintroduce scan toggling or the old library's media lifecycle.

Use one historical Class report projector for JSON/CSV/print and require reportVersion for prepared exports. Keep Events report builders separate. Escape spreadsheet formula cells and preserve numeric identifiers using the documented text-prefix convention for Class attendance CSV; it is not a student import file. Print pages authenticate on the server and render through authorized loaders, outside the navigation shell.

## Tests and maintenance

Node's test runner plus tsx are the established suite. Server-only tests use `--conditions=react-server`; DB tests require explicit TEST_DATABASE_URL and unique disposable databases. Never run a destructive legacy fixture against DATABASE_URL or production. Wrap scripts that expect an existing app in an owned database/app harness. Run production browser tests only after the build finishes; never rebuild the shared .next while they run. See [testing](testing/classroom.md).

Use Conventional Commits. Keep migrations additive and immutable after application. Seed/reset commands are development fixtures, never rollout procedures. Use direct migration credentials and verified backup/restore evidence for release. Logs must not contain QR strings, notes, credentials, connection URLs or personal student payloads; monitor correlation/error codes and investigate through authorized audit UI.

Prefer repository source and pinned declarations for integration details. Fetch current official documentation through Context7 when consulting library APIs. Record behavioral changes and operational limits in the owning implementation document. Update contracts/tests together and preserve Events regression coverage.
