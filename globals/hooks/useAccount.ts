import { fetchApi } from "@/globals/utils/api";
import type { AuthUser } from "@/globals/contexts/AuthContext";

export type ChangePasswordArgs = {
  currentPassword: string;
  newPassword: string;
};

/**
 * Imperative password-change request — deliberately NOT a `useMutation`. A
 * shared mutation cache would retain current/new-password arguments in
 * history; callers hold busy/result in component-local state instead and
 * clear inputs after success or an unknown commit outcome.
 *
 * The server re-issues the session cookie, but the client's `AuthUser` is held
 * in React state and fetched once on mount - callers must follow a success with
 * `useAuth().refresh()` so a cleared `mustChangePassword` actually lifts the
 * forced-change gate.
 */
export async function changePasswordApi(
  args: ChangePasswordArgs,
): Promise<AuthUser> {
  return fetchApi<AuthUser>("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}
