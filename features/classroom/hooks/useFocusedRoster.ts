'use client';
import { useEffect, useRef, useState } from 'react';
import { fetchApi } from '@/globals/utils/api';
import type { AttendanceRecord, SessionMember, SessionRosterPage } from '../types/attendance';
import { reconcileFocusedRoster, confirmFocusedStudent } from '../utils/focusedRoster';

type BufferState={key:string;items:SessionMember[]};
/** Keep a stable current student; always refill the shrinking result from page 1. */
export function useFocusedRoster(sessionId:string,q:string,data:SessionRosterPage|undefined,updatedAt:number,enabled:boolean){
 const key=sessionId+'\0'+q;const [buffer,setBuffer]=useState<BufferState>({key,items:[]});
 const confirmed=useRef(new Map<string,number>());const activeSession=useRef(sessionId);
 const [checking,setChecking]=useState('');const [notice,setNotice]=useState('');
 if(activeSession.current!==sessionId){activeSession.current=sessionId;confirmed.current=new Map();}
 const items=buffer.key===key?buffer.items:[];const current=items[0];
 useEffect(()=>{if(!enabled||!data)return;setBuffer(previous=>({key,items:reconcileFocusedRoster(previous.key===key?previous.items:[],data.items,confirmed.current)}));},[data,updatedAt,key,enabled]);
 const missingId=enabled&&current&&data&&!data.items.some(member=>member.studentId===current.studentId)?current.studentId:'';
 useEffect(()=>{
  if(!missingId){setChecking('');return;}
  let stopped=false;const controller=new AbortController();setChecking(missingId);
  // Search without a status filter, including excluded members. A concurrent
  // mark/exclusion must be read authoritatively before another decision.
  void fetchApi<SessionRosterPage>('/api/classroom/sessions/'+encodeURIComponent(sessionId)+'/roster?'+new URLSearchParams({q:missingId,page:'1',pageSize:'100',includeExcluded:'true'}),{signal:controller.signal}).then(page=>{
   if(stopped)return;const authoritative=page.items.find(member=>member.studentId===missingId);
   setBuffer(previous=>{
    if(previous.key!==key||previous.items[0]?.studentId!==missingId)return previous;
    if(!authoritative||!authoritative.included||authoritative.attendance.status!=='UNMARKED')return {...previous,items:previous.items.filter(member=>member.studentId!==missingId)};
    return {...previous,items:[authoritative,...previous.items.slice(1)]};
   });
   if(!authoritative?.included)setNotice('The current student is no longer included in this session.');
   else if(authoritative.attendance.status!=='UNMARKED')setNotice('This student was marked on another device. The saved result has been kept.');
   setChecking('');
  }).catch(()=>{if(!stopped)setNotice('Unable to check the current student. Refresh the roster before continuing.');});
  return()=>{stopped=true;controller.abort();};
 },[missingId,updatedAt,sessionId,key]);
 return {current,checking:!!checking,notice,confirm:(record:AttendanceRecord)=>{
  setNotice('');setBuffer(previous=>({...previous,items:confirmFocusedStudent(previous.items,confirmed.current,record)}));
 },clearNotice:()=>setNotice('')};
}
