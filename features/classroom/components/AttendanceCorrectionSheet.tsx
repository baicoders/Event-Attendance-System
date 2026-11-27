'use client';
import { useState } from 'react';
import { Save } from 'lucide-react';
import { Textarea } from '@/globals/components/shad-cn/textarea';
import { Button } from '@/globals/components/shad-cn/button';
import { attendanceLabels, type SessionMember, type FinalAttendanceStatus } from '../types/attendance';
import AttendanceActionSheet from './AttendanceActionSheet';
import { ClassroomSelect } from './ui';

const correctionStatuses = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as const;

export default function AttendanceCorrectionSheet({
 member, status, requiresReason, busy, error, onClose, onSave,
}: {
 member: SessionMember;
 status?: FinalAttendanceStatus;
 requiresReason: boolean;
 busy: boolean;
 error: string;
 onClose: () => void;
 onSave: (reason: string, note: string, status: FinalAttendanceStatus) => void;
}) {
 const [choice, setChoice] = useState<FinalAttendanceStatus | ''>(status ?? '');
 const [reason, setReason] = useState('');
 const [note, setNote] = useState(member.attendance.excuseNote ?? '');
 const name = member.studentSnapshot.firstName + ' ' + member.studentSnapshot.lastName;

 return <AttendanceActionSheet open title={requiresReason ? 'Correct attendance' : 'Excuse student'} description={name} onClose={onClose}>
  <p>Current result: {attendanceLabels[member.attendance.status]}.</p>
  {!status && <ClassroomSelect label="Corrected result" value={choice}
   options={[{ value: '', label: 'Choose a result' }, ...correctionStatuses.map(value => ({ value, label: attendanceLabels[value] }))]}
   onValueChange={value => setChoice(value as FinalAttendanceStatus | '')} disabled={busy}/>}
  {choice === 'EXCUSED' && <label className="block text-sm font-medium">Excuse note (optional)
   <Textarea className="mt-2 min-h-24 w-full rounded-xl border p-3" maxLength={1000} value={note} onChange={event => setNote(event.target.value)} disabled={busy}/>
  </label>}
  {requiresReason && <label className="block text-sm font-medium">Reason for correction
   <Textarea className="mt-2 min-h-24 w-full rounded-xl border p-3" minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} required disabled={busy}/>
  </label>}
  {error && <p role="alert" className="break-words text-sm text-rose-800">{error}</p>}
  <Button className="min-h-12 w-full" disabled={busy || !choice || (requiresReason && reason.trim().length < 3)}
   onClick={() => { if (choice) onSave(reason.trim(), choice === 'EXCUSED' ? note.trim() : '', choice); }}>
   <Save aria-hidden className="size-4 shrink-0"/>
   {busy ? 'Waiting for confirmation…' : choice ? 'Save ' + attendanceLabels[choice] : 'Save correction'}
  </Button>
  <Button className="min-h-12 w-full" variant="outline" onClick={onClose}>Close</Button>
 </AttendanceActionSheet>;
}
