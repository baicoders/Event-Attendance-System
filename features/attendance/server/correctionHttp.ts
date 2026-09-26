import { NextResponse } from "next/server";
import { err } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import { CorrectionError } from "./correctAttendance";

export async function readCorrectionBody(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new CorrectionError("Request body is required", 400, "INVALID_PAYLOAD");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 16 * 1024) {
      await reader.cancel();
      throw new CorrectionError("Request body exceeds 16 KiB", 413, "PAYLOAD_TOO_LARGE");
    }
    chunks.push(part.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CorrectionError("Invalid JSON payload", 400, "INVALID_PAYLOAD");
  }
}

export function respondWithCorrectionError(error: unknown) {
  if (error instanceof CorrectionError) return NextResponse.json(err(error.message, error.code), { status: error.status });
  return respondWithError(error);
}
