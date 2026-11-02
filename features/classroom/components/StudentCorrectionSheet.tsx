'use client';
import { useRef,useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SchoolLevel,YearLevel } from '@prisma/client';
import { ApiError,fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import { Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription } from '@/globals/components/shad-cn/sheet';
import FormInput from '@/globals/components/shared/FormInput';
import { studentCorrectionSchema } from '../schemas/studentCorrectionSchema';
import type { DirectoryStudent,StudentOptions } from '../types/student';
const fields=['firstName','lastName','middleName','usn','lrn','schoolLevel','yearLevel','section','department','program','strand'] as const;
const labels={firstName:'First name',lastName:'Last name',middleName:'Middle name',usn:'USN',lrn:'LRN',schoolLevel:'School level',yearLevel:'Year level',section:'Official section',department:'Department',program:'Program',strand:'Strand'};
const groupCategories={section:'SECTION',department:'DEPARTMENT',program:'PROGRAM',strand:'STRAND'};
export default function StudentCorrectionSheet({student,onClose,onSaved}:{student:DirectoryStudent;onClose:()=>void;onSaved:()=>void}){
 const [original]=useState(student);
 const reviewFields=Object.entries(groupCategories).filter(([,category])=>original.groups.filter(group=>group.category===category).length>1).map(([field])=>field);
 const [values,setValues]=useState(()=>Object.fromEntries(fields.map(field=>[field,reviewFields.includes(field)?'__REVIEW__':student[field]??''])) as Record<typeof fields[number],string>);
 const [version,setVersion]=useState(student.editVersion);const [reason,setReason]=useState('');const [disposition,setDisposition]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [conflict,setConflict]=useState(false);const [comparison,setComparison]=useState('');
 const pending=useRef<unknown>(null);
 const options=useQuery({queryKey:['classroom','student-options'],queryFn:()=>fetchApi<StudentOptions>('/api/classroom/student-options')});
 const removed=[original.usn,original.lrn].filter(code=>code&&![values.usn,values.lrn].includes(code));
 const edit=(field:typeof fields[number],value:string)=>{setValues(current=>({...current,[field]:value}));pending.current=null;};
 return <Sheet open onOpenChange={open=>{if(!open&&!busy)onClose();}}><SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>Correct student information</SheetTitle><SheetDescription>Changes update the shared official record and are recorded with your name. Class roster exceptions do not change official sections.</SheetDescription></SheetHeader>
 <form className="space-y-4 p-4" onSubmit={async event=>{
  event.preventDefault();if(busy||conflict)return;
  if(reviewFields.some(field=>values[field as keyof typeof values]==='__REVIEW__')){setError('Choose which official assignment to keep for each duplicate group.');return;}
  const patch=Object.fromEntries(fields.filter(field=>reviewFields.includes(field)||(values[field]||null)!==(original[field]||null)).map(field=>[field,values[field]||null]));
  const parsed=studentCorrectionSchema.safeParse({commandId:crypto.randomUUID(),expectedVersion:version,student:patch,reason,...(removed.length?{identifierDisposition:disposition}:{})});
  if(!parsed.success){setError(parsed.error.issues[0]?.message??'Check the fields.');return;}
  if(!pending.current)pending.current=parsed.data;
  setBusy(true);setError('');
  try{await fetchApi('/api/classroom/students/'+encodeURIComponent(student.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending.current)});onSaved();}
  catch(cause){setError(cause instanceof ApiError?cause.message:'Save not confirmed. Keep your entries and retry the same request.');if(cause instanceof ApiError&&cause.status<500){pending.current=null;if(cause.code==='STUDENT_EDIT_CONFLICT')setConflict(true);}}
  finally{setBusy(false);}
 }}>
 {fields.map(field=>{
  const choices=field==='schoolLevel'?Object.values(SchoolLevel).map(value=>({value,label:value})):field==='yearLevel'?Object.values(YearLevel).map(value=>({value,label:value.replaceAll('_',' ')})):field in groupCategories?options.data?.filter(group=>group.category===groupCategories[field as keyof typeof groupCategories]).map(group=>({value:group.slug,label:group.name})):null;
  return choices!==null?<label key={field} className="block text-sm font-medium">{labels[field]}<select aria-label={labels[field]} className="mt-2 min-h-12 w-full rounded-xl border bg-white p-3" disabled={busy||options.isLoading} value={values[field]} onChange={event=>edit(field,event.target.value)}>{reviewFields.includes(field)?<option value="__REVIEW__" disabled>Choose one official assignment</option>:null}<option value="">Not set</option>{choices?.map(choice=><option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></label>:<FormInput key={field} label={labels[field]} className="min-h-12" maxLength={field==='lrn'?12:100} disabled={busy} value={values[field]} onChange={event=>edit(field,event.target.value)} />;
 })}
 {reviewFields.length?<p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">This record has duplicate official assignments: {original.groups.filter(group=>reviewFields.some(field=>groupCategories[field as keyof typeof groupCategories]===group.category)).map(group=>group.name).join(', ')}. Choose which one to keep, or explicitly clear the assignment. Your reason and before/after record will be saved.</p>:null}
 {options.isError?<p role="alert">Unable to load official groups. <button type="button" className="min-h-12 underline" onClick={()=>void options.refetch()}>Retry group options</button></p>:null}
 {removed.length?<label className="block space-y-2 text-sm font-medium">Existing printed QR cards<p className="font-normal">Old values: {removed.join(', ')}. A reserved value can never identify a different person.</p><select aria-label="Existing printed QR cards" required className="min-h-12 w-full rounded-xl border bg-white p-3" disabled={busy} value={disposition} onChange={event=>{setDisposition(event.target.value);pending.current=null;}}><option value="">Choose card handling</option><option value="KEEP_ALIAS_CONFIRMED">Confirmed same student — keep old cards working</option><option value="REPRINT_REQUIRED">Retire old values — reprint cards</option></select></label>:null}
 <label className="block text-sm font-medium">Reason for correction<textarea required maxLength={1000} className="mt-2 min-h-24 w-full rounded-xl border p-3" disabled={busy} value={reason} onChange={event=>{setReason(event.target.value);pending.current=null;}}/></label>
 {comparison?<p role="status" className="rounded-xl bg-indigo-50 p-3 text-sm">{comparison}</p>:null}
 {error?<div role="alert" className="space-y-3 text-sm text-rose-700"><p>{error}</p>{conflict?<Button className="min-h-12 whitespace-normal" type="button" variant="outline" onClick={async()=>{try{const latest=await fetchApi<DirectoryStudent>('/api/classroom/students/'+encodeURIComponent(student.id));setVersion(latest.editVersion);setComparison('Current record: '+latest.lastName+', '+latest.firstName+' · '+(latest.usn||latest.lrn)+'. Your edited fields are retained. Review them before saving again.');setConflict(false);setError('');pending.current=null;}catch{setError('Unable to reload. Your draft is retained.');}}}>Reload latest and keep my edited fields</Button>:null}</div>:null}
 <Button type="submit" className="min-h-12 w-full" disabled={busy||conflict||options.isError}>{busy?'Saving…':'Save correction'}</Button><Button className="min-h-12 w-full" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
 </form></SheetContent></Sheet>;
}
