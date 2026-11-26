'use client';
import { ScanLine } from 'lucide-react';
import dynamic from 'next/dynamic';
import HelpButton from './help/HelpButton';
import { useRef, useState } from 'react';
import { cameraFailureMessage } from '@/globals/components/shared/qr/cameraError';
import { Button } from '@/globals/components/shad-cn/button';
const QrCamera=dynamic(()=>import('@/globals/components/shared/qr/QrCamera'),{ssr:false,loading:()=><p role="status">Loading camera…</p>});
export default function ClassroomScanner({paused,onRead,onManual}:{paused:boolean;onRead:(code:string)=>void;onManual:()=>void}){const [helpOpen,setHelpOpen]=useState(false);const helpPaused=useRef(false);const [camera,setCamera]=useState(false);const [error,setError]=useState('');return <section className="space-y-4" aria-label="QR attendance"><HelpButton topic="scanning" onOpenChange={open=>{helpPaused.current=open;setHelpOpen(open);}}/><p>Scan students’ existing QR codes. Wait for a confirmed result before moving to the next student. Repeated scans never toggle attendance.</p>{camera?<QrCamera paused={paused||helpOpen} onRead={code=>{if(!paused&&!helpPaused.current)onRead(code);}} onClose={()=>setCamera(false)} onError={cause=>{setCamera(false);setError(cameraFailureMessage(cause));}}/>:<Button className="min-h-12 w-full" disabled={paused||helpOpen} onClick={()=>{setError('');setCamera(true);}}><ScanLine aria-hidden className="size-4 shrink-0"/>Open student QR camera</Button>}{error?<p role="alert" className="text-sm text-rose-800">{error}</p>:null}<Button className="min-h-12 w-full" variant="outline" onClick={onManual}>Use manual attendance</Button><p className="text-sm text-slate-600">Internet is required to save. If a save is unconfirmed, check or retry the same save below.</p></section>;}
