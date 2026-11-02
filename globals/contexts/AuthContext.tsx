'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ClassroomAccessStatus } from '@/features/auth/utils/accessPolicy';
import { resolveWorkspaceDestination, type Workspace } from '@/features/auth/utils/workspaceDestination';
export type AuthUser = {
  id: string; name: string; email: string; role: 'ADMIN' | 'ORGANIZER' | 'MEMBER';
  status: 'PENDING' | 'ACTIVE' | 'REJECTED'; accountState?: 'ENABLED' | 'DISABLED';
  classroomStatus?: ClassroomAccessStatus | null;
  capabilities?: { events: boolean; classroom: boolean; admin: boolean };
  rejectionReason?: string | null; mustChangePassword?: boolean; credentialVersion?: number;
};
type LoginResult = { success: true; destination: string } | { success: false; message?: string };
type AuthContextValue = {
  user: AuthUser | null; isLoading: boolean; isUnavailable: boolean;
  login: (email: string, password: string, workspace?: Workspace) => Promise<LoginResult>;
  logout: () => Promise<boolean>; refresh: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | undefined>(undefined);
function signature(user: AuthUser | null) {
  return user ? [user.id, user.credentialVersion, user.role, user.status, user.classroomStatus, user.accountState, user.mustChangePassword].join(':') : '';
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isUnavailable, setUnavailable] = useState(false);
  const current = useRef<AuthUser | null>(null);
  const generation = useRef(0);
  const refreshSequence = useRef(0);
  const commit = useCallback((next: AuthUser | null) => {
    if (signature(current.current) !== signature(next)) window.dispatchEvent(new Event('auth:identity-change'));
    current.current = next;
    setUser(next);
    setUnavailable(false);
  }, []);
  const refresh = useCallback(async () => {
    const captured = generation.current;
    const sequence = ++refreshSequence.current;
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error('Session check unavailable');
      if (captured === generation.current && sequence === refreshSequence.current) commit(json.data);
    } catch {
      // An unreachable server is not evidence that a session was signed out.
      if (captured === generation.current && sequence === refreshSequence.current) setUnavailable(true);
    } finally {
      if (captured === generation.current && sequence === refreshSequence.current) setLoading(false);
    }
  }, [commit]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const update = () => { void refresh(); };
    window.addEventListener('auth:session-invalid', update);
    window.addEventListener('focus', update);
    return () => { window.removeEventListener('auth:session-invalid', update); window.removeEventListener('focus', update); };
  }, [refresh]);
  const login = useCallback(async (email: string, password: string, workspace: Workspace = 'EVENTS'): Promise<LoginResult> => {
    const captured = ++generation.current;
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, workspace }) });
    const json = await res.json();
    if (!res.ok || !json.success) return { success: false, message: json.message || 'Unable to sign in.' };
    if (captured !== generation.current) return { success: false, message: 'Sign-in changed. Try again.' };
    commit(json.data);
    return { success: true, destination: resolveWorkspaceDestination(json.data, workspace) };
  }, [commit]);
  const logout = useCallback(async (): Promise<boolean> => {
    ++generation.current;
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (!res.ok) return false;
    } catch { return false; }
    window.dispatchEvent(new Event('auth:signed-out'));
    commit(null);
    return true;
  }, [commit]);
  const value = useMemo(() => ({ user, isLoading, isUnavailable, login, logout, refresh }), [user, isLoading, isUnavailable, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
