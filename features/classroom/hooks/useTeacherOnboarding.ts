'use client';
import { useRef } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { ApiError,fetchApi } from '@/globals/utils/api';
import type { TeacherOnboardingState } from '../types/onboarding';
import { useClassroomCommand } from './useClassroomCommand';
export function useTeacherOnboarding(enabled=true){
  const {user}=useAuth();const client=useQueryClient();const command=useClassroomCommand();
  const key=['classroom','onboarding',user?.id];
  const query=useQuery({queryKey:key,enabled:enabled&&!!user,queryFn:({signal})=>fetchApi<TeacherOnboardingState>('/api/classroom/onboarding',{signal}),staleTime:0,
    retry:(count,error)=>!(error instanceof ApiError&&[401,403].includes(error.status))&&count<2});
  const pending=useRef<Record<string,unknown>|null>(null);
  const send=async(payload:Record<string,unknown>)=>{
    const result=await command.run<TeacherOnboardingState>('/api/classroom/onboarding','PUT',payload);
    if(!result)return false;
    pending.current=null;client.setQueryData(key,result);return true;
  };
  const save=async(payload:Record<string,unknown>)=>{
    if(!query.data||command.unconfirmed)return false;
    pending.current={expectedRevision:query.data.revision,...payload};
    return send(pending.current);
  };
  const retrySave=async()=>pending.current?send(pending.current):false;
  return {query,save,command,retrySave};
}
