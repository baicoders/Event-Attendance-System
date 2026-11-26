'use client';
import { Save } from 'lucide-react';
import Link from 'next/link';
import { SectionPanel, Feedback, LoadingState } from '../ui';
import { useTeacherOnboarding } from '../../hooks/useTeacherOnboarding';
export default function OnboardingChecklist(){
  const {query}=useTeacherOnboarding();
  if(query.isLoading)return <LoadingState label="Loading saved setup…"/>;
  if(query.isError)return <Feedback title="Setup progress is unavailable" onRetry={()=>void query.refetch()}/>;
  if(!query.data||query.data.completedAt)return null;
  return <SectionPanel title="Welcome to classroom attendance" className="border-indigo-200 bg-indigo-50"><p className="text-sm">Set up your first class once, then open your class for each meeting. Students use their existing QR codes. Your progress is saved as you go.</p><Link prefetch={false} href="/class/onboarding" className="gap-2 inline-flex min-h-12 items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white"><Save aria-hidden className="size-4 shrink-0"/>{query.data.revision?'Continue saved setup':'Set up my first class'}</Link></SectionPanel>;
}
