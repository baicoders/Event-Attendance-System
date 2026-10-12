import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { closingTime, libraryDay } from "../../features/library/time";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// Non-destructive and opt-in. Never run full db:seed for the library showcase.
async function main() {
  if (process.env.NODE_ENV !== "development" || !process.argv.includes("--confirm-demo")) {
    throw new Error("Development only. Run NODE_ENV=development pnpm library:demo --confirm-demo against a development database.");
  }
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("Demo generation is restricted to a local development database.");
  const student = await prisma.student.findFirst({ where: { groups: { none: { slug: "employees" } } }, orderBy: { id: "asc" } });
  if (!student) throw new Error("Create one test student using the existing Students screen first. No real roster records will be overwritten.");
  const group = await prisma.group.upsert({ where: { slug: "employees" }, update: {}, create: { name: "Employees", slug: "employees", category: "SECTION" } });
  let employee = await prisma.student.findFirst({ where: { groups: { some: { slug: "employees" } } }, orderBy: { id: "asc" } });
  if (!employee) {
    // create (not upsert): a colliding genuine ID is never overwritten.
    employee = await prisma.student.create({ data: { id: "DEMOEMP0001", firstName: "[DEMO] Maria", lastName: "Santos", schoolLevel: "COLLEGE", yearLevel: "YEAR_1", groups: { connect: { id: group.id } } } });
  }
  const today = libraryDay();
  let count = 0;
  for (const offset of [1, 3, 8, 15, 35, 65]) {
    const date = new Date(`${today}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - offset);
    const day = date.toISOString().slice(0, 10);
    for (const [identity, personType] of [[student, "STUDENT"], [employee, "EMPLOYEE"]] as const) {
      for (let session = 0; session < 2; session++) {
        const forgotten = session === 1 && (offset === 1 || offset === 3);
        const administrative = session === 1 && offset === 8;
        const late = forgotten && offset === 3;
        const timeIn = new Date(`${day}T${late ? "17:15" : session ? "13:00" : "08:00"}:00+08:00`);
        const timeOut = forgotten ? null : administrative ? closingTime(day) : new Date(`${day}T${session ? "14:30" : "09:30"}:00+08:00`);
        const result = await prisma.libraryVisit.createMany({ skipDuplicates: true, data: [{
          id: `library-demo-${day}-${identity.id}-${session}`, studentId: identity.id, personType, visitDay: day, timeIn, timeOut, isDemo: true,
          ...(administrative ? { administrativelyClosedAt: new Date(`${day}T18:00:00+08:00`), administrativelyClosedById: "simulated-librarian" } : {}),
        }] });
        count += result.count;
      }
    }
  }
  console.log(`Added ${count} SIMULATED library visits; existing data was preserved. In /library, select “View simulated demonstration data only” and use weekly/monthly filters. Normal reports exclude these records.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
