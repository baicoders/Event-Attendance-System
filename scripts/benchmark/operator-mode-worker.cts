import { parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { recordAttendance } from "@/features/attendance/server/recordAttendance";

const pool = new Pool({ connectionString: workerData.url as string, max: 5 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

parentPort?.on("message", async (request: {
  kind: "baseline" | "guarded"; eventId: string; studentId: string; userId: string;
}) => {
  const started = performance.now();
  try {
    if (request.kind === "guarded") {
      await recordAttendance(db, {
        eventId: request.eventId, studentId: request.studentId, method: "SCANNED", expectedMode: "TIME_IN",
      }, { id: request.userId, role: "ORGANIZER", credentialVersion: 0 });
    } else {
      // Proxy for the pre-guard route's read/read/create path on a fresh,
      // approved ALL event with distinct eligible students.
      await db.event.findUniqueOrThrow({ where: { id: request.eventId } });
      await db.student.findUniqueOrThrow({ where: { id: request.studentId } });
      await db.record.findUnique({ where: { eventId_studentId: {
        eventId: request.eventId, studentId: request.studentId,
      } } });
      await db.record.create({ data: {
        eventId: request.eventId, studentId: request.studentId, method: "SCANNED",
        timein: new Date(), recordedById: request.userId,
      } });
    }
    parentPort?.postMessage({ ok: true, ms: performance.now() - started });
  } catch (error) {
    parentPort?.postMessage({ ok: false, ms: performance.now() - started,
      error: error instanceof Error ? error.message : String(error) });
  }
});

parentPort?.postMessage({ ready: true });
