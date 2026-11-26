'use client';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, X, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/globals/components/shad-cn/dialog';
import { Button } from '@/globals/components/shad-cn/button';
import { useAuth } from '@/globals/contexts/AuthContext';
import { useWorkspacePreference } from '../hooks/useWorkspacePreference';
import { resolveWorkspaceDestination } from '../utils/workspaceDestination';
const OpenerContext = createContext<{ current: HTMLElement | null; originUrl: string }>({ current: null, originUrl: '' });
/** Capture the link before a route transition moves focus into the dialog. */
export function AccountDialogNavigation({ children }: { children: ReactNode }) {
 const opener = useRef<{ current: HTMLElement | null; originUrl: string }>({ current: null, originUrl: '' });
 useEffect(() => {
  const capture = (event: MouseEvent) => { const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null; if (link && ['/account/settings', '/account/events-access'].includes(new URL(link.href).pathname)) Object.assign(opener.current, { originUrl: window.location.href, current: link.closest<HTMLElement>('[role="menu"]') ? document.querySelector<HTMLElement>('[data-slot="dropdown-menu-trigger"][data-state="open"]') ?? link : link }); };
  document.addEventListener('click', capture, true); return () => document.removeEventListener('click', capture, true);
 }, []);
 return <OpenerContext.Provider value={opener.current}>{children}</OpenerContext.Provider>;
}
export default function AccountDialog({ title, description, icon: Icon, intercepted = false, locked = false, busy = false, children, footer }: { title: string; description: string; icon: LucideIcon; intercepted?: boolean; locked?: boolean; busy?: boolean; children: ReactNode; footer?: ReactNode }) {
 const router = useRouter(); const { user } = useAuth(); const { workspace, ready } = useWorkspacePreference(); const opener = useContext(OpenerContext); const [open, setOpen] = useState(true);
 const blocked = locked || busy;
 const close = () => { if (blocked) return; setOpen(false); if (intercepted) router.back(); else { const destination = resolveWorkspaceDestination(user, workspace); router.replace(destination === window.location.pathname ? resolveWorkspaceDestination(user, workspace === 'EVENTS' ? 'CLASS' : 'EVENTS') : destination); } };
 useLayoutEffect(() => {
  if (!busy && !locked) return;
  const pendingUrl = window.location.href;
  // App Router has no beforePopState. Capture traversal before its listener,
  // then restore the original entry without adding or replacing history entries.
  const browserNavigation = (window as Window & { navigation?: EventTarget & { currentEntry?: { index: number } } }).navigation;
  const entryIndex = () => browserNavigation?.currentEntry?.index;
  // Modern browsers can traverse before App Router receives popstate.
  const beforeNavigate = (event: Event) => { if ((event as Event & { navigationType?: string }).navigationType === 'traverse' && event.cancelable) event.preventDefault(); };
  const pendingIndex = entryIndex();
  const prevent = (event: Event) => event.preventDefault();
  const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
  const navigation = (event: PopStateEvent) => {
   event.stopImmediatePropagation();
   if (window.location.href === pendingUrl) return;
   const index = entryIndex();
   if (pendingIndex !== undefined && index !== undefined && pendingIndex !== index) window.history.go(pendingIndex - index);
   else if (!intercepted || window.location.href === opener.originUrl) window.history.forward();
   else window.history.back();
  };
  const link = (event: MouseEvent) => { if (event.target instanceof Element && event.target.closest('a[href]')) { event.preventDefault(); event.stopImmediatePropagation(); } };
  browserNavigation?.addEventListener('navigate', beforeNavigate);
  window.addEventListener('workspace:before-change', prevent);
  window.addEventListener('beforeunload', unload);
  window.addEventListener('popstate', navigation, true);
  document.addEventListener('click', link, true);
  return () => { browserNavigation?.removeEventListener('navigate', beforeNavigate); window.removeEventListener('workspace:before-change', prevent); window.removeEventListener('beforeunload', unload); window.removeEventListener('popstate', navigation, true); document.removeEventListener('click', link, true); };
 }, [busy, locked, intercepted, opener]);
 return <>{!intercepted ? <main className="min-h-dvh bg-slate-100" aria-label="Account" /> : null}<Dialog open={open} onOpenChange={value => { if (!value) close(); }}><DialogContent showCloseButton={false} className="flex bg-white text-slate-900 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-xl motion-reduce:animate-none [&_button]:min-h-12 [&_button]:min-w-12" onEscapeKeyDown={event => { if (blocked) event.preventDefault(); }} onPointerDownOutside={event => { if (blocked) event.preventDefault(); }} onInteractOutside={event => { if (blocked) event.preventDefault(); }} onCloseAutoFocus={event => { if (intercepted && opener.current?.isConnected) { event.preventDefault(); opener.current.focus({ preventScroll: true }); } }}>
 <header className="relative shrink-0 border-b border-slate-200 p-5 pr-16 sm:p-6 sm:pr-16"><div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700"><Icon aria-hidden className="size-5" /></div><DialogTitle className="break-words text-xl leading-7">{title}</DialogTitle><DialogDescription className="mt-2 leading-6">{description}</DialogDescription>{!locked ? <Button size="icon" variant="ghost" aria-label="Close" disabled={busy || !ready} className="absolute right-3 top-3 size-12" onClick={close}><X aria-hidden className="size-4" /></Button> : null}</header>
 <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain p-5 sm:p-6">{children}</div><footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 p-4 sm:px-6">{footer}{!locked ? <Button variant="outline" disabled={busy || !ready} onClick={close}><ArrowLeft aria-hidden className="size-4" />{intercepted ? 'Back' : 'Return to workspace'}</Button> : null}</footer>
 </DialogContent></Dialog></>;
}
