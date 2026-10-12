import { NextResponse } from "next/server";
import { prisma } from "@/globals/libs/prisma";
import { requireAuth } from "@/globals/utils/auth";
import { ok } from "@/globals/utils/api";
import { historySchema, readLibraryVisits } from "@/features/library/server";
import { libraryHttpError } from "@/features/library/http";
import { serializeCsv } from "@/globals/utils/csvExport";
import { formatReportDateTime } from "@/globals/utils/reportTime";

export async function GET(request: Request) {
  try {
    await requireAuth();
    const params = new URL(request.url).searchParams;
    const input = historySchema.parse(Object.fromEntries(params));
    const csv = params.get("format") === "csv";
    const result = await readLibraryVisits(prisma, input, new Date(), csv);
    if (!csv) return NextResponse.json(ok(result));
    const columns = ["Date", "ID", "Name", "Type", "Time In (Asia/Manila)", "Time Out (Asia/Manila)", "Status", "Corrected At (Asia/Manila)", "Corrected By", "Demonstration Data"];
    const rows = result.visits.map(v => ({
      Date: v.visitDay, ID: v.studentId, Name: [v.student.firstName, v.student.middleName, v.student.lastName].filter(Boolean).join(" "),
      Type: v.personType, "Time In (Asia/Manila)": formatReportDateTime(v.timeIn), "Time Out (Asia/Manila)": formatReportDateTime(v.timeOut),
      Status: v.status, "Corrected At (Asia/Manila)": formatReportDateTime(v.administrativelyClosedAt), "Corrected By": v.administrativelyClosedById,
      "Demonstration Data": v.isDemo ? "SIMULATED" : "",
    }));
    return new NextResponse(serializeCsv(columns, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="library-${result.range.start}-${result.range.end}${input.demo ? '-DEMO' : ''}.csv"`, "Cache-Control": "no-store" } });
  } catch (error) { return libraryHttpError(error); }
}
