'use client';
import { BarChart3 } from 'lucide-react';
import { Button } from '@/globals/components/shad-cn/button';
export default function ClassroomPrintControls(){return <div className="print:hidden mx-auto max-w-6xl p-4"><Button className="min-h-12" onClick={()=>window.print()}><BarChart3 aria-hidden className="size-4 shrink-0"/>Print report</Button></div>;}
