'use client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/globals/contexts/AuthContext';
import { fetchApi } from '@/globals/utils/api';
import { classroomReadRetry } from './useClassroomSession';
import type { ClassroomReportFilters,ClassroomReportPage } from '../types/report';
export function reportSearchParams(filters:ClassroomReportFilters){return new URLSearchParams(Object.entries(filters).filter((entry):entry is [string,string]=>typeof entry[1]==='string'&&!!entry[1]));}
export function useClassroomReports(filters:ClassroomReportFilters|null,page:number,q=''){const {user}=useAuth();return useQuery({queryKey:['classroom','report',user?.id,filters,page,q],enabled:!!user&&!!filters,queryFn:({signal})=>fetchApi<ClassroomReportPage>('/api/classroom/reports?'+reportSearchParams({...filters}).toString()+'&page='+page+'&pageSize=100&q='+encodeURIComponent(q),{signal}),placeholderData:(previous,previousQuery)=>previousQuery?.queryKey[2]===user?.id&&JSON.stringify(previousQuery?.queryKey[3])===JSON.stringify(filters)?previous:undefined,retry:classroomReadRetry,staleTime:0});}
