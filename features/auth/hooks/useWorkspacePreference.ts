'use client';
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/globals/contexts/AuthContext';
import { workspaceCapabilities } from '../utils/accessPolicy';
import { readWorkspacePreference, type Workspace } from '../utils/workspaceDestination';
export function useWorkspacePreference() {
  const { user } = useAuth();
  const [workspace, setValue] = useState<Workspace>('EVENTS');
  const [ready, setReady] = useState(false);
  const grants = user ? workspaceCapabilities(user, user.classroomStatus) : null;
  useEffect(() => {
    let remembered: string | null = null;
    try { remembered = localStorage.getItem('attendance-workspace'); } catch {}
    setValue(readWorkspacePreference(window.location.search, remembered, grants?.classroom && !grants.events ? 'CLASS' : 'EVENTS'));
    setReady(true);
  }, [grants?.classroom, grants?.events]);
  const setWorkspace = useCallback((value: Workspace) => {
    setValue(value);
    try { localStorage.setItem('attendance-workspace', value); } catch {}
    document.cookie = `attendance-workspace=${value}; Path=/; SameSite=Lax; Max-Age=31536000`;
  }, []);
  return { workspace, setWorkspace, ready };
}
