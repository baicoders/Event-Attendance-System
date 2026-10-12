import { NextResponse } from "next/server";
import { err } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import { LibraryError } from "./server";

export function libraryHttpError(error: unknown) {
  if (error instanceof LibraryError) return NextResponse.json(err(error.message, error.code), { status: error.status });
  if (error instanceof SyntaxError) return NextResponse.json(err("Invalid JSON payload"), { status: 400 });
  return respondWithError(error);
}
