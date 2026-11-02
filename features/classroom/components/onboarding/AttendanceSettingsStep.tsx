'use client';
import { useState } from 'react';
import { Button } from '@/globals/components/shad-cn/button';
import type { TeacherOnboardingState } from '../../types/onboarding';
import ClassForm from '../ClassForm';
export default function AttendanceSettingsStep({state,busy,retry,onSave,onRefresh}:{state:TeacherOnboardingState;busy:boolean;retry:boolean;onSave:(payload:Record<string,unknown>)=>Promise<boolean>;onRefresh:()=>void}){
  const [editing,setEditing]=useState(false);if(!state.class)return null;
  return <section className="space-y-5"><h2 className="text-xl font-semibold">Review attendance settings</h2><div className="space-y-3 rounded-2xl border bg-white p-5"><p>Asia/Manila · {state.class.graceMinutes} minute grace period</p><p>{state.class.schedule?'Scheduled start: '+state.class.schedule.startTime:'No weekly schedule. You choose the start time for each meeting.'}</p><p className="text-sm">With an 8:00 AM start and 15 minute grace: 8:10 AM is Present, and 8:20 AM is Late. Late still counts as attended.</p><p className="text-sm">Students begin Unmarked. Remaining unmarked students become Absent only when you finalize. Excused has an optional note.</p></div>
  {editing?<><ClassForm initial={state.class} onSaved={()=>{setEditing(false);onRefresh();}}/><Button className="min-h-12 w-full" variant="outline" onClick={()=>setEditing(false)}>Return to saved settings</Button></>:<><Button className="min-h-12 w-full" variant="outline" disabled={busy||retry} onClick={()=>setEditing(true)}>Edit attendance settings</Button><Button className="min-h-12 w-full" disabled={busy} onClick={()=>void onSave({step:'SETTINGS',expectedConfigRevision:state.class!.configRevision})}>{busy?'Saving…':retry?'Retry same save':'Use these saved settings'}</Button></>}</section>;
}
