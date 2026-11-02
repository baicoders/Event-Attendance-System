'use client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { ApiError,fetchApi } from '@/globals/utils/api';
import type { ClassDetails,RosterPage } from '../types/class';
export function useClassroomClass(classId:string){
 const {user}=useAuth();return useQuery({queryKey:['classroom','classes',user?.id,classId],enabled:!!user,queryFn:({signal})=>fetchApi<ClassDetails>('/api/classroom/classes/'+encodeURIComponent(classId),{signal}),staleTime:0,retry:(count,error)=>!(error instanceof ApiError&&[401,403,404].includes(error.status))&&count<2});
}
export function useClassRoster(classId:string,q='',page=1){
 const {user}=useAuth();return useQuery({queryKey:['classroom','roster',user?.id,classId,q,page],enabled:!!user,queryFn:({signal})=>fetchApi<RosterPage>('/api/classroom/classes/'+encodeURIComponent(classId)+'/roster?'+new URLSearchParams({q,page:String(page),pageSize:'100'}),{signal}),staleTime:0,retry:(count,error)=>!(error instanceof ApiError&&[401,403,404].includes(error.status))&&count<2});
}
