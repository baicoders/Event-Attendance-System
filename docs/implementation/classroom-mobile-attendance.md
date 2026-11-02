# Mobile classroom attendance

Teachers use the deployed HTTPS website. They never install or run a development server. Open My Classes → Start Attendance (or Continue active session) → scan existing student QR codes or use Manual roster → review and finalize. The Attendance navigation shows the same saved classes with direct meeting actions. Class detail retains paginated meeting history, including finalized and canceled meetings.

Start previews use the saved combined-section roster, persistent exceptions and live student fingerprint. The datetime input explicitly means Asia/Manila, independent of device timezone. Each legitimate later meeting has a fresh Start UUID; an uncertain Start keeps its original UUID, including across reloads, so a finalized meeting on another device cannot accidentally become a new meeting during recovery.

## Confirmation and recovery

`scanCoordinator.ts` owns bounded already-sent command recovery; it is **not an offline queue**. It writes an actor/resource-scoped descriptor to this tab's sessionStorage before sending. A descriptor contains the original UUID and necessary payload (including an excuse note or correction reason when supplied), never credentials or a full roster. Up to three writes may be in flight, with at most eight unresolved commands. The camera pauses while a save needs confirmation. Manual rows show their pending state and cannot be resubmitted while unresolved.

Only a valid server acknowledgment for the expected session/student/operation produces confirmed feedback. Malformed responses, connection failures and 5xx responses retain the descriptor. Reload restores descriptors without background writes. Explicit Check or retry first reads the actor-private command receipt, reauthorizing current access and ownership. A matching receipt confirms without another mutation. A missing receipt is only an observation; the client retries the original request and UUID to serialize with a possible in-flight commit.

An authoritative domain rejection after the server command mutex and receipt-absence check returns `details.commandSettled=true` after transaction rollback. This settles an earlier uncertain attempt. Preauthorization, schema and rate-limit errors do not make that claim; a retry429 cannot erase an earlier unknown success. Receipt reads remain available outside the scan rate bucket. Read DTOs or recovered older acknowledgments cannot overwrite a higher known attendance revision. Lost authorization hides private data and clears private recovery descriptors. Ordinary connectivity loss retains them. SessionStorage lasts for the tab lifetime; closing the tab loses local recovery descriptors, while committed attendance remains in the database and is visible on reopening the class.

Descriptors are not expired on a timer: silently discarding an uncertain Start or correction would undermine same-key recovery. Bound count/size and explicit logout cleanup control storage. No teacher-facing message claims offline attendance or a local-network workflow.

## Manual workflow

Cards have 48px actions and accessible student-specific names, with name/USN/LRN from the historical meeting snapshot. Search, all five status filters, excluded-student review and pagination are server-side; the default page is100. Query keys include actor, session, search, filter and page. A confirmed change preserves current filters and search, keeps stable student row keys, and anchors the first remaining visible row when a filter removes a marked student. A higher row revision protects against old receipt replay.

First marks can be Present, Absent, Late or Excused. Excused has an optional note. Changing an already-marked result or any finalized result requires a reason. The correction sheet retains its draft when a save fails; a revision conflict requires reviewing the new result before opening a fresh correction. Excluded members can be inspected and explicitly included/excluded with a reason. A finalized inclusion requires a historical outcome. Canceled sessions retain results for accountability, expose no editing controls, and produce no new absences.

Unknown/retired/ambiguous QR codes display the specific server error. A recognized student outside the snapshot opens an explicit choice: this session only, permanent addition with optional current-session inclusion, or Cancel. Replacing a permanent exclusion requires confirmation. Future-only inclusion explicitly reports that no current attendance was recorded. The original QR is re-resolved server-side if the teacher requests including and recording the scan together.

## Camera ownership

`globals/components/shared/qr/QrCamera.tsx` owns media streams and a serial decode loop using the existing pinned barcode-detector3.0.6/ZXing decoder, now a direct dependency. Decoder WASM remains at `/qr-decoder/`; no decoder CDN is needed. Camera opening is an explicit gesture. Permission failures, play/decode failures, route disposal, workspace/identity changes and late permission resolution stop owned tracks and suppress stale callbacks. Switching to Manual unmounts capture without replacing the session command coordinator. The Events wrapper retains its existing event/mode-aware scan gate and existing server workflows.

Installed @yudiel2.4.1 source inspection found its stop queue chained only to a fulfilled startup promise; a rejected play/start could strand a stream. The shared capture owner avoids that failure without patching node_modules. `cameraCapture.test.ts` exercises late permissions and failed play. Context7 had no matching indexed barcode-detector package; pinned installed declarations/source are the integration authority.

## First attendance and external release gates

Onboarding Ready offers Finish setup and start first attendance as well as returning to My Classes. The tutorial remains simulation-only. Real meeting guidance is derived from whether the teacher has a finalized owned meeting, so no onboarding lock is acquired after a Session lock and routine visits never force onboarding again.

Automated production-build tests use disposable PostgreSQL, a375px viewport, synthetic35/100/101/220 student classes, actual generated USN/LRN/internal-ID QR video frames, local WASM, and camera-denied fallback. Physical HTTPS iOS Safari and Android Chrome camera permissions/rotation/backgrounding, screen-reader usability and actual teacher trial sessions remain release gates. Browser emulation is not evidence of those physical-device/teacher outcomes.
