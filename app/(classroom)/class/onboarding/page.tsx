import { redirect } from 'next/navigation';
import TeacherOnboarding from '@/features/classroom/components/onboarding/TeacherOnboarding';
export default async function Page({searchParams}:{searchParams:Promise<{help?:string}>}){
 if((await searchParams).help==='1')redirect('/class/help');
 return <TeacherOnboarding/>;
}
