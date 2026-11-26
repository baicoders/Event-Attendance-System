'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CircleHelp } from 'lucide-react';
import { Button } from '@/globals/components/shad-cn/button';
import AttendanceActionSheet from '../AttendanceActionSheet';
import TeacherLesson from './TeacherLesson';
import { lessons,type HelpTopic } from './lessons';
export default function HelpButton({topic,label,onOpenChange}:{topic:HelpTopic;label?:string;onOpenChange?:(open:boolean)=>void}){
 const [open,setOpen]=useState(false);const change=(value:boolean)=>{onOpenChange?.(value);setOpen(value);};
 return <><Button type="button" variant="ghost" className="min-h-12 max-w-full whitespace-normal text-indigo-700" onClick={()=>change(true)}><CircleHelp aria-hidden className="size-4 shrink-0"/>{label??'Help: '+lessons[topic].title}</Button>{open?<AttendanceActionSheet open title={lessons[topic].title} description="Teacher guide · your current task stays open" onClose={()=>change(false)}><TeacherLesson topic={topic}/><Button type="button" variant="outline" className="min-h-12 w-full" onClick={()=>change(false)}>Back to my task</Button><Link className="flex min-h-12 items-center justify-center text-sm font-semibold text-indigo-700 underline" href={'/class/help#'+topic}>Open this guide topic</Link></AttendanceActionSheet>:null}</>;
}
