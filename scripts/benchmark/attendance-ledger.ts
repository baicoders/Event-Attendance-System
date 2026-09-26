/** Disposable PostgreSQL contention probe for issue #48. Requires TEST_DATABASE_URL. */
import { performance } from "node:perf_hooks";
import { createDisposableDb, createTestClient } from "../../globals/libs/testDb";
import { takeRosterExclusiveLock } from "../../globals/utils/pgLocks";
import { recordAttendance } from "../../features/attendance/server/recordAttendance";

const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * fraction) - 1] * 10) / 10;
};

async function main() {
const disposable = await createDisposableDb("test_issue48_probe");
const owner = createTestClient(disposable.url);
const clients = Array.from({ length: 5 }, () => createTestClient(disposable.url, 2));
try {
  const user = await owner.db.user.create({ data: { name: "Probe", email: "probe@example.test", password: "test", status: "ACTIVE" } });
  const event = await owner.db.event.create({ data: { title: "Probe", category: "ALL", status: "APPROVED", createdById: user.id,
    start: new Date(Date.now() - 3600000), end: new Date(Date.now() + 3600000) } });
  await owner.db.student.createMany({ data: Array.from({ length: 2000 }, (_, i) => ({ id: String(i + 1).padStart(11, "0"),
    firstName: `Student${i}`, lastName: "Probe", yearLevel: "YEAR_1", schoolLevel: "COLLEGE" })) });
  const actor = { id: user.id, role: "ORGANIZER" as const, credentialVersion: 0 };
  const run = async (label: string, ids: number[]) => {
    const durations: number[] = [];
    const settled = await Promise.allSettled(ids.map(async (id, index) => {
      const started = performance.now();
      const result = await recordAttendance(clients[index % clients.length].db, { eventId: event.id,
        studentId: String(id).padStart(11, "0"), method: "SCANNED", expectedMode: "TIME_IN" }, actor);
      durations.push(performance.now() - started);
      return result;
    }));
    const failed = settled.filter((entry) => entry.status === "rejected");
    console.log(`${label}: ${settled.length - failed.length}/${settled.length} completed; p50 ${percentile(durations, 0.5)} ms; p95 ${percentile(durations, 0.95)} ms`);
    if (failed.length) throw failed[0].reason;
  };
  for (let id = 1; id <= 10; id++) await run(`serial ${id}`, [id]);
  await run("different pairs", [11, 12, 13, 14, 15]);
  await run("same pair", [16, 16, 16, 16, 16]);

  let release!: () => void;
  let locked!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { locked = resolve; });
  const rosterWork = owner.db.$transaction(async (tx) => { await takeRosterExclusiveLock(tx); locked(); await held; });
  await ready;
  const scan = run("scan behind roster writer", [17]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  release();
  await Promise.all([rosterWork, scan]);
} finally {
  await Promise.all(clients.map((client) => client.disconnect()));
  await owner.disconnect();
  await disposable.cleanup();
}
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
