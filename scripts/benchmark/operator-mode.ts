import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

type WorkerResult = { ready?: boolean; ok?: boolean; ms?: number; error?: string };

// Runs against the PostgreSQL database in DATABASE_URL (a disposable test
// database). The schema is ensured with `prisma db push`, then the fixture
// rows are removed again in the finally block.
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. Point it at a disposable PostgreSQL test database.");
}
const pool = new Pool({ connectionString: url, max: 10 });
let db: PrismaClient | undefined;

function onceMessage(worker: Worker) {
  return new Promise<WorkerResult>((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
}

async function main() {
let user: { id: string } | undefined;
let event: { id: string } | undefined;
let studentIds: string[] = [];
try {
  execFileSync("pnpm", ["exec", "prisma", "db", "push"], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
  });
  db = new PrismaClient({ adapter: new PrismaPg(pool) });
  user = await db.user.create({ data: {
    name: "Benchmark", email: "benchmark@example.test", password: "test", status: "ACTIVE",
  } });
  event = await db.event.create({ data: {
    title: "Operator benchmark", category: "ALL", status: "APPROVED", createdById: user.id,
    start: new Date("2026-09-25T00:00:00Z"), end: new Date("2026-09-26T00:00:00Z"),
  } });
  studentIds = Array.from({ length: 500 }, (_, index) => String(index + 1).padStart(11, "0"));
  await db.student.createMany({ data: studentIds.map((id, index) => ({
    id, firstName: "Test", lastName: `Student ${index}`,
    schoolLevel: "COLLEGE" as const, yearLevel: "YEAR_1" as const,
  })) });

  const fixtureUser = user;
  const fixtureEvent = event;
  if (!fixtureUser || !fixtureEvent) throw new Error("Fixture setup failed.");

  let nextStudent = 1;
  for (const kind of ["baseline", "guarded"] as const) {
    for (const count of [2, 5]) {
      const workers = Array.from({ length: count }, () => new Worker(
        new URL("./operator-mode-worker.cts", import.meta.url), { workerData: { url }, execArgv: ["--require", "tsx/cjs"] },
      ));
      try {
        await Promise.all(workers.map(onceMessage));
        const results = workers.map(onceMessage);
        const started = performance.now();
        workers.forEach((worker) => worker.postMessage({
          kind, eventId: fixtureEvent.id, studentId: String(nextStudent++).padStart(11, "0"), userId: fixtureUser.id,
        }));
        const settled = await Promise.all(results);
        const elapsed = performance.now() - started;
        const durations = settled.map((result) => Math.round(result.ms ?? 0)).sort((a, b) => a - b);
        console.log(JSON.stringify({ kind, clients: count, roster: 500,
          wallMs: Math.round(elapsed), p50Ms: durations[Math.floor(durations.length / 2)],
          maxMs: durations.at(-1), successes: settled.filter((result) => result.ok).length,
          failures: settled.filter((result) => !result.ok).map((result) => result.error),
        }));
      } finally {
        await Promise.all(workers.map((worker) => worker.terminate()));
      }
    }
  }
} finally {
  // Remove only the fixture rows created above so the database is left clean.
  if (db) {
    try {
      await db.record.deleteMany({ where: { eventId: event?.id } });
      await db.event.deleteMany({ where: { id: event?.id } });
      await db.student.deleteMany({ where: { id: { in: studentIds } } });
      await db.user.deleteMany({ where: { id: user?.id } });
    } catch {
      /* best-effort fixture cleanup */
    }
  }
  await db?.$disconnect();
  await pool.end();
}
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
