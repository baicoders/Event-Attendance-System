import Link from 'next/link';
import { Button } from '@/globals/components/shad-cn/button';
import type { TeacherOnboardingState } from '../../types/onboarding';
export default function ReadyStep({state,busy,onFinish}:{state:TeacherOnboardingState;busy:boolean;onFinish:()=>void}){
  return <section className="space-y-5"><h2 className="text-xl font-semibold">Your class is ready</h2><div className="space-y-3 rounded-2xl border bg-white p-5"><h3 className="break-words font-semibold">{state.class?.displayName}</h3><p>{state.class?.sections.map(row=>row.name).join(' + ')||'Individual student roster'}</p><p>{state.readiness?.rosterCount} eligible students · {state.class?.graceMinutes} minute grace · Asia/Manila</p></div><p>Start attendance when the meeting begins. Use students’ existing QR codes, or mark the roster manually. Finish setup does not start attendance or create absences.</p><Button className="min-h-12 w-full" disabled={busy} onClick={onFinish}>{busy?'Saving…':'Finish setup and open My Classes'}</Button><Link className="flex min-h-12 items-center justify-center text-indigo-700 underline" href="/class/onboarding?help=1">Review the workflow</Link></section>;
}
