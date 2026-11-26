'use client';
import { ArrowRight } from 'lucide-react';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { fetchApi } from '@/globals/utils/api';
import { Button } from '@/globals/components/shad-cn/button';
import { ClassroomSelect } from '../ui';
import ClassForm from '../ClassForm';
import type { FirstClassDraft } from '../../schemas/onboardingSchema';
import type { ClassList } from '../../types/class';
import type { TeacherOnboardingState } from '../../types/onboarding';
export default function FirstClassStep({state,busy,retry,onSave,onRefresh}:{state:TeacherOnboardingState;busy:boolean;retry:boolean;onSave:(payload:Record<string,unknown>)=>Promise<boolean>;onRefresh:()=>void}){
  const {user}=useAuth();const [chosen,setChosen]=useState('');const [message,setMessage]=useState('');const [page,setPage]=useState(1);
  const existing=useQuery({queryKey:['classroom','classes',user?.id,'setup',page],queryFn:()=>fetchApi<ClassList>('/api/classroom/classes?pageSize=100&page='+page)});
  const saveDraft=async(draft:FirstClassDraft)=>{setMessage('');if(await onSave({step:'DRAFT',draft:{classForm:draft}}))setMessage('Setup draft saved. You can return to it later.');};
  return <section className="space-y-5"><h2 className="text-xl font-semibold">Set up your first class</h2><p className="text-sm text-slate-600">A class is one subject offering in an academic term. You can teach the same subject to other sections in a separate class.</p>{state.classUnavailable?<p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3">Your previous setup class is unavailable. Choose another class you own or create one below.</p>:null}
  {existing.data?.items.some(item=>item.primaryTeacherId===user?.id)?<div className="space-y-3 rounded-2xl border bg-white p-4"><ClassroomSelect label="Use an existing class" value={chosen} disabled={busy||retry} onValueChange={setChosen} options={[{value:'',label:'Choose one of my classes'},...existing.data.items.filter(item=>item.primaryTeacherId===user?.id).map(item=>({value:item.id,label:item.displayName}))]}/><Button className="min-h-12 w-full" variant="outline" disabled={busy||!chosen} onClick={()=>void onSave({step:'CLASS',classId:chosen})}><ArrowRight aria-hidden className="size-4 shrink-0"/>{retry?'Retry same save':'Continue with this class'}</Button></div>:null}
  {existing.isError?<p role="alert">Unable to load existing classes. <button className="min-h-12 text-sm font-semibold underline" onClick={()=>void existing.refetch()}>Retry classes</button></p>:null}{existing.data&&existing.data.total>100?<div className="flex gap-2"><Button className="min-h-12" variant="outline" disabled={page===1} onClick={()=>setPage(value=>value-1)}>Previous classes</Button><Button className="min-h-12" variant="outline" disabled={page*100>=existing.data.total} onClick={()=>setPage(value=>value+1)}>Next classes</Button></div>:null}
  <ClassForm onSaved={onRefresh} setup={{revision:state.revision,draft:state.draft.classForm,...state.draftChoices,busy:busy||retry,onSaveDraft:draft=>void saveDraft(draft)}}/>{message?<p role="status" className="text-sm text-indigo-700">{message}</p>:null}</section>;
}
