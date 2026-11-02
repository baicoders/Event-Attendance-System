'use client';
import { useRef,useState } from 'react';
import { ApiError,fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import type { DirectoryStudent } from '../types/student';
export default function VerificationPanel({student,onSaved}:{student:DirectoryStudent;onSaved:()=>void}){
 const [note,setNote]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [pendingState,setPendingState]=useState<string|null>(null);const pending=useRef<{commandId:string;state:string;expectedVersion:string;note:string}|null>(null);
 const save=async(state:'VERIFIED'|'NEEDS_CORRECTION')=>{
  if(busy)return;if(pending.current&&pending.current.state!==state){setError('Retry the unconfirmed verification before choosing a different result.');return;}
  if(!pending.current)pending.current={commandId:crypto.randomUUID(),state,expectedVersion:student.editVersion,note};setBusy(true);setError('');
  try{await fetchApi('/api/classroom/students/'+encodeURIComponent(student.id)+'/verifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending.current)});pending.current=null;setPendingState(null);setNote('');onSaved();}
  catch(cause){setError(cause instanceof ApiError?cause.message:'Verification not confirmed. Retry the same action.');if(cause instanceof ApiError&&cause.status<500){pending.current=null;setPendingState(null);}else setPendingState(state);}
  finally{setBusy(false);}
 };
 return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Student verification</h2><p role="status">{student.verification.state==='VERIFIED'?'Verified':student.verification.state==='NEEDS_CORRECTION'?'Needs correction':'Unverified'}</p><p className="text-sm text-slate-600">Verification applies to this version of the official record. A later correction requires verification again.</p>{student.verification.actorName?<p className="text-sm">{student.verification.actorName} · {student.verification.createdAt?new Date(student.verification.createdAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'}):''}</p>:null}{student.verification.note?<p className="whitespace-pre-wrap break-words text-sm">{student.verification.note}</p>:null}
 <label className="block text-sm font-medium">Verification note (optional)<textarea value={note} disabled={busy||!!pendingState} maxLength={1000} className="mt-2 min-h-20 w-full rounded-xl border p-3" onChange={event=>{setNote(event.target.value);pending.current=null;}}/></label>
 {error?<div role="alert" className="text-sm text-rose-700"><p>{error}</p>{!pendingState?<Button className="min-h-12" variant="outline" onClick={onSaved}>Reload current record</Button>:null}</div>:null}<div className="flex flex-wrap gap-3"><Button className="min-h-12" disabled={busy||pendingState==='NEEDS_CORRECTION'} onClick={()=>void save('VERIFIED')}>{busy?'Saving…':'Mark verified'}</Button><Button className="min-h-12" variant="outline" disabled={busy||pendingState==='VERIFIED'} onClick={()=>void save('NEEDS_CORRECTION')}>Needs correction</Button></div></section>;
}
