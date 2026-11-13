'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import { useAuth } from '@/globals/contexts/AuthContext';
import { fetchApi } from '@/globals/utils/api';
import { createAttendanceCoordinator,attendanceCommandRequest,type AttendanceScope,type AttendanceCoordinator,type CommandDescriptor,type CommandKind } from '../utils/scanCoordinator';
export function useClassroomAttendance(kind:AttendanceScope['kind'],id:string,callbacks:{onConfirmed:(entry:CommandDescriptor,value:unknown)=>void;onProblem?:(entry:CommandDescriptor,error:unknown)=>void}){
 const {user}=useAuth();const userId=user?.id;const identity=user?[user.id,user.credentialVersion,user.role,user.status,user.classroomStatus,user.accountState,user.mustChangePassword].join(':'):'';const latest=useRef(callbacks);latest.current=callbacks;
 const coordinator=useRef<AttendanceCoordinator|null>(null);const [pending,setPending]=useState<CommandDescriptor[]>([]);const [error,setError]=useState('');const [readyIdentity,setReadyIdentity]=useState('');const recoveryIdentity=[identity,kind,id].join(':');
 useEffect(()=>{
  setPending([]);setError('');setReadyIdentity('');if(!userId)return;const scope={userId,kind,id};let stopped=false;
  try{const current=createAttendanceCoordinator({scope,storage:sessionStorage,send:async(entry,signal)=>{const request=attendanceCommandRequest(scope,entry);const response=await fetchApi<{data:unknown;replayed:boolean}>(request.path,{method:request.method,body:request.body,headers:{'Content-Type':'application/json'},signal});return response.data;},lookup:(commandId,signal)=>fetchApi('/api/classroom/commands/'+encodeURIComponent(commandId),{signal}),onChange:()=>{if(!stopped)setPending(current.snapshot());},onConfirmed:(entry,value)=>{if(!stopped){setError('');latest.current.onConfirmed(entry,value);}},onProblem:(entry,cause)=>{if(!stopped){setError(cause instanceof Error?cause.message:'Attendance save failed.');latest.current.onProblem?.(entry,cause);}}});coordinator.current=current;setPending(current.snapshot());void current.recover().finally(()=>{if(!stopped)setReadyIdentity(recoveryIdentity);});}catch(cause){setError(cause instanceof Error?cause.message:'Unable to prepare attendance recovery.');}
  const stop=()=>{stopped=true;coordinator.current?.dispose();coordinator.current=null;setPending([]);setReadyIdentity('');};
  // Hide private commands on authority changes; mere network loss emits neither event.
  const clear=()=>{stop();for(let index=sessionStorage.length-1;index>=0;index--){const key=sessionStorage.key(index);if(key?.startsWith('classroom:commands:v1:'+encodeURIComponent(userId)+':'))sessionStorage.removeItem(key);}};
  window.addEventListener('auth:identity-change',clear);window.addEventListener('auth:signed-out',clear);
  return()=>{stop();window.removeEventListener('auth:identity-change',clear);window.removeEventListener('auth:signed-out',clear);};
 },[userId,identity,kind,id,recoveryIdentity]);
 const act=useCallback(async(action:(current:AttendanceCoordinator)=>Promise<void>)=>{setError('');const current=coordinator.current;if(!current){setError('Attendance is not ready. Reload and check your connection.');return;}try{await action(current);}catch(cause){setError(cause instanceof Error?cause.message:'Unable to save attendance.');}},[]);
 return {pending,error,ready:readyIdentity===recoveryIdentity,clearError:()=>setError(''),submit:(operation:CommandKind,payload:Record<string,unknown>)=>act(current=>current.submit(operation,payload)),scan:(code:string,reason?:string)=>act(current=>current.scan(code,reason)),retry:(commandId:string)=>act(current=>current.retry(commandId))};
}
