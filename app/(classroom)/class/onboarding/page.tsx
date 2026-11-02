import TeacherOnboarding from '@/features/classroom/components/onboarding/TeacherOnboarding';
export default async function Page({searchParams}:{searchParams:Promise<{help?:string}>}){
  return <TeacherOnboarding help={(await searchParams).help==='1'}/>;
}
