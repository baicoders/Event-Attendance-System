import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/globals/libs/prisma";
import { requireAuth } from "@/globals/utils/auth";
import { ok } from "@/globals/utils/api";
import { registerEmployee, personSearch } from "@/features/library/server";
import { libraryHttpError } from "@/features/library/http";

export async function GET(request: Request) {
  try {
    await requireAuth();
    const search = z.string().trim().min(1).max(100).parse(new URL(request.url).searchParams.get("search"));
    const people = await prisma.student.findMany({ where: personSearch(search), include: { groups: true }, orderBy: [{ lastName: "asc" }, { id: "asc" }], take: 25 });
    return NextResponse.json(ok(people.map(p => ({ ...p, personType: p.groups.some(g => g.slug === "employees") ? "EMPLOYEE" : "STUDENT" }))));
  } catch (error) { return libraryHttpError(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await requireAuth();
    return NextResponse.json(ok(await registerEmployee(prisma, await request.json(), actor)));
  } catch (error) { return libraryHttpError(error); }
}
