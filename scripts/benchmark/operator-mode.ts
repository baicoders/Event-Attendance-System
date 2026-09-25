import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

type WorkerResult = { ready?: boolean; ok?: boolean; ms?: number; error?: string };

const dir = mkdtempSync(join(tmpdir(), "issue70-benchmark-"));
const url = `file:${join(dir, "attendance.db")}`;
let db: PrismaClient | undefined;

function onceMessage(worker: Worker) {
  return new Promise<WorkerResult>((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
}

async function main() {
try {
  execFileSync("pnpm", ["exec", "prisma", "db", "push"], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
  });
  db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  const user = await db.user.create({ data: {
    name: "Benchmark", email: "benchmark@example.test", password: "test", status: "ACTIVE",
  } });
  const event = await db.event.create({ data: {
    title: "Operator benchmark", category: "ALL", status: "APPROVED", createdById: user.id,
    start: new Date("2026-09-25T00:00:00Z"), end: new Date("2026-09-26T00:00:00Z"),
  } });
  await db.student.createMany({ data: Array.from({ length: 500 }, (_, index) => ({
    id: String(index + 1).padStart(11, "0"), firstName: "Test", lastName: `Student ${index}`,
    schoolLevel: "COLLEGE" as const, yearLevel: "YEAR_1" as const,
  })) });

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
          kind, eventId: event.id, studentId: String(nextStudent++).padStart(11, "0"), userId: user.id,
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
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
}
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
