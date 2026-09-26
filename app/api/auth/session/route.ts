import { NextResponse } from "next/server";

import { ok } from "@/globals/utils/api";
import { getFreshAuthSession } from "@/globals/utils/auth";

export async function GET() {
  // Revalidated against the database so the UI reflects role/status changes
  // (approval, rejection, demotion) without waiting for cookie expiry.
  // Deliberately returns a valid forced-change identity (not null) so the
  // shell can render the replacement form; version-mismatched cookies become
  // null here. No business data.
  const session = await getFreshAuthSession();
  return NextResponse.json(ok(session), {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
