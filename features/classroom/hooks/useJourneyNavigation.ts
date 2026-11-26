'use client';
import { useCallback,useLayoutEffect,useRef } from 'react';
/** Prevent leaving unresolved writes; query-only substeps retain the same draft owner. */
export function useJourneyNavigation(blocked:boolean,dirty:boolean){
 const permit=useRef(false);const internal=useRef(false);
 useLayoutEffect(()=>{
  const origin=window.location.href;
  const nav=(window as Window & {navigation?:EventTarget & {currentEntry?:{index:number}}}).navigation;
  const originalIndex=nav?.currentEntry?.index;
  const shouldBlock=(destination:string)=>{
   if(permit.current||internal.current)return false;
   if(blocked)return true;
   if(!dirty||new URL(destination,origin).pathname===new URL(origin).pathname)return false;
   if(!window.confirm('Discard unsaved setup changes and leave? Choose Cancel to keep editing, or use Save and exit.'))return true;
   permit.current=true;return false;
  };
  const navigate=(event:Event)=>{
   const next=event as Event & {destination?:{url:string}};
   if(next.destination&&shouldBlock(next.destination.url)&&event.cancelable)event.preventDefault();
  };
  const click=(event:MouseEvent)=>{
   const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;
   if(!link||link.target==='_blank')return;
   if(shouldBlock(link.href)){event.preventDefault();event.stopImmediatePropagation();}
  };
  const unload=(event:BeforeUnloadEvent)=>{if(!permit.current&&(blocked||dirty))event.preventDefault();};
  const pop=(event:PopStateEvent)=>{
   if(!shouldBlock(window.location.href))return;
   event.stopImmediatePropagation();
   const nextIndex=nav?.currentEntry?.index;
   if(originalIndex!==undefined&&nextIndex!==undefined&&originalIndex!==nextIndex)window.history.go(originalIndex-nextIndex);
   else {window.history.pushState(null,'',origin);}
  };
  nav?.addEventListener('navigate',navigate);document.addEventListener('click',click,true);window.addEventListener('beforeunload',unload);window.addEventListener('popstate',pop,true);
  return()=>{nav?.removeEventListener('navigate',navigate);document.removeEventListener('click',click,true);window.removeEventListener('beforeunload',unload);window.removeEventListener('popstate',pop,true);};
 },[blocked,dirty]);
 const permitExit=useCallback(()=>{permit.current=true;},[]);
 const withInternalNavigation=useCallback((action:()=>void)=>{internal.current=true;try{action();}finally{internal.current=false;}},[]);
 return {permitExit,withInternalNavigation};
}
