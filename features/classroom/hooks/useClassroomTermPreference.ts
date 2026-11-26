'use client';
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { fetchApi } from '@/globals/utils/api';
import type { AcademicTermOption } from '../types/class';
export function useClassroomTermPreference(ready:boolean,setTerm:(id:string)=>void){
 const {user}=useAuth();const initialized=useRef('');
 const terms=useQuery({queryKey:['classroom','terms',user?.id,user?.role,user?.classroomStatus],queryFn:({signal})=>fetchApi<{items:AcademicTermOption[]}>('/api/classroom/terms?pageSize=100',{signal}),enabled:!!user});
 useEffect(()=>{if(!ready||!user||!terms.data||initialized.current===user.id)return;initialized.current=user.id;if(new URLSearchParams(window.location.search).has('termId'))return;const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const current=terms.data.items.filter(term=>term.startDate<=today&&term.endDate>=today);let stored:string|null=null;try{stored=sessionStorage.getItem('classroom:term:'+user.id);}catch{}if(stored!==null&&(!stored||terms.data.items.some(term=>term.id===stored)))setTerm(stored);else if(current.length===1)setTerm(current[0].id);},[ready,user,terms.data,setTerm]);
 return {terms,chooseTerm:(id:string)=>{setTerm(id);try{sessionStorage.setItem('classroom:term:'+user?.id,id);}catch{}}};
}
