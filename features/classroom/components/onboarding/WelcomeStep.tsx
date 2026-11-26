import { ArrowRight } from 'lucide-react';
import { Button } from '@/globals/components/shad-cn/button';
import { ActionFooter } from '../ui';
export default function WelcomeStep({busy,retry,onContinue}:{busy:boolean;retry:boolean;onContinue:()=>void}){
  return <section className="space-y-5"><h2 className="text-xl font-semibold">Welcome to Classroom Attendance</h2><p>Choose your class, start a meeting, then scan each student’s existing QR code. You can always take attendance manually.</p><ol className="space-y-3 rounded-2xl border bg-white p-5"><li>1. Save your subject, term and sections.</li><li>2. Review irregular students once. Your choices are reused.</li><li>3. Start attendance, scan or mark manually, then finalize.</li></ol><p className="text-sm text-slate-600">Your teacher access is approved. You manage your own classes and permitted student corrections independently.</p><ActionFooter><Button className="min-h-12 w-full" disabled={busy} onClick={onContinue}><ArrowRight aria-hidden className="size-4 shrink-0"/>{busy?'Saving…':retry?'Retry same save':'Continue to class setup'}</Button></ActionFooter></section>;
}
