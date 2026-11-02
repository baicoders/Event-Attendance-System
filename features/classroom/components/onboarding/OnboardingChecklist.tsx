'use client';
import Link from 'next/link';
import { useTeacherOnboarding } from '../../hooks/useTeacherOnboarding';
export default function OnboardingChecklist(){
  const {query}=useTeacherOnboarding();
  if(query.isLoading)return <p role="status" className="text-sm text-slate-600">Loading saved setup…</p>;
  if(query.isError)return <p role="alert" className="text-sm">Setup progress is unavailable. <button className="min-h-12 underline" onClick={()=>void query.refetch()}>Retry setup</button></p>;
  if(!query.data||query.data.completedAt)return <Link href="/class/onboarding?help=1" className="inline-flex min-h-12 items-center text-sm text-indigo-700 underline">Classroom help and QR tutorial</Link>;
  return <section className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><h2 className="text-lg font-semibold">Welcome to classroom attendance</h2><p className="text-sm">Set up your first class once, then return here to start attendance. Students use their existing QR codes. Your progress is saved as you go.</p><Link href="/class/onboarding" className="inline-flex min-h-12 items-center rounded-xl bg-indigo-600 px-4 font-semibold text-white">{query.data.revision?'Continue saved setup':'Set up my first class'}</Link></section>;
}
