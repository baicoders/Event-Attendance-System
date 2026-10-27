import { Prisma } from '@prisma/client';
import auditUtils from '../../../features/attendance/server/attendanceChange.ts';

/** Seed only synthetic near-full phone events, reserving the printed cards for actual scans. */
export async function seedPhoneAttendance(db,event,actor,students,reserveCount=100) {
  if(!Number.isSafeInteger(reserveCount) || reserveCount<0)throw new Error('Invalid reserved-card count');
  const candidates=students.slice(reserveCount);
  const byId=new Map(candidates.map(student=>[student.id,student]));
  for(let offset=0;offset<candidates.length;offset+=500) {
    const chunk=candidates.slice(offset,offset+500);
    await db.$transaction(async tx=>{
      const records=await tx.record.createManyAndReturn({data:chunk.map(student=>({
        eventId:event.id,studentId:student.id,method:'SCANNED',timein:new Date(),recordedById:actor.id,revision:1,
      }))});
      await tx.attendanceChange.createMany({data:records.map(record=>{
        const student=byId.get(record.studentId);
        return {eventId:event.id,studentId:record.studentId,recordId:record.id,action:'CREATE',actorId:actor.id,
          actorName:actor.name,eventTitle:event.title,studentLabel:[student.firstName,student.middleName,student.lastName].filter(Boolean).join(' '),
          before:Prisma.DbNull,after:auditUtils.snapshot(record)};
      })});
    },{maxWait:5000,timeout:15000});
  }
  return candidates.length;
}
