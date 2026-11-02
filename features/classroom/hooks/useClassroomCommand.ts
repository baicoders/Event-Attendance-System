'use client';
import { useEffect,useRef,useState } from 'react';
import { ApiError,fetchApi } from '@/globals/utils/api';
import { definitiveCommandFailure } from '../utils/commandFailure';
/** Honest confirmation/retry behavior, with no offline queue or background writes. */
export function useClassroomCommand(){
 const [busy,setBusy]=useState(false);const [unconfirmed,setUnconfirmed]=useState(false);const [error,setError]=useState('');const [problem,setProblem]=useState<ApiError|null>(null);
 const mounted=useRef(true);const inFlight=useRef(false);const controller=useRef<AbortController|null>(null);const pending=useRef<{fingerprint:string;body:string}|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 const run=async<T,>(path:string,method:'POST'|'PUT'|'PATCH',payload:Record<string,unknown>):Promise<T|undefined>=>{
  if(inFlight.current)return;
  const fields={...payload};delete fields.commandId;const fingerprint=JSON.stringify({path,method,payload:fields});
  if(pending.current&&pending.current.fingerprint!==fingerprint){setError('Resolve the unconfirmed save before changing these entries. Retry it or check your classes.');return;}
  if(!pending.current)pending.current={fingerprint,body:JSON.stringify({...fields,commandId:crypto.randomUUID()})};
  inFlight.current=true;setBusy(true);setError('');setProblem(null);controller.current=new AbortController();
  try{
   const result=await fetchApi<{data:T;replayed:boolean}>(path,{method,headers:{'Content-Type':'application/json'},body:pending.current.body,signal:controller.current.signal});
   if(!mounted.current)return;pending.current=null;setUnconfirmed(false);return result.data;
  }catch(cause){
   if(!mounted.current)return;
   const known=definitiveCommandFailure(cause);
   setProblem(cause instanceof ApiError?cause:null);setError(known&&cause instanceof ApiError?cause.message:'Save not confirmed. Retry to check the same save.');
   if(known){pending.current=null;setUnconfirmed(false);}else setUnconfirmed(true);
  }finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 };
 return {run,busy,unconfirmed,error,problem,clearError:()=>{setError('');setProblem(null);}};
}
