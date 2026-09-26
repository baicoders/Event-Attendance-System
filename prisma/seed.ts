import {
  EventCategory,
  PrismaClient,
  SchoolLevel,
  YearLevel,
  Group,
} from "@prisma/client";
import { faker } from "@faker-js/faker";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
// Derive the school vocabulary from the single source of truth the UI reads,
// so seeded groups match what the selection boards query (relative import: the
// seed runs under tsx, and groups.ts has no dependencies of its own).
import { HOUSES, SHS_STRANDS } from "../globals/constants/groups";
import { slugify } from "../globals/utils/text";
import { getMigrationDatabaseUrl, RUNTIME_POOL_TUNING, sslForUrl } from "../globals/libs/dbConfig";

// Fail fast rather than silently seeding the wrong database.
const connectionString = getMigrationDatabaseUrl();
const ssl = sslForUrl(connectionString);
const pool = new Pool({
  connectionString,
  max: RUNTIME_POOL_TUNING.max,
  connectionTimeoutMillis: RUNTIME_POOL_TUNING.connectionTimeoutMillis,
  idleTimeoutMillis: RUNTIME_POOL_TUNING.idleTimeoutMillis,
  ...(ssl ? { ssl } : {}),
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Utility functions
const randomChoice = <T>(arr: T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];

// Name-derived groups: the DB slug is slugify(name), which is exactly what
// each consumer queries for these categories.
const GROUP_DATA: Partial<
  Record<Exclude<EventCategory, "ALL" | "COLLEGE" | "SHS">, string[]>
> = {
  DEPARTMENT: [
    "Computer Studies",
    "Hotel Management",
    "Business Administration",
  ],
  PROGRAM: ["BSCS", "BSIT", "BSHM", "BSBA"],
  YEAR: Object.values(YearLevel),
  SECTION: ["BSCS-2A", "BSIT-2B", "STEM-11A", "STEM-12B"],
};

// Houses and strands are derived straight from the canonical constants so the
// selection boards (which read the same file) always find these groups. Slugs
// match each board's query value: HOUSES.slug for houses, slugify(code) for
// strands - so no HUMSS/GAS drift.
const DERIVED_GROUPS: { name: string; slug: string; category: EventCategory }[] =
  [
    ...HOUSES.map((h) => ({
      name: h.name,
      slug: h.slug,
      category: "HOUSE" as EventCategory,
    })),
    ...SHS_STRANDS.map((s) => ({
      name: s.name,
      slug: slugify(s.code),
      category: "STRAND" as EventCategory,
    })),
  ];

async function main() {
  // This seed wipes every table before inserting demo data. Guard it so it
  // can never erase a real database: allow only outside production, unless
  // SEED_FORCE=true is explicitly set.
  if (process.env.NODE_ENV === "production" && process.env.SEED_FORCE !== "true") {
    throw new Error(
      "Refusing to run destructive seed in production. Set SEED_FORCE=true to override.",
    );
  }

  console.log("Seeding database...");

  await prisma.record.deleteMany();
  await prisma.event.deleteMany();
  await prisma.student.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();

  // Groups
  const allGroups: Group[] = [];
  for (const [category, names] of Object.entries(GROUP_DATA)) {
    for (const name of names ?? []) {
      const group = await prisma.group.create({
        data: {
          name,
          slug: slugify(name),
          category: category as EventCategory,
        },
      });
      allGroups.push(group);
    }
  }
  for (const { name, slug, category } of DERIVED_GROUPS) {
    const group = await prisma.group.create({
      data: { name, slug, category },
    });
    allGroups.push(group);
  }
  console.log(`Created ${allGroups.length} groups.`);

  // Users
  const admin = await prisma.user.create({
    data: {
      name: "Admin",
      email: "admin@gmail.com",
      password: "password",
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  const organizer = await prisma.user.create({
    data: {
      name: "Organizer",
      email: "organizer@example.com",
      password: "password",
      role: "ORGANIZER",
      status: "ACTIVE",
    },
  });

  await prisma.user.create({
    data: {
      name: faker.person.fullName(),
      email: faker.internet.email(),
      password: "password",
      role: "ORGANIZER",
      status: "ACTIVE",
    },
  });

  await prisma.user.create({
    data: {
      name: faker.person.fullName(),
      email: faker.internet.email(),
      password: "password",
      role: "ORGANIZER",
      status: "PENDING",
    },
  });

  await prisma.user.create({
    data: {
      name: faker.person.fullName(),
      email: faker.internet.email(),
      password: "password",
      role: "ORGANIZER",
      status: "REJECTED",
      rejectionReason: "Missing organization requirements.",
    },
  });

  // Students
  console.log("Creating students...");
  for (let i = 0; i < 100; i++) {
    const schoolLevel = randomChoice([SchoolLevel.SHS, SchoolLevel.COLLEGE]);
    const yearLevel =
      schoolLevel === SchoolLevel.COLLEGE
        ? randomChoice([
            YearLevel.YEAR_1,
            YearLevel.YEAR_2,
            YearLevel.YEAR_3,
            YearLevel.YEAR_4,
          ])
        : randomChoice([YearLevel.GRADE_11, YearLevel.GRADE_12]);

    // Pick relevant groups for this student
    const studentGroups = [
      randomChoice(allGroups.filter((g) => g.category === "HOUSE")),
      randomChoice(allGroups.filter((g) => g.category === "SECTION")),
    ];

    if (schoolLevel === SchoolLevel.SHS) {
      studentGroups.push(
        randomChoice(allGroups.filter((g) => g.category === "STRAND")),
      );
    } else {
      studentGroups.push(
        randomChoice(allGroups.filter((g) => g.category === "PROGRAM")),
        randomChoice(allGroups.filter((g) => g.category === "DEPARTMENT")),
      );
    }

    const baseId = 20250000000;
    await prisma.student.create({
      data: {
        id: String(baseId + i).padStart(11, "0"),
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        schoolLevel,
        yearLevel: yearLevel,
        groups: {
          connect: studentGroups.map((g) => ({ id: g.id })),
        },
      },
    });
  }

  // Events (Linking to groups)
  console.log("Creating events...");
  for (let i = 0; i < 10; i++) {
    const category = randomChoice(Object.values(EventCategory));

    // Pick 1-2 random groups that match the category (if not ALL/COLLEGE/SHS)
    const targetGroups = allGroups
      .filter((g) => g.category === category)
      .sort(() => 0.5 - Math.random())
      .slice(0, 1);

    await prisma.event.create({
      data: {
        title: `${category} Event ${i + 1}`,
        category,
        start: new Date(),
        end: new Date(Date.now() + 3600000),
        status: "APPROVED",
        createdById: organizer.id,
        reviewedById: admin.id,
        includedGroups: {
          connect: targetGroups.map((g) => ({ id: g.id })),
        },
      },
    });
  }

  console.log("Seed finished successfully.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
