'use client';
import { CalendarDays, GraduationCap } from 'lucide-react';
import { cn } from '@/globals/libs/shad-cn';
import type { Workspace } from '../utils/workspaceDestination';
export default function WorkspaceSelector({ value, onChange, disabled = false }: { value: Workspace; onChange: (value: Workspace) => void; disabled?: boolean }) {
  return <fieldset className="space-y-2" disabled={disabled}>
    <legend className="text-sm font-semibold text-slate-700">Workspace</legend>
    <div className="grid grid-cols-2 gap-3">
      {([{ id: 'EVENTS', label: 'Events', description: 'Event attendance', Icon: CalendarDays }, { id: 'CLASS', label: 'Class', description: 'Teacher attendance', Icon: GraduationCap }] as const).map(({ id, label, description, Icon }) =>
        <label key={id} className={cn('flex min-h-20 cursor-pointer items-center gap-2 rounded-2xl border p-3 transition focus-within:ring-2 focus-within:ring-indigo-400', value === id ? 'border-indigo-600 bg-indigo-50 text-indigo-900' : 'border-slate-200 text-slate-700', disabled && 'opacity-60')}>
          <input className="size-4 accent-indigo-600" type="radio" aria-label={label} aria-describedby={`workspace-${id}-description`} name="workspace" value={id} checked={value === id} onChange={() => onChange(id)} />
          <span><span className="flex items-center gap-1 text-sm font-semibold"><Icon aria-hidden className="size-4" />{label}</span><span id={`workspace-${id}-description`} className="mt-1 block text-xs text-slate-500">{description}</span></span>
        </label>)}
    </div>
  </fieldset>;
}
