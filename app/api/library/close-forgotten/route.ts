import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/globals/libs/prisma";
import { requireAuth } from "@/globals/utils/auth";
import { ok } from "@/globals/utils/api";
import { closeForgottenVisits } from "@/features/library/server";
import { libraryHttpError } from "@/features/library/http";

const schema = z.object({ visitId: z.string().min(1).optional(), timeOut: z.iso.datetime({ offset: true }).transform(v => new Date(v)).optional(), demo: z.boolean().default(false) })
  .refine(v => !!v.visitId === !!v.timeOut, "Individual correction needs a visit and Time Out");
export async function POST(request: Request) {
  try {
    const actor = await requireAuth();
    const input = schema.parse(await request.json());
    return NextResponse.json(ok(await closeForgottenVisits(prisma, actor, input)));
  } catch (error) { return libraryHttpError(error); }
}
