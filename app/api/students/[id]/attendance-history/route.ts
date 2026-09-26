import { NextResponse } from "next/server";
import { requireAuth } from "@/globals/utils/auth";
import { err, ok } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import { HistoryQueryError, parseHistoryQuery } from "@/globals/schemas/studentHistory";
import { loadStudentHistory } from "@/globals/utils/studentHistory";

const noStore = { "Cache-Control": "private, no-store" };
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
    const { id } = await params;
    const evaluatedAt = new Date();
    const query = parseHistoryQuery(new URL(request.url).searchParams, evaluatedAt);
    const history = await loadStudentHistory(id, query, evaluatedAt);
    if (!history) return NextResponse.json(err("Student not found."), { status: 404, headers: noStore });
    return NextResponse.json(ok(history), { headers: noStore });
  } catch (error) {
    if (error instanceof HistoryQueryError)
      return NextResponse.json(err(error.message, error.code), { status: error.status, headers: noStore });
    const response = respondWithError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
