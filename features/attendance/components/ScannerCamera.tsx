'use client';
import { useCallback,useRef } from 'react';
import QrCamera from '@/globals/components/shared/qr/QrCamera';
import { createScanGate } from '@/features/attendance/utils/scanGate';
type ScannerCameraProps={onRead:(id:string)=>void;isPending:boolean;onClose:()=>void;eventId?:string;mode?:'TIME_IN'|'TIME_OUT';onError?:(error:unknown)=>void};
/** Events retains its event/mode-aware debounce and existing attendance behavior. */
export default function ScannerCamera({onRead,isPending,onClose,eventId,mode,onError}:ScannerCameraProps){const gate=useRef(createScanGate());const read=useCallback((value:string)=>{if(!isPending&&gate.current.accept({value,eventId,mode}))onRead(value);},[isPending,eventId,mode,onRead]);return <QrCamera onRead={read} paused={isPending} onClose={onClose} onError={onError}/>;}
