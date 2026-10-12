import { NextResponse } from "next/server";
import { prisma } from "@/globals/libs/prisma";
import { requireAuth } from "@/globals/utils/auth";
import { ok } from "@/globals/utils/api";
import { recordLibraryScan } from "@/features/library/server";
import { libraryHttpError } from "@/features/library/http";

export async function POST(request: Request) {
  try {
    const actor = await requireAuth();
    const result = await recordLibraryScan(prisma, await request.json(), actor);
    return NextResponse.json(ok(result));
  } catch (error) { return libraryHttpError(error); }
}
