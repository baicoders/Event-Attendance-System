'use client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { fetchApi } from '@/globals/utils/api';
import type { SessionRosterPage,AttendanceStatus } from '../types/attendance';
import { classroomReadRetry } from './useClassroomSession';
export function useClassroomRoster(sessionId:string,q:string,status:AttendanceStatus|'',page:number,includeExcluded=false){const {user}=useAuth();return useQuery({queryKey:['classroom','session-roster',user?.id,sessionId,q,status,page,includeExcluded],enabled:!!user,queryFn:({signal})=>fetchApi<SessionRosterPage>('/api/classroom/sessions/'+encodeURIComponent(sessionId)+'/roster?'+new URLSearchParams({q,...(status?{status}:{}),page:String(page),pageSize:'100',includeExcluded:String(includeExcluded)}),{signal}),retry:classroomReadRetry,staleTime:0});}
