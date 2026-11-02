'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/globals/components/shad-cn/button';
import FormInput from '@/globals/components/shared/FormInput';
import { Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription } from '@/globals/components/shad-cn/sheet';
import { termSchema,subjectSchema } from '../schemas/classSchema';
import { useClassroomCommand } from '../hooks/useClassroomCommand';
import type { AcademicTermOption,SubjectOption } from '../types/class';
export default function CatalogCreateSheet({kind,onChoose,onClose}:{kind:'term'|'subject';onChoose:(item:AcademicTermOption|SubjectOption)=>void;onClose:()=>void}){
 const command=useClassroomCommand();const client=useQueryClient();const [name,setName]=useState('');const [code,setCode]=useState('');const [start,setStart]=useState('');const [end,setEnd]=useState('');const [error,setError]=useState('');
 const disabled=command.busy||command.unconfirmed;const existing=command.problem?.details?.existing as AcademicTermOption|SubjectOption|undefined;
 const choose=(item:AcademicTermOption|SubjectOption)=>{void client.invalidateQueries({queryKey:['classroom',kind==='term'?'terms':'subjects']});onChoose(item);};
 return <Sheet open onOpenChange={open=>{if(!open&&!command.busy&&!command.unconfirmed)onClose();}}><SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>{kind==='term'?'Add academic term':'Add subject'}</SheetTitle><SheetDescription>Available immediately after saving. Check existing choices first to keep the shared catalog clear.</SheetDescription></SheetHeader>
 <form className="space-y-4 p-4" onSubmit={async event=>{event.preventDefault();event.stopPropagation();const input=kind==='term'?termSchema.safeParse({commandId:crypto.randomUUID(),name,startDate:start,endDate:end}):subjectSchema.safeParse({commandId:crypto.randomUUID(),title:name,code:code||null});if(!input.success){setError(input.error.issues[0]?.message??'Check the fields.');return;}setError('');const saved=await command.run<AcademicTermOption|SubjectOption>('/api/classroom/'+(kind==='term'?'terms':'subjects'),'POST',input.data);if(saved)choose(saved);}}>
 <FormInput label={kind==='term'?'Term name':'Subject title'} className="min-h-12" required maxLength={kind==='term'?100:160} value={name} disabled={disabled} onChange={event=>setName(event.target.value)} />
 {kind==='term'?<><FormInput label="Term starts" className="min-h-12" type="date" required value={start} disabled={disabled} onChange={event=>setStart(event.target.value)}/><FormInput label="Term ends" className="min-h-12" type="date" required min={start||undefined} value={end} disabled={disabled} onChange={event=>setEnd(event.target.value)}/><p className="text-sm text-slate-600">Use the school’s actual academic dates. Times use Asia/Manila.</p></>:<FormInput label="Subject code (optional)" className="min-h-12" maxLength={40} value={code} disabled={disabled} onChange={event=>setCode(event.target.value)}/>}
 {error||command.error?<p role="alert" className="text-sm text-rose-700">{error||command.error}</p>:null}
 {existing&&typeof existing.id==='string'&&!existing.archivedAt?<Button className="min-h-12 w-full whitespace-normal" variant="outline" onClick={()=>choose(existing)}>Use existing {'name' in existing?existing.name:existing.title}</Button>:null}
 <Button type="submit" className="min-h-12 w-full" disabled={command.busy}>{command.busy?'Saving…':command.unconfirmed?'Retry same save':kind==='term'?'Save term':'Save subject'}</Button><Button className="min-h-12 w-full" variant="outline" disabled={command.busy||command.unconfirmed} onClick={onClose}>Cancel</Button>
 </form></SheetContent></Sheet>;
}
