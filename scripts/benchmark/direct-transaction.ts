/**
 * Standalone probe for the bulk-import transaction — no HTTP, no route code.
 *
 * Replicates exactly what app/api/bulk-import/students/route.ts does (the array
 * form of `prisma.$transaction([...upserts])` with `groups.set/connect`) against
 * a real PostgreSQL database, with query logging and a stopwatch, so we can answer the
 * two questions the issue hinges on:
 *
 *   1. How many SQL statements does a full-size roster actually generate?
 *   2. Does the configured transaction timeout actually fire for the
 *      pooled pg adapter, or does the batch run to completion?
 *
 * Usage (run from repo root, against a scratch DB):
 *   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/test_benchmark" npx tsx scripts/benchmark/direct-transaction.ts
 *
 * The DB it writes to must already contain the seeded group vocabulary (run the
 * normal seed once on a scratch database first). It does not create or delete groups.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  throw new Error("DATABASE_URL is not set. Point it at a scratch database.");
}

const roster = JSON.parse(
  readFileSync(join(process.cwd(), "scripts/benchmark/roster-2000.json"), "utf8"),
) as {
  id: string;
  firstName: string;
  lastName: string;
  middleName: string;
  schoolLevel: string;
  yearLevel: string;
  section: string;
  house: string;
  department: string;
  program: string;
  strand: string;
}[];

const FIELD_CATEGORY = {
  section: "SECTION",
  house: "HOUSE",
  department: "DEPARTMENT",
  program: "PROGRAM",
  strand: "STRAND",
} as const;

const pool = new Pool({ connectionString: DB_URL, max: 10 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({
  adapter,
  log: ["query"],
});

let statementCount = 0;
prisma.$on("query", () => {
  statementCount++;
});

async function main() {
  // Resolve every referenced slug the same way validateStudentGroupSlugs does.
  const referenced = new Set<string>();
  for (const s of roster) {
    for (const field of Object.keys(FIELD_CATEGORY) as (keyof typeof FIELD_CATEGORY)[]) {
      if (s[field]) referenced.add(s[field]);
    }
  }
  const groups = await prisma.group.findMany({
    where: { slug: { in: [...referenced] } },
    select: { id: true, slug: true },
  });
  const slugToId = new Map(groups.map((g) => [g.slug, g.id]));

  console.log(`Students in payload: ${roster.length}`);
  console.log(`Distinct group slugs referenced: ${referenced.size}`);

  const t0 = performance.now();
  const results = await prisma.$transaction(
    roster.map((data) => {
      const studentGroupIds = [
        data.section,
        data.house,
        data.department,
        data.program,
        data.strand,
      ]
        .filter(Boolean)
        .map((slug) => slugToId.get(slug as string))
        .filter(Boolean)
        .map((id) => ({ id }));

      return prisma.student.upsert({
        where: { id: data.id },
        update: {
          firstName: data.firstName,
          lastName: data.lastName,
          middleName: data.middleName || null,
          schoolLevel: data.schoolLevel as never,
          yearLevel: data.yearLevel as never,
          groups: { set: studentGroupIds },
        },
        create: {
          id: data.id,
          firstName: data.firstName,
          lastName: data.lastName,
          middleName: data.middleName || null,
          schoolLevel: data.schoolLevel as never,
          yearLevel: data.yearLevel as never,
          groups: { connect: studentGroupIds },
        },
      });
    }),
  );
  const elapsed = performance.now() - t0;

  const total = await prisma.student.count();
  const uniqueIds = await prisma.student.findMany({ select: { id: true } });
  const joinCount = await prisma.$queryRaw<{ n: bigint }[]>(
    Prisma.sql`SELECT COUNT(*) AS n FROM "_GroupToStudent"`,
  );

  console.log(`Transaction result rows: ${results.length}`);
  console.log(`Total time: ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`SQL statements issued: ${statementCount}`);
  console.log(`Statements per student: ${(statementCount / roster.length).toFixed(1)}`);
  console.log(`Students in DB after: ${total}`);
  console.log(`Distinct student ids: ${new Set(uniqueIds.map((s) => s.id)).size}`);
  console.log(`Group-to-student joins after: ${Number(joinCount[0].n)}`);
  console.log(`Outcome: SUCCESS (reached here, so no timeout rolled the batch back)`);

  await prisma.$disconnect();
  await pool.end();
}

const t0 = performance.now();
main().catch(async (e) => {
  console.error(
    `FAILED after ~${((performance.now() - t0) / 1000).toFixed(2)}s with ${statementCount} statements issued`,
  );
  console.error(
    e instanceof Prisma.PrismaClientKnownRequestError ? `Prisma code: ${e.code}` : e,
  );
  process.exitCode = 1;
  await prisma.$disconnect();
  await pool.end();
});