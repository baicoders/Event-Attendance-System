'use client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { ApiError,fetchApi } from '@/globals/utils/api';
import type { ClassroomSession } from '../types/attendance';
export function classroomReadRetry(count:number,error:Error){return !(error instanceof ApiError&&[401,403,404].includes(error.status))&&count<2;}
export function useClassroomSession(sessionId:string){const {user}=useAuth();return useQuery({queryKey:['classroom','session',user?.id,sessionId],enabled:!!user,queryFn:({signal})=>fetchApi<ClassroomSession>('/api/classroom/sessions/'+encodeURIComponent(sessionId),{signal}),retry:classroomReadRetry,staleTime:0,refetchOnWindowFocus:true});}
