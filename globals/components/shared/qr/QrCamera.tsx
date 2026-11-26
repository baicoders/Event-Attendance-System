'use client';
import { useEffect,useRef,useState } from 'react';
import { BarcodeDetector,setZXingModuleOverrides } from 'barcode-detector/ponyfill';
import { createCameraCapture } from './cameraCapture';
import { QrCameraError,asCameraError } from './cameraError';
setZXingModuleOverrides({locateFile:(path:string)=>'/qr-decoder/'+path});
/** Capture and decode only. Callers own authorization, scan gating and saves. */
export default function QrCamera({onRead,paused=false,onClose,onError}:{onRead:(value:string)=>void;paused?:boolean;onClose:()=>void;onError?:(error:unknown)=>void}){
 const video=useRef<HTMLVideoElement>(null);const latest=useRef({onRead,paused,onClose,onError});latest.current={onRead,paused,onClose,onError};const [ready,setReady]=useState(false);
 useEffect(()=>{
  let active=true;let timer:ReturnType<typeof setTimeout>|undefined;let detector:BarcodeDetector;try{detector=new BarcodeDetector({formats:['qr_code']});}catch{latest.current.onError?.(new QrCameraError('READER'));return;}
  const capture=createCameraCapture({request:async()=>{if(!window.isSecureContext)throw new QrCameraError('INSECURE');if(!navigator.mediaDevices?.getUserMedia)throw new QrCameraError('API_UNAVAILABLE');return navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});},attach:async stream=>{const element=video.current;if(!active||!element){stream.getTracks().forEach(track=>track.stop());return;}element.srcObject=stream;await element.play();if(active)setReady(true);}});
  const fail=(cause:unknown)=>{capture.stop();if(active)latest.current.onError?.(asCameraError(cause));};
  const detect=async()=>{if(!active)return;try{const element=video.current;if(!latest.current.paused&&element&&element.readyState>=2){const values=await detector.detect(element);if(active&&!latest.current.paused){const code=values[0]?.rawValue?.trim();if(code)latest.current.onRead(code);}}}catch{fail(new QrCameraError('READER'));return;}if(active)timer=setTimeout(()=>void detect(),180);};
  void capture.start().then(()=>{if(active)void detect();}).catch(fail);
  const close=()=>latest.current.onClose();window.addEventListener('workspace:changed',close);window.addEventListener('auth:identity-change',close);window.addEventListener('auth:signed-out',close);
  return()=>{active=false;if(timer)clearTimeout(timer);capture.stop();window.removeEventListener('workspace:changed',close);window.removeEventListener('auth:identity-change',close);window.removeEventListener('auth:signed-out',close);};
 },[]);
 return <div className="relative mx-auto aspect-square w-full max-w-[500px] overflow-hidden rounded-2xl bg-slate-900"><video ref={video} playsInline muted aria-label="Student QR camera" className="h-full w-full object-cover"/><button type="button" aria-label="Close camera" className="absolute right-3 top-3 min-h-12 rounded-xl bg-white px-4 text-sm font-semibold text-slate-900" onClick={onClose}>Close</button>{!ready?<p role="status" className="absolute bottom-4 inset-x-3 rounded-xl bg-white p-3 text-center text-sm text-slate-900">Requesting camera permission…</p>:paused?<p role="status" className="absolute bottom-4 inset-x-3 rounded-xl bg-white p-3 text-center text-sm text-slate-900">Waiting for the pending save…</p>:null}</div>;
}
