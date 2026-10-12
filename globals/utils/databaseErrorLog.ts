/** Server-only diagnostics: omit Prisma's invocation, SQL and query values. */
export function databaseErrorLog(error: unknown) {
  const value = error as {
    name?: unknown;
    code?: unknown;
    meta?: { driverAdapterError?: { cause?: {
      kind?: unknown; reason?: unknown; originalCode?: unknown; originalMessage?: unknown;
    } }; message?: unknown };
  } | null;
  const cause = value?.meta?.driverAdapterError?.cause;
  const detail = cause?.reason ?? cause?.originalMessage ?? value?.meta?.message;
  return {
    ...(typeof value?.name === "string" ? { name: value.name } : {}),
    ...(typeof value?.code === "string" ? { code: value.code } : {}),
    ...(typeof cause?.kind === "string" ? { kind: cause.kind } : {}),
    ...(typeof cause?.originalCode === "string" ? { driverCode: cause.originalCode } : {}),
    ...(typeof detail === "string" ? {
      detail: detail.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_URL]").slice(0, 1000),
    } : {}),
  };
}
