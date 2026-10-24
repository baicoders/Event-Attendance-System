# Synthetic student import service scale evidence

Run: `node --conditions=react-server --import tsx scripts/benchmark/student-import-scale.ts`.

This recorded run used local TCP PostgreSQL on port 5433. A production application build and other development verification ran concurrently on the same host, so the timings include that contention. The script also reports local versus remote database transport on future runs.

Each size provisions and drops its own migrated `test_import_scale_*` PostgreSQL database through TEST_DATABASE_URL. No production or enrollment data is used. Dataset: 50% new, 25% safely updated academic/identifier information, 25% unchanged; USN-only college, LRN-only SHS, and dual identifiers. Existing blank optional cells preserve academic values, house/section, middle name, custom Treasurer membership, attendance and internal QR IDs.

| Rows | Preview ms | Commit ms | Commit queries | Sampled peak process RSS MiB | Peak importer pool connections |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 | 466.32 | 1918.08 | 29 | 232.48 | 1 |
| 3000 | 411 | 3775.8 | 63 | 330.64 | 1 |
| 5000 | 1455.82 | 8848.96 | 101 | 447.01 | 1 |
| 10000 | 1717.99 | 11383.61 | 188 | 650.28 | 1 |

This exercises the real parser/classifier/preview/commit/receipt service and PostgreSQL adapter; it is not an HTTP/browser end-to-end test. PostgreSQL uses the explicitly configured test connection (no injected latency). Durations include development-host scheduling and local contention; they are not production capacity promises. Setup/migrations/verification reads are excluded from preview/commit times. Query counts come from Prisma query events and include transaction/control/state/receipt statements. Write SQL duration sums only INSERT/UPDATE/DELETE query events and is not the whole commit duration. Parsing+hash and classification/state timings are additional isolated passes, not additive components of measured service time. Tentative batch intervals start at the first observed Student SQL write (first event end minus its duration), then use actual progress callbacks; they include inter-statement JavaScript work and exclude final receipt/COMMIT. All progress remains tentative until the transaction commits.

RSS and database activity are sampled every 20 ms with no overlapping observer query; synchronous JavaScript can delay sampling, so reported peaks are sampled lower bounds, not hard ceilings. Process RSS includes the harness, synthetic datasets, prior-size heap retention and service; it excludes PostgreSQL memory. Import pool is configured to at most two connections, observer has a separate one-connection pool. Active importer backend count comes from pg_stat_activity. No baseline comparison is fabricated; previous documented HTTP-only measurements have a different workload/environment.

Environment:

```json
{
  "measuredAt": "2026-10-24T16:15:44.660Z",
  "node": "v22.19.0",
  "platform": "linux 6.8.0-138-generic",
  "cpu": "Intel(R) Core(TM) i5-8350U CPU @ 1.70GHz",
  "logicalCpus": 8,
  "hostMemoryMiB": 11703.02,
  "importPoolMax": 2,
  "observerPoolMax": 1,
  "sampleIntervalMs": 20,
  "batchSize": 250,
  "memoryObservation": "Sampled RSS may miss synchronous peaks. processLifetimeHighWaterRssMiB is the OS high-water RSS since process start (including setup and previous sizes), from process.resourceUsage().maxRSS on Linux.",
  "postgresVersion": "PostgreSQL 17.11 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit"
}
```

Raw measured results:

```json
[
  {
    "rows": 1000,
    "counts": {
      "total": 1000,
      "create": 500,
      "update": 250,
      "unchanged": 250,
      "blocked": 0
    },
    "csvBytes": 61504,
    "parsingAndHashMs": 104.59,
    "isolatedStateReadMs": 298.01,
    "isolatedClassificationMs": 132.37,
    "isolatedStateQueries": 8,
    "previewMs": 466.32,
    "previewQueries": 10,
    "commitMs": 1918.08,
    "commitQueries": 29,
    "writeQueries": 8,
    "writeSqlDurationMs": 595.59,
    "tentativeBatchIntervalsMs": [
      204.97,
      362.73,
      342.48
    ],
    "peakRssMiB": 232.48,
    "processLifetimeHighWaterRssMiB": 588.07,
    "initialRssMiB": 209.7,
    "sampledRssIncreaseMiB": 22.78,
    "peakPoolConnections": 1,
    "peakActiveConnections": 1,
    "samples": 61,
    "exactReplayMs": 80.11,
    "exactReplayQueries": 5,
    "assertions": "Exact counts, repeated preview unchanged, exact replay zero writes, stable existing IDs/timestamps/academic groups, attendance and custom position retained; unique USN/LRN; one receipt"
  },
  {
    "rows": 3000,
    "counts": {
      "total": 3000,
      "create": 1500,
      "update": 750,
      "unchanged": 750,
      "blocked": 0
    },
    "csvBytes": 186539,
    "parsingAndHashMs": 55.53,
    "isolatedStateReadMs": 258.04,
    "isolatedClassificationMs": 110.41,
    "isolatedStateQueries": 18,
    "previewMs": 411,
    "previewQueries": 20,
    "commitMs": 3775.8,
    "commitQueries": 63,
    "writeQueries": 22,
    "writeSqlDurationMs": 1586.45,
    "tentativeBatchIntervalsMs": [
      133.01,
      135.39,
      204.72,
      284.46,
      269.14,
      258.02,
      304.4,
      296.42,
      353.34
    ],
    "peakRssMiB": 330.64,
    "processLifetimeHighWaterRssMiB": 588.07,
    "initialRssMiB": 304.49,
    "sampledRssIncreaseMiB": 26.15,
    "peakPoolConnections": 1,
    "peakActiveConnections": 1,
    "samples": 140,
    "exactReplayMs": 189.75,
    "exactReplayQueries": 5,
    "assertions": "Exact counts, repeated preview unchanged, exact replay zero writes, stable existing IDs/timestamps/academic groups, attendance and custom position retained; unique USN/LRN; one receipt"
  },
  {
    "rows": 5000,
    "counts": {
      "total": 5000,
      "create": 2500,
      "update": 1250,
      "unchanged": 1250,
      "blocked": 0
    },
    "csvBytes": 311562,
    "parsingAndHashMs": 230.28,
    "isolatedStateReadMs": 601.41,
    "isolatedClassificationMs": 327.53,
    "isolatedStateQueries": 30,
    "previewMs": 1455.82,
    "previewQueries": 32,
    "commitMs": 8848.96,
    "commitQueries": 101,
    "writeQueries": 36,
    "writeSqlDurationMs": 3620.83,
    "tentativeBatchIntervalsMs": [
      197.16,
      239.71,
      205.4,
      213.91,
      238.48,
      373.64,
      446.44,
      492.77,
      447.6,
      556.61,
      343.19,
      439.66,
      360.3,
      502.58,
      636.76
    ],
    "peakRssMiB": 447.01,
    "processLifetimeHighWaterRssMiB": 588.07,
    "initialRssMiB": 379.7,
    "sampledRssIncreaseMiB": 67.31,
    "peakPoolConnections": 1,
    "peakActiveConnections": 1,
    "samples": 292,
    "exactReplayMs": 475.4,
    "exactReplayQueries": 5,
    "assertions": "Exact counts, repeated preview unchanged, exact replay zero writes, stable existing IDs/timestamps/academic groups, attendance and custom position retained; unique USN/LRN; one receipt"
  },
  {
    "rows": 10000,
    "counts": {
      "total": 10000,
      "create": 5000,
      "update": 2500,
      "unchanged": 2500,
      "blocked": 0
    },
    "csvBytes": 624154,
    "parsingAndHashMs": 301.37,
    "isolatedStateReadMs": 852.77,
    "isolatedClassificationMs": 442.26,
    "isolatedStateQueries": 56,
    "previewMs": 1717.99,
    "previewQueries": 58,
    "commitMs": 11383.61,
    "commitQueries": 188,
    "writeQueries": 71,
    "writeSqlDurationMs": 5252.28,
    "tentativeBatchIntervalsMs": [
      142.56,
      130.42,
      168.13,
      164.9,
      193.58,
      162.17,
      149.19,
      120.3,
      131.48,
      136.18,
      196.59,
      244.75,
      240.78,
      235.06,
      267.89,
      249.22,
      299.82,
      340.73,
      314.16,
      209.5,
      282.55,
      342.47,
      521.34,
      445.83,
      540.15,
      299.83,
      315.66,
      330.61,
      219.11,
      309.16
    ],
    "peakRssMiB": 650.28,
    "processLifetimeHighWaterRssMiB": 650.28,
    "initialRssMiB": 447.23,
    "sampledRssIncreaseMiB": 203.05,
    "peakPoolConnections": 1,
    "peakActiveConnections": 1,
    "samples": 468,
    "exactReplayMs": 452.53,
    "exactReplayQueries": 5,
    "assertions": "Exact counts, repeated preview unchanged, exact replay zero writes, stable existing IDs/timestamps/academic groups, attendance and custom position retained; unique USN/LRN; one receipt"
  }
]
```
