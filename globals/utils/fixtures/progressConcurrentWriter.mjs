import { parentPort, workerData } from "node:worker_threads";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: workerData.url, max: 2 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });
parentPort.postMessage("ready");
parentPort.once("message", async () => {
  parentPort.postMessage("attempting");
  try {
    await db.$transaction(async (tx) => {
      await tx.record.create({ data: { eventId: workerData.eventId, studentId: "S4", method: "SCANNED", timein: new Date() } });
      await tx.student.update({ where: { id: "S3" }, data: { groups: { connect: { id: workerData.groupId } } } });
      await tx.group.update({ where: { id: workerData.groupId }, data: { name: "Renamed section" } });
      await tx.event.update({ where: { id: workerData.eventId }, data: { status: "DRAFT" } });
    });
    parentPort.postMessage("committed");
  } catch (error) {
    parentPort.postMessage({ error: String(error) });
  } finally {
    await db.$disconnect();
    await pool.end();
  }
});
