# Classroom external release acceptance record

Status: **NOT RUN — production release blocked pending evidence and explicit authorization.** Automated localhost/fake-camera tests do not satisfy this record. Use anonymized participant/device labels; store no real QR codes, student names, credentials or excuse notes here.

## Deployed device matrix

| Device / browser | School Wi-Fi HTTPS | Mobile internet HTTPS | Existing ID/USN/LRN cards | Denial/manual | Background/rotation/close | Failed-save same-key retry | Result/evidence |
|---|---|---|---|---|---|---|---|
| Actual iPhone / supported Safari, version TBD | Not run | Not run | Not run | Not run | Not run | Not run | Required |
| Actual Android / supported Chrome, version TBD | Not run | Not run | Not run | Not run | Not run | Not run | Required |

Also inspect local decoder asset requests, no external decoder dependency, site camera permission, rear-camera focus,48px actions,375px no page-level horizontal scrolling,200% text/zoom, keyboard labels and a representative screen-reader path. Record deployed revision/origin, browser/OS, dates and sanitized screenshots. Confirm camera indicator ends on close, navigation, workspace change, signout and late permission resolution. Confirm no success while disconnected; reload recovery must retain original request identity. Do not substitute insecure-origin browser flags for deployed HTTPS.

## Unfamiliar-teacher trials

At least three approved teachers unfamiliar with this application. Give only the public site and guide; no coaching after approval. Obtain appropriate participation agreement. Target first acknowledged mark within 10 minutes of approval; record actual time, errors, help requests and whether each teacher independently completes the flow. Failed trials require fixes/retest before general release.

| Participant | Device | Onboarding resumed | Combined sections + saved irregular/exclusion | Start → QR → manual → finalize | First mark minutes / help | Return tomorrow | Result |
|---|---|---|---|---|---|---|---|
| T01 | TBD | Not run | Not run | Not run | Not measured | Not run | Required |
| T02 | TBD | Not run | Not run | Not run | Not measured | Not run | Required |
| T03 | TBD | Not run | Not run | Not run | Not measured | Not run | Required |

Verify no development commands, local network setup or repeated administrator approvals. Record setup mistakes/recovery, optional excuse note, reasoned correction, lost acknowledgment/retry and report export. Automated forty-meeting persistence is supplemental evidence, not a substitute for a teacher returning successfully.

## Acceptance trace

| Scenario | Implementation / automated evidence | External signoff |
|---|---|---|
| A | membership/application/API boundary and dual-workspace suspension suites | Pilot access reviewer |
| B | composeRoster/classes/session DB tests; saved exceptions and40 meetings | Teachers verify their roster |
| C | session snapshot/report DB tests for midterm join and section edits | Historical sample reviewed |
| D | identity migration/reservation tests, scan concurrency, receipt/mobile QR tests | Actual cards on both devices |
| E | session/attendance DB barriers and375px mobile statuses/finalize/retry tests | One-handed teacher trial |
| F | student conflict/history/verification DB/API and admin monitoring | School field/privacy policy confirmed |
| G | shared report projector/CSV/print/version/ownership DB/API/browser tests | School convention acknowledged |
| H | guided onboarding/resume + first meeting/browser/manual fallback | All physical-device and T01–T03 rows required |

Operator gates: hosted timezone/history audit, real topology/pooler/TLS, restricted runtime grants, backup offsite restore, valid migrations/indexes, compatible rollback smoke, flag-off/revocation, final code review and explicit production release authorization. Attach dated evidence and named signoff; blank/Not run is never a pass.
