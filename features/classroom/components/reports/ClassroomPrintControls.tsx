'use client';
import { Button } from '@/globals/components/shad-cn/button';
export default function ClassroomPrintControls(){return <div className="print:hidden mx-auto max-w-6xl p-4"><Button className="min-h-12" onClick={()=>window.print()}>Print report</Button></div>;}
