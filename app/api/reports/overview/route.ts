import { EventCategory } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { err, ok } from "@/globals/utils/api";
import { requireAuth } from "@/globals/utils/auth";
import { respondWithError } from "@/globals/utils/httpError";
import { buildOverview } from "@/globals/utils/reportsOverview";

/**
 * Cross-event attendance summary for a date range.
 *
 * Covers APPROVED events only — see `globals/utils/reportsOverview.ts` for why
 * that is both the honest set and the safe one.
 */

const eventCategoryEnum = z.enum(EventCategory);

/**
 * A range this wide would fan out into an unbounded number of eligibility
 * queries on a laptop-hosted SQLite file. The deployment's horizon is one school
 * week; a year is already far beyond any real use.
 */
const MAX_RANGE_DAYS = 366;
const MAX_RANGE_MS = MAX_RANGE_DAYS * 24 * 60 * 60 * 1000;

const overviewQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  category: eventCategoryEnum.optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireAuth();

    const query = overviewQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    );

    // Reject rather than silently defaulting to a wider range than asked for —
    // the same reasoning as the list query in `app/api/events/route.ts`.
    if (!query.success) {
      return NextResponse.json(
        err("`from` and `to` must be valid dates, and `category` a known category."),
        { status: 400 },
      );
    }

    const { from, to, category } = query.data;

    if (to.getTime() < from.getTime()) {
      return NextResponse.json(err("`to` must not precede `from`."), {
        status: 400,
      });
    }

    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      return NextResponse.json(
        err(`Date range must not exceed ${MAX_RANGE_DAYS} days.`),
        { status: 400 },
      );
    }

    return NextResponse.json(ok(await buildOverview({ from, to, category })), {
      status: 200,
    });
  } catch (error) {
    return respondWithError(error);
  }
}
