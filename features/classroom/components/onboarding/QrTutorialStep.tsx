'use client';
import { AttendanceStatusIcon } from '../ui';
import { ScanLine, Save, CircleHelp } from 'lucide-react';
import { useEffect,useRef,useState } from 'react';
import { Button } from '@/globals/components/shad-cn/button';
import { Textarea } from '@/globals/components/shad-cn/textarea';
import { ActionFooter } from '../ui';
export default function QrTutorialStep({busy=false,retry=false,onFinish,help=false}:{busy?:boolean;retry?:boolean;onFinish?:(choice:'SEEN'|'SKIPPED')=>void;help?:boolean}){
  const [camera,setCamera]=useState(false);const [cameraMessage,setCameraMessage]=useState('');
  const [practice,setPractice]=useState('Unmarked');const [note,setNote]=useState('');
  const video=useRef<HTMLVideoElement|null>(null);
  useEffect(()=>{
    if(!camera)return;
    let active=true;let stream:MediaStream|undefined;
    void (async()=>{
      try{
        if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('CAMERA_UNAVAILABLE');
        stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
        if(!active){stream.getTracks().forEach(track=>track.stop());return;}
        if(video.current){video.current.srcObject=stream;await video.current.play();}
        setCameraMessage('Camera preview only. This tutorial does not scan or save attendance.');
      }catch{
        stream?.getTracks().forEach(track=>track.stop());
        if(active)setCameraMessage('Camera unavailable. On the deployed HTTPS site, allow camera access in browser settings and try again. You can always use manual attendance below.');
      }
    })();
    return()=>{active=false;stream?.getTracks().forEach(track=>track.stop());};
  },[camera]);
  return <section className="space-y-5"><h2 className="text-xl font-semibold">Learn the QR and manual workflow</h2><p>Teachers scan each student’s existing QR code with their phone. Students do not scan a class code.</p><p className="rounded-xl bg-indigo-50 p-4 text-sm font-semibold">Practice only — nothing is recorded.</p><ol className="list-inside list-decimal space-y-2 text-sm"><li>Open your class and choose Start Attendance.</li><li>Allow the camera and hold the student’s printed QR in view.</li><li>Wait for the server to confirm the saved result.</li><li>Use Manual if the camera fails, then finalize when finished.</li></ol>
  <Button className="min-h-12 w-full" variant="outline" disabled={busy||retry} onClick={()=>{setCameraMessage('');setCamera(value=>!value);}}><ScanLine aria-hidden className="size-4 shrink-0"/>{camera?'Close practice camera':'Try practice camera'}</Button>{camera?<div className="space-y-3"><video ref={video} playsInline muted className="aspect-square w-full rounded-2xl bg-slate-900" aria-label="Practice camera preview"/><p role="status" className="text-sm">{cameraMessage||'Requesting camera permission…'}</p></div>:null}
  <div className="space-y-4 rounded-2xl border bg-white p-5"><h3 className="font-semibold">Manual practice: Sample student</h3><p role="status">Practice result: {practice}</p><div className="grid grid-cols-2 gap-2">{['Present','Absent','Late','Excused'].map(status=><Button key={status} className="min-h-12" variant="outline" onClick={()=>setPractice(status)}><AttendanceStatusIcon status={status}/>{status}</Button>)}</div>{practice==='Excused'?<label className="block text-sm font-medium">Practice excuse note (optional)<Textarea className="mt-2 min-h-24 w-full rounded-xl border p-3" maxLength={1000} value={note} onChange={event=>setNote(event.target.value)}/></label>:null}<p className="text-sm text-slate-600">This is a simulation. Real attendance shows success only after a server confirmation. Repeated scans never toggle attendance. A lost connection needs an explicit retry.</p></div>
  {!help&&onFinish?<div className="space-y-3"><ActionFooter><Button className="min-h-12 w-full" disabled={busy} onClick={()=>onFinish('SEEN')}><Save aria-hidden className="size-4 shrink-0"/>{busy?'Saving…':'I understand — continue'}</Button></ActionFooter><Button className="min-h-12 w-full" variant="outline" disabled={busy} onClick={()=>onFinish('SKIPPED')}><CircleHelp aria-hidden className="size-4 shrink-0"/>Skip tutorial for now</Button></div>:null}</section>;
}
