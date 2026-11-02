export class ApiError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;
  hasValidResponse: boolean;

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>, hasValidResponse = true) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.hasValidResponse = hasValidResponse;
  }
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; message: string; code?: string; details?: Record<string, unknown> };

export function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function err(message: string, code?: string, details?: Record<string, unknown>): ApiResponse<never> {
  return { success: false, message, code, ...(details ? { details } : {}) };
}

/**
 * Broadcast when a response proves the held session is no longer usable:
 * version-revoked (401 UNAUTHORIZED) or restricted
 * (403 PASSWORD_CHANGE_REQUIRED). Listeners (AuthContext, query cache) hide
 * protected views and refresh instead of treating it as a generic failure.
 * Login-form 401s carry no UNAUTHORIZED code and never fire this.
 */
function notifySessionInvalid(status: number, code?: string) {
  if (typeof window === "undefined") return;
  if (!["UNAUTHORIZED", "PASSWORD_CHANGE_REQUIRED", "ACCOUNT_DISABLED", "CLASSROOM_ACCESS_REQUIRED", "CLASSROOM_SUSPENDED"].includes(code ?? "")) return;
  window.dispatchEvent(
    new CustomEvent("auth:session-invalid", { detail: { status, code } }),
  );
}

/**
 * Fetch wrapper that converts non-ok or application errors into thrown ApiError,
 * and returns the data typed as T.
 */
export async function fetchApi<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T> {
  // 1. Perform the HTTP request
  const res = await fetch(input, init);

  // 2. Try to parse JSON safely
  let json: ApiResponse<T> | null = null;
  try {
    json = await res.json();
  } catch {
    // If server returned non-JSON response
    throw new ApiError("Invalid server response", res.status, undefined, undefined, false);
  }

  // If JSON doesnt exist
  if (!json || typeof json !== "object" || typeof json.success !== "boolean" || (json.success ? !Object.hasOwn(json,"data") : typeof json.message !== "string")) {
    throw new ApiError("Invalid server response", res.status, undefined, undefined, false);
  }

  // 3. Handle HTTP-level errors (404, 500, etc.)
  if (!res.ok) {
    if (json && !json.success) {
      notifySessionInvalid(res.status, json.code);
      throw new ApiError(json.message, res.status, json.code, json.details);
    }

    throw new ApiError("Invalid server response", res.status, undefined, undefined, false);
  }

  // 4. Handle application-level errors
  if (!json.success) {
    notifySessionInvalid(res.status, json.code);
    throw new ApiError(json.message, res.status, json.code, json.details);
  }

  // 5. Success: return the typed data
  return json.data;
}
