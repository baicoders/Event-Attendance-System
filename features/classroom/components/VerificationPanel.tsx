'use client';
import { BadgeCheck, Flag, MessageSquarePlus, RefreshCw } from 'lucide-react';
import { useRef,useState } from 'react';
import { ApiError,fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import { Textarea } from '@/globals/components/shad-cn/textarea';
import type { DirectoryStudent } from '../types/student';
import { ActionFooter, Feedback, SectionPanel, StatusBadge } from './ui';
export default function VerificationPanel({student,onSaved}:{student:DirectoryStudent;onSaved:()=>void}){
 const [note,setNote]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [pendingState,setPendingState]=useState<string|null>(null);const pending=useRef<{commandId:string;state:string;expectedVersion:string;note:string}|null>(null);
 const save=async(state:'VERIFIED'|'NEEDS_CORRECTION')=>{
  if(busy)return;if(pending.current&&pending.current.state!==state){setError('Retry the unconfirmed verification before choosing a different result.');return;}
  if(!pending.current)pending.current={commandId:crypto.randomUUID(),state,expectedVersion:student.editVersion,note};setBusy(true);setError('');
  try{await fetchApi('/api/classroom/students/'+encodeURIComponent(student.id)+'/verifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending.current)});pending.current=null;setPendingState(null);setNote('');onSaved();}
  catch(cause){setError(cause instanceof ApiError?cause.message:'Verification not confirmed. Retry the same action.');if(cause instanceof ApiError&&cause.status<500){pending.current=null;setPendingState(null);}else setPendingState(state);}
  finally{setBusy(false);}
 };
 return <SectionPanel title="Verify student details" icon={BadgeCheck} description="Check the name, USN/LRN, and section against school records to help keep attendance accurate. Changes to student details need another check. Verification is optional for attendance." actions={<span role="status"><StatusBadge tone={student.verification.state==='VERIFIED'?'success':student.verification.state==='NEEDS_CORRECTION'?'warning':'neutral'}>{student.verification.state==='VERIFIED'?'Verified':student.verification.state==='NEEDS_CORRECTION'?'Needs correction':'Unverified'}</StatusBadge></span>}>
 {student.verification.actorName?<p className="text-sm text-slate-500">Checked by {student.verification.actorName} · {student.verification.createdAt?new Date(student.verification.createdAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'}):''}</p>:null}{student.verification.note?<p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{student.verification.note}</p>:null}
 <details><summary className="min-h-12 cursor-pointer py-3 text-sm font-medium text-indigo-700"><MessageSquarePlus aria-hidden className="mr-2 inline size-4" />Add a note</summary><label className="block text-sm font-medium text-slate-700">Verification note (optional)<Textarea value={note} disabled={busy||!!pendingState} maxLength={1000} className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 p-3" onChange={event=>{setNote(event.target.value);pending.current=null;}}/></label></details>
 {error?<Feedback title="Verification not confirmed"><p>{error}</p>{!pendingState?<Button className="mt-3" variant="outline" onClick={onSaved}><RefreshCw aria-hidden className="size-4" />Reload current record</Button>:null}</Feedback>:null}<ActionFooter><Button disabled={busy||pendingState==='NEEDS_CORRECTION'} onClick={()=>void save('VERIFIED')}><BadgeCheck aria-hidden className="size-4" />{busy?'Saving…':'Verify details'}</Button><Button variant="outline" disabled={busy||pendingState==='VERIFIED'} onClick={()=>void save('NEEDS_CORRECTION')}><Flag aria-hidden className="size-4" />Flag for correction</Button></ActionFooter></SectionPanel>;
}
