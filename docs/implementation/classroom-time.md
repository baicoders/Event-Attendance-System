# PostgreSQL instants and school time

All application PostgreSQL pools built with `getPgPoolConfig` pin the wire session timezone to UTC using startup options. The installed PrismaPg7.10 adapter serializes UTC datetime components without an offset and normalizes returned timestamptz text by replacing its offset with UTC. It therefore requires UTC sessions for correct physical instants. Keeping the database session in Asia/Manila can hide a storage shift on a simple ORM round-trip; a frozen JSON instant or independent SQL check exposes the error.

School policy and display remain Asia/Manila. Convert an explicitly offset meeting timestamp to an instant once, compare lateness using server instants, and derive school dates explicitly in Asia/Manila. `@db.Date` term boundaries remain school date values. Do not use device timezone, server wall-clock strings or PostgreSQL display timezone as classroom policy.

Existing URL startup options are preserved, with UTC appended last. The URL's options parameter is removed before pg parses the pool configuration, preventing it from replacing the effective object option. Verified remote TLS settings remain enforced. Hosting/poolers must accept or provide this UTC session contract; startup failure is preferable to silently shifted attendance.

Disposable database fixtures default to UTC so independent raw fixture pools match runtime behavior. The timestamp regression deliberately resets its own disposable database default to Asia/Manila, then proves both the returned Date and independently queried physical stored instant match the supplied UTC value through the configured runtime pool.

## Release gate: existing timestamps

No historical data is rewritten by this change. Before production rollout, record the actual deployment/database/pooler timezone and compare representative Events timestamps and reports with physical SQL instants on a sanitized restored backup. If old application connections were non-UTC, existing values may already have inconsistent interpretations. Do not infer a blanket eight-hour correction or automatically rewrite Event/Record/audit rows. Block rollout pending an evidence-backed reconciliation decision, preserve backups and the old output for comparison, and obtain separate authorization for any data correction.

If existing runtime sessions were UTC, this makes their assumed behavior explicit. Teacher phones still use the deployed HTTPS application; there is no device or local-server timezone configuration task for teachers.
