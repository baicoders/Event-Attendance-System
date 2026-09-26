/**
 * End-to-end benchmark for the student bulk import, driving the real API the
 * same way the UI does: login, POST the parsed roster to
 * /api/bulk-import/students, then inspect the database to verify the outcome.
 *
 * Requires the app to already be running (production build recommended) against
 * the same PostgreSQL database this script inspects:
 *   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/test_benchmark" pnpm start
 *
 * Usage (from repo root):
 *   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/test_benchmark" \
 *   npx tsx scripts/benchmark/http-import-benchmark.ts [fresh|rerun|invalid|all]
 *
 * Scenarios:
 *   fresh   POST the full 2,000-student roster to an empty Student table.
 *   rerun   POST the same roster again — must not create duplicates.
 *   invalid POST the roster with one bad group slug — must reject the whole
 *           batch (all-or-nothing) and change nothing.
 *   all     fresh, then rerun, then invalid (default).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Point it at the PostgreSQL database the app is running against.");
  process.exit(1);
}
const EMAIL = process.env.ADMIN_EMAIL ?? "admin@gmail.com";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "password";

const roster = JSON.parse(
  readFileSync(join(process.cwd(), "scripts/benchmark/roster-2000.json"), "utf8"),
);

const scenario = process.argv[2] ?? "all";

// Read-only snapshots of the PostgreSQL database the app is running against.
const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });

async function count(query: string): Promise<number> {
  const { rows } = await pool.query(query);
  return Number(rows[0]?.n ?? 0);
}

const dbSnapshot = async () => {
  const [students, uniqueIds, joins, badJoins] = await Promise.all([
    count('SELECT COUNT(*) AS n FROM "Student"'),
    count('SELECT COUNT(DISTINCT id) AS n FROM "Student"'),
    count('SELECT COUNT(*) AS n FROM "_GroupToStudent"'),
    count(
      `SELECT COUNT(*) AS n FROM "_GroupToStudent" j
       LEFT JOIN "Student" s ON s.id = j."B"
       LEFT JOIN "Group" g ON g.id = j."A"
       WHERE s.id IS NULL OR g.id IS NULL`,
    ),
  ]);
  return { students, uniqueIds, joins, badJoins };
};

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok || !body.success) {
    throw new Error(`Login failed (${res.status}): ${JSON.stringify(body)}`);
  }
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("event-attendance-auth"));
  if (!setCookie) throw new Error("No session cookie returned by login");
  return setCookie.split(";")[0];
}

async function postRoster(cookie: string, payload: unknown) {
  const t0 = performance.now();
  const res = await fetch(`${BASE_URL}/api/bulk-import/students`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(payload),
  });
  const elapsedMs = performance.now() - t0;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, elapsedMs, body };
}

async function run(label: string, cookie: string, payload: unknown) {
  const before = await dbSnapshot();
  const { status, elapsedMs, body } = await postRoster(cookie, payload);
  const after = await dbSnapshot();
  console.log(`--- ${label} ---`);
  console.log(`  HTTP ${status} in ${(elapsedMs / 1000).toFixed(2)}s`);
  console.log(`  response: ${JSON.stringify(body)}`);
  console.log(
    `  students: ${before.students} -> ${after.students} (unique ids ${after.uniqueIds}, joins ${after.joins}, orphan joins ${after.badJoins})`,
  );
  return { status, elapsedMs, before, after };
}

async function main() {
  const cookie = await login();
  console.log(`Logged in as ${EMAIL} against ${BASE_URL} (db: ${DATABASE_URL})`);

  const before = await dbSnapshot();
  console.log(`Baseline: ${JSON.stringify(before)}\n`);

  if (scenario === "fresh" || scenario === "all") {
    await run("FRESH 2,000-row import", cookie, roster);
    console.log();
  }
  if (scenario === "rerun" || scenario === "all") {
    await run("RE-RUN same roster (idempotency)", cookie, roster);
    console.log();
  }
  if (scenario === "invalid" || scenario === "all") {
    const payload = JSON.parse(JSON.stringify(roster));
    payload[500].section = "section-that-does-not-exist";
    await run("INVALID row (one unknown section slug)", cookie, payload);
    console.log();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());