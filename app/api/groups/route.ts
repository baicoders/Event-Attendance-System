import { NextRequest, NextResponse } from "next/server";
import { takeRosterExclusiveLock } from "@/globals/utils/pgLocks";
import { Prisma, SchoolLevel, YearLevel } from "@prisma/client";
import { prisma } from "@/globals/libs/prisma";
import { respondWithError } from "@/globals/utils/httpError";
import { err, ok } from "@/globals/utils/api";
import { requireAuth, requireRole } from "@/globals/utils/auth";
import { createGroupSchema } from "@/globals/schemas/groupSchema";

/**
 * GET /api/groups
 * Fetches all available groups and flattens them into a Record<Category, Option[]>
 * used for dynamic filtering and form selection.
 */
export async function GET(_req: NextRequest) {
  try {
    await requireAuth();

    // Fetch all groups from the database
    const groups = await prisma.group.findMany({
      orderBy: { name: "asc" },
    });

    // Transform groups into categorized Option arrays
    const categorizedOptions = groups.reduce((acc, group) => {
      const category = group.category;
      
      if (!acc[category]) {
        acc[category] = [];
      }

      acc[category].push({
        label: group.name,
        value: group.slug,
      });

      return acc;
    }, {} as Record<string, { label: string; value: string }[]>);

    // Manually add enum options
    categorizedOptions["SCHOOL_LEVEL"] = Object.values(SchoolLevel).map((level) => ({
      label: level === "SHS" ? "Senior High School" : "College",
      value: level,
    }));

		categorizedOptions["YEAR_LEVEL"] = Object.values(YearLevel).map((level) => ({
      label: level,
      value: level,
    }));

    return NextResponse.json(ok(categorizedOptions), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}

/**
 * POST /api/groups
 * Creates a group. Admin only - the group vocabulary decides who events can
 * target, so it is configuration rather than roster data.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    requireRole(user, "ADMIN");

    const data = createGroupSchema.parse(await req.json());

    // Group creation extends the vocabulary events scope by, so it freezes
    // eligibility (exclusive form) across the insert.
    const group = await prisma.$transaction(async (tx) => {
      await takeRosterExclusiveLock(tx);
      return tx.group.create({
        data,
        select: { id: true, name: true, slug: true, category: true },
      });
    });

    return NextResponse.json(ok(group), { status: 201 });
  } catch (error) {
    // Slug is globally unique across every category, so a collision is a user
    // error, not a 500.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        err("A group with that slug already exists.", "DUPLICATE"),
        { status: 409 },
      );
    }

    return respondWithError(error);
  }
}