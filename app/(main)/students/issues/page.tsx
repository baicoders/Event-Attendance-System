import {Suspense} from 'react';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {AuthError,requireAuth,requireRole} from '@/globals/utils/auth';
import {page} from '@/globals/constants/designTokens';
import StudentRecordIssuesClient from '@/features/students/components/StudentRecordIssuesClient';
export default async function StudentRecordIssuesPage() {
 try {const user=await requireAuth();requireRole(user,'ADMIN');}
 catch(error) {if(!(error instanceof AuthError))throw error;if(error.status===401)redirect('/login');return <p role="alert" className="p-6">An active administrator account is required to address student record issues.</p>;}
 return <section className={`${page.surface} min-h-svh`}><div className={`${page.containerWide} space-y-6`}><Link href="/students" className="text-sm underline">← Student management</Link><h1 className="text-3xl font-semibold">Address Student Record Issues</h1><p className="text-sm text-slate-600">Find missing information and open a student profile to complete it. These issues do not prevent attendance at school-wide events.</p><Suspense fallback={<p>Loading record issues…</p>}><StudentRecordIssuesClient/></Suspense></div></section>;
}
