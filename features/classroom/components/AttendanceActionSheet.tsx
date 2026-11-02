'use client';
import type { ReactNode } from 'react';
import { Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription } from '@/globals/components/shad-cn/sheet';
export default function AttendanceActionSheet({title,description,open,onClose,children}:{title:string;description:string;open:boolean;onClose:()=>void;children:ReactNode}){return <Sheet open={open} onOpenChange={value=>{if(!value)onClose();}}><SheetContent side="bottom" className="mx-auto max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl p-0 [&_[data-slot=sheet-close]]:min-h-12"><SheetHeader className="pr-14"><SheetTitle>{title}</SheetTitle><SheetDescription>{description}</SheetDescription></SheetHeader><div className="min-w-0 space-y-4 px-4 pb-6">{children}</div></SheetContent></Sheet>;}
