"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type UserStatus = "PENDING" | "ACTIVE" | "REJECTED";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "ORGANIZER";
  status: UserStatus;
  rejectionReason?: string | null;
  /** True while an admin-issued temporary password is still in place. */
  mustChangePassword?: boolean;
  /** Mirrors the server's credential generation; never sent anywhere. */
  credentialVersion?: number;
};

type LoginResult =
  | { success: true }
  | { success: false; message?: string };

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<boolean>;
  /**
   * Re-reads the session from the server. The session is otherwise fetched
   * exactly once on mount, so anything that changes the stored user mid-session
   * (a password change clearing `mustChangePassword`) must call this.
   */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchSession(): Promise<AuthUser | null> {
  // Never throw - an unreachable server must resolve to "not logged in",
  // otherwise the app hangs forever on "Checking access".
  try {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return null;
    }
    return json.data;
  } catch {
    return null;
  }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const session = await fetchSession();
      if (mounted) {
        setUser(session);
        setIsLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const json = await res.json();

    if (!res.ok || !json.success) {
      return {
        success: false,
        message: json.message || "Unable to sign in.",
      };
    }

    setUser(json.data);
    return { success: true };
  };

  const logout = async (): Promise<boolean> => {
    // Only clear local state if the server actually deleted the cookie -
    // otherwise the browser still holds a valid session while the UI shows
    // "logged out", which is worse than surfacing a failed logout.
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) {
        return false;
      }
    } catch {
      return false;
    }

    setUser(null);
    return true;
  };

  const refresh = async () => {
    setUser(await fetchSession());
  };

  // A version-revoked cookie (401 UNAUTHORIZED) or a newly restricted session
  // (403 PASSWORD_CHANGE_REQUIRED) must hide protected views and re-read the
  // session — without navigating away from a pending operation as though it
  // failed before commit. fetchApi broadcasts these; login-form 401s never do.
  useEffect(() => {
    const onInvalid = () => {
      void refresh();
    };
    window.addEventListener("auth:session-invalid", onInvalid);
    return () => window.removeEventListener("auth:session-invalid", onInvalid);
  }, []);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      login,
      logout,
      refresh,
    }),
    [user, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
};
