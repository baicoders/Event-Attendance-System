'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
/** Shareable server-query state, retaining unrelated parameters and browser history. */
export function useClassroomListState<T extends Record<string,string>>(defaults:T) {
 const searchParams=useSearchParams();const query=searchParams.toString();
 const initial=useRef(defaults); const [values,setState]=useState<T>(defaults); const [ready,setReady]=useState(false);
 useEffect(()=>{const read=()=>{if(window.location.pathname.startsWith('/account/'))return;const params=new URLSearchParams(window.location.search); const next={...initial.current}; for(const key of Object.keys(next))if(params.has(key))next[key as keyof T]=params.get(key) as T[keyof T];setState(next);setReady(true);};read();window.addEventListener('popstate',read);return()=>window.removeEventListener('popstate',read);},[query]);
 const setValues=useCallback((patch:Partial<T>)=>{if(window.location.pathname.startsWith('/account/'))return;const url=new URL(window.location.href);for(const [key,value] of Object.entries(patch)){if(value===undefined)continue;if(value===initial.current[key]&&key!=='termId')url.searchParams.delete(key);else url.searchParams.set(key,value);}window.history.replaceState(null,'',url.pathname+url.search+url.hash);setState(current=>({...current,...patch}));},[]);
 return {values,setValues,ready};
}
