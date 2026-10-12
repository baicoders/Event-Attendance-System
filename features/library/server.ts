import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { studentIdSchema } from "@/globals/schemas/studentId";
import { studentSchema, type StudentFormValues } from "@/globals/schemas/studentSchema";
import { validateStudentGroupSlugs } from "@/globals/utils/studentGroups";
import { takeCommandLock, takeRecordPairLock, takeRosterSharedLock, takeRosterExclusiveLock } from "@/globals/utils/pgLocks";
import { closingTime, EMPLOYEES_GROUP_SLUG, libraryDay, libraryRange, LIBRARY_SCAN_COOLDOWN_MS, visitStatus } from "./time";

export class LibraryError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}
type Actor = { id: string; credentialVersion: number };
const personSelect = { id: true, firstName: true, middleName: true, lastName: true } as const;
export const scanSchema = z.object({ studentId: studentIdSchema, requestId: z.uuid().transform(v => v.toLowerCase()) });
export const employeeSchema = z.object({
  id: studentIdSchema,
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  middleName: z.string().trim().max(100).optional(),
  assignExisting: z.boolean().optional(),
}).refine(v => v.assignExisting || (v.firstName && v.lastName), "First and last names are required");
export const historySchema = z.object({
  date: z.string().default(() => libraryDay()),
  period: z.enum(["daily", "weekly", "monthly"]).default("daily"),
  type: z.enum(["ALL", "STUDENT", "EMPLOYEE"]).default("ALL"),
  search: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  demo: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
}).refine(v => { try { libraryRange(v.date, v.period); return true; } catch { return false; } }, "Invalid calendar date");
export type HistoryInput = z.output<typeof historySchema>;

export function personSearch(search: string): Prisma.StudentWhereInput {
  return { AND: search.split(/\s+/).filter(Boolean).map(token => ({
    OR: ["id", "firstName", "lastName", "middleName"].map(key => ({ [key]: { contains: token, mode: "insensitive" } })),
  })) };
}


// Recheck inside each write transaction, as the event recorder does.
async function guardActor(tx: Prisma.TransactionClient, actor: Actor) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: actor.id } });
  if (!user || user.status !== "ACTIVE" || user.mustChangePassword || user.credentialVersion !== actor.credentialVersion) {
    throw new LibraryError("Session is no longer active", 401, "UNAUTHORIZED");
  }
}

export async function recordLibraryScan(db: PrismaClient, raw: z.input<typeof scanSchema>, actor: Actor, clock = () => new Date()) {
  const input = scanSchema.parse(raw);
  return db.$transaction(async tx => {
    await guardActor(tx, actor);
    await takeCommandLock(tx, `library:${input.requestId}`);
    await takeRosterSharedLock(tx);
    await takeRecordPairLock(tx, "library", input.studentId);
    const replay = await tx.libraryVisit.findFirst({
      where: { OR: [{ timeInRequestId: input.requestId }, { timeOutRequestId: input.requestId }] },
      include: { student: { select: personSelect } },
    });
    if (replay) {
      if (replay.studentId !== input.studentId) throw new LibraryError("Request ID already used for another visitor", 409, "REQUEST_REUSED");
      return { operation: replay.timeInRequestId === input.requestId ? "TIME_IN" as const : "TIME_OUT" as const, visit: replay, replayed: true };
    }
    const student = await tx.student.findUnique({ where: { id: input.studentId }, include: { groups: { select: { slug: true } } } });
    if (!student) throw new LibraryError("Unknown QR / visitor ID. Register the person first.", 404, "PERSON_NOT_FOUND");
    const now = clock(); // Take server time after locks, never client time.
    const day = libraryDay(now);
    const latest = await tx.libraryVisit.findFirst({ where: { studentId: student.id, isDemo: false }, orderBy: { timeIn: "desc" } });
    const lastScan = latest && (latest.timeOut && !latest.administrativelyClosedAt ? latest.timeOut : latest.timeIn);
    if (lastScan && now.getTime() - lastScan.getTime() < LIBRARY_SCAN_COOLDOWN_MS) {
      throw new LibraryError("Duplicate scan: wait 10 seconds after the last scan.", 409, "SCAN_COOLDOWN");
    }
    const open = await tx.libraryVisit.findFirst({ where: { studentId: student.id, visitDay: day, timeOut: null, isDemo: false } });
    let id: string;
    if (open) {
      const updated = await tx.libraryVisit.updateMany({ where: { id: open.id, timeOut: null }, data: { timeOut: now, timeOutRecordedById: actor.id, timeOutRequestId: input.requestId } });
      if (!updated.count) throw new LibraryError("Visit was just closed. Refresh history before scanning again.", 409, "VISIT_CHANGED");
      id = open.id;
    } else {
      const created = await tx.libraryVisit.create({ data: {
        studentId: student.id, visitDay: day, timeIn: now, recordedById: actor.id, timeInRequestId: input.requestId,
        personType: student.groups.some(g => g.slug === EMPLOYEES_GROUP_SLUG) ? "EMPLOYEE" : "STUDENT",
      } });
      id = created.id;
    }
    const visit = await tx.libraryVisit.findUniqueOrThrow({ where: { id }, include: { student: { select: personSelect } } });
    return { operation: open ? "TIME_OUT" as const : "TIME_IN" as const, visit, replayed: false };
  }, { timeout: 10000 });
}

export async function registerEmployee(db: PrismaClient, raw: z.input<typeof employeeSchema>, actor: Actor) {
  const input = employeeSchema.parse(raw);
  return db.$transaction(async tx => {
    await guardActor(tx, actor);
    await takeRosterExclusiveLock(tx);
    const group = await tx.group.upsert({ where: { slug: EMPLOYEES_GROUP_SLUG }, update: {}, create: { name: "Employees", slug: EMPLOYEES_GROUP_SLUG, category: "SECTION" } });
    const existing = await tx.student.findUnique({ where: { id: input.id } });
    if (existing && !input.assignExisting) throw new LibraryError("ID already exists. Find the identity and explicitly classify it as an employee.", 409, "ID_EXISTS");
    if (!existing && input.assignExisting) throw new LibraryError("Identity not found", 404, "PERSON_NOT_FOUND");
    if (existing) return tx.student.update({ where: { id: input.id }, data: { groups: { connect: { id: group.id } } }, include: { groups: true } });
    // Isolated MVP workaround; never displayed as employee academic data.
    return tx.student.create({ data: {
      id: input.id, firstName: input.firstName!, lastName: input.lastName!, middleName: input.middleName || null,
      schoolLevel: "COLLEGE", yearLevel: "YEAR_1", groups: { connect: { id: group.id } },
    }, include: { groups: true } });
  });
}

export async function registerLibraryStudent(db: PrismaClient, raw: StudentFormValues, actor: Actor) {
  const input = studentSchema.parse(raw);
  return db.$transaction(async tx => {
    await guardActor(tx, actor);
    await takeRosterExclusiveLock(tx);
    if (await tx.student.findUnique({ where: { id: input.id }, select: { id: true } })) {
      throw new LibraryError("ID already exists. Use Manual Search to find the existing visitor.", 409, "ID_EXISTS");
    }
    const resolution = await validateStudentGroupSlugs([input], tx);
    if (!resolution.ok) throw new LibraryError(resolution.error, 400, "INVALID_GROUPS");
    const groups = [input.section, input.house, input.department, input.program, input.strand]
      .filter(Boolean).map(slug => ({ id: resolution.slugToId.get(slug!)! }));
    return tx.student.create({ data: {
      id: input.id, firstName: input.firstName, lastName: input.lastName, middleName: input.middleName || null,
      schoolLevel: input.schoolLevel, yearLevel: input.yearLevel, groups: { connect: groups },
    }, include: { groups: true } });
  });
}

export async function closeForgottenVisits(db: PrismaClient, actor: Actor, input: { visitId?: string; timeOut?: Date; demo?: boolean } = {}, clock = () => new Date()) {
  return db.$transaction(async tx => {
    await guardActor(tx, actor);
    const now = clock();
    if (input.visitId) {
      const visit = await tx.libraryVisit.findUnique({ where: { id: input.visitId } });
      if (!visit || visit.isDemo !== !!input.demo) throw new LibraryError("Visit not found", 404, "VISIT_NOT_FOUND");
      if (visit.timeOut) return { count: 0 };
      if (!input.timeOut || !Number.isFinite(input.timeOut.getTime()) || input.timeOut < visit.timeIn || input.timeOut > now || closingTime(visit.visitDay) > now) {
        throw new LibraryError("Time Out must be after Time In, no later than now, and the visit must need review.", 400, "INVALID_TIME_OUT");
      }
      return tx.libraryVisit.updateMany({ where: { id: visit.id, timeOut: null }, data: { timeOut: input.timeOut, administrativelyClosedAt: now, administrativelyClosedById: actor.id } });
    }
    const count = await tx.$executeRaw`
      UPDATE "LibraryVisit"
      SET "timeOut" = ("visitDay"::date + TIME '17:00') AT TIME ZONE 'Asia/Manila',
          "administrativelyClosedAt" = ${now}, "administrativelyClosedById" = ${actor.id}
      WHERE "timeOut" IS NULL AND "isDemo" = ${!!input.demo}
        AND (("visitDay"::date + TIME '17:00') AT TIME ZONE 'Asia/Manila') <= ${now}
        AND "timeIn" <= (("visitDay"::date + TIME '17:00') AT TIME ZONE 'Asia/Manila')`;
    return { count };
  });
}

export async function readLibraryVisits(db: PrismaClient, input: HistoryInput, now = new Date(), exportAll = false) {
  const range = libraryRange(input.date, input.period);
  const where: Prisma.LibraryVisitWhereInput = {
    isDemo: input.demo, visitDay: { gte: range.start, lte: range.end },
    ...(input.type === "ALL" ? {} : { personType: input.type }),
    ...(input.search ? { student: personSearch(input.search) } : {}),
  };
  // A read-only snapshot keeps counts, history and activity coherent.
  return db.$transaction(async tx => {
    const today = libraryDay(now);
    const open = await tx.libraryVisit.findMany({ where: { timeOut: null, isDemo: input.demo }, include: { student: { select: personSelect } }, orderBy: [{ visitDay: "asc" }, { timeIn: "asc" }] });
    const unclosed = open.filter(v => closingTime(v.visitDay) <= now);
    const inside = open.filter(v => v.visitDay === today && closingTime(v.visitDay) > now);
    const [total, visits, visitsToday, recent] = await Promise.all([
      tx.libraryVisit.count({ where }),
      tx.libraryVisit.findMany({ where, include: { student: { select: personSelect } }, orderBy: [{ timeIn: "desc" }, { id: "desc" }], ...(exportAll ? {} : { take: 50, skip: (input.page - 1) * 50 }) }),
      tx.libraryVisit.count({ where: { visitDay: today, isDemo: input.demo } }),
      tx.libraryVisit.findMany({ where: { isDemo: input.demo }, include: { student: { select: personSelect } }, orderBy: { timeIn: "desc" }, take: 20 }),
    ]);
    // Merge persisted entries and exits. Admin exits retain their own label.
    const recentExits = await tx.libraryVisit.findMany({ where: { isDemo: input.demo, timeOut: { not: null } }, include: { student: { select: personSelect } }, orderBy: { timeOut: "desc" }, take: 20 });
    const activity = [
      ...recent.map(v => ({ id: `${v.id}-in`, student: v.student, personType: v.personType, action: "Time In", at: v.timeIn })),
      ...recentExits.map(v => ({ id: `${v.id}-out`, student: v.student, personType: v.personType, action: v.administrativelyClosedAt ? "Closed by librarian" : "Time Out", at: v.timeOut! })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 12);
    return { range, today, now, total, page: input.page,
      visits: visits.map(v => ({ ...v, status: visitStatus(v, now) })),
      summary: { visitsToday, currentlyInside: inside.length, unclosedVisits: unclosed.length, bulkEligible: unclosed.filter(v => v.timeIn <= closingTime(v.visitDay)).length },
      inside, unclosed: unclosed.map(v => ({ ...v, status: visitStatus(v, now) })), activity,
    };
  }, { isolationLevel: "RepeatableRead" });
}
