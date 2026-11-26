'use client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { fetchApi } from '@/globals/utils/api';
import { classroomReadRetry } from './useClassroomSession';
import type { ClassroomReportSelection,ClassroomReportPage } from '../types/report';
export function reportSearchParams(filters:ClassroomReportSelection){return new URLSearchParams(Object.entries(filters).filter((entry):entry is [string,string]=>typeof entry[1]==='string'&&!!entry[1]));}
export function useClassroomReports(filters:ClassroomReportSelection|null,page:number,q=''){
 const {user}=useAuth();
 return useQuery({
  queryKey:['classroom','report',user?.id,filters,page,q],enabled:!!user&&!!filters,
  queryFn:({signal})=>{
   const params=reportSearchParams({...filters});
   params.delete('view');
   params.set('page',String(page));
   params.set('pageSize','100');
   params.set('q',q);
   return fetchApi<ClassroomReportPage>('/api/classroom/reports?'+params,{signal});
  },
  placeholderData:(previous,previousQuery)=>previousQuery?.queryKey[2]===user?.id&&
   JSON.stringify(previousQuery?.queryKey[3])===JSON.stringify(filters)?previous:undefined,
  retry:classroomReadRetry,staleTime:0,
 });
}
