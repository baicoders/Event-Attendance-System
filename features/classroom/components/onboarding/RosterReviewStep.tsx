'use client';
import { ClipboardCheck } from 'lucide-react';

import { useState } from 'react';
import { Button } from '@/globals/components/shad-cn/button';
import { ActionFooter } from '../ui';
import type { TeacherOnboardingState } from '../../types/onboarding';
import RosterEditor from '../RosterEditor';
export default function RosterReviewStep({state,busy,retry,onSave,onRefresh}:{state:TeacherOnboardingState;busy:boolean;retry:boolean;onSave:(payload:Record<string,unknown>)=>Promise<boolean>;onRefresh:()=>void}){
  const [editor,setEditor]=useState({dirty:false,busy:false});
  if(!state.class||!state.readiness)return null;
  return <section className="space-y-5"><h2 className="text-xl font-semibold">Review your class roster</h2><p className="text-sm text-slate-600">These exceptions are saved for this class. You do not need to add irregular students again next meeting. Individual additions do not change official sections.</p><RosterEditor key={state.class.id} initial={state.class} onSaved={onRefresh} onStateChange={setEditor}/><p className="text-sm text-slate-600">Review the saved roster above, then continue. Include at least one existing student.</p><ActionFooter><Button className="min-h-12 w-full" disabled={busy||editor.dirty||editor.busy||!state.readiness.rosterCount} onClick={()=>void onSave({step:'ROSTER',expectedRosterRevision:state.readiness!.rosterRevision,rosterFingerprint:state.readiness!.rosterFingerprint})}><ClipboardCheck aria-hidden className="size-4 shrink-0"/>{busy?'Saving…':retry?'Retry same save':'I reviewed the saved roster'}</Button></ActionFooter></section>;
}
