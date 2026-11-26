import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import type { ClassroomReportSnapshot } from '../types/report';
import { buildClassroomReport } from '../utils/reportProjection';
import { buildRegisterXlsx } from './registerXlsx';

test('one portrait worksheet preserves stacked Manila dates, same-date columns and text identifiers', async () => {
 const student = {id:'a',firstName:'Ana',lastName:'Cruz',middleName:null,usn:'00123456789',lrn:null};
 const later = {...student,id:'b',firstName:'Bea',usn:null,lrn:'000011112222'};
 const member=(identity:typeof student|typeof later,status:'LATE'|'PRESENT'|'EXCUSED')=>({
  studentId:identity.id,included:true,membershipRevision:0,studentSnapshot:identity,attendance:{status,revision:1},
 });
 const snapshot:ClassroomReportSnapshot = {
  registerMetadata:{subject:'Subject',sections:['Section'],term:'Term',course:'Information Technology',instructor:'Instructor'},
  filters:{classId:'class',termId:'term'},evaluatedAt:'2026-11-26T00:00:00Z',reportVersion:'fixture',
  sessions:Array.from({length:14},(_,index)=>({
   id:String(index).padStart(2,'0'),classId:'class',state:'FINALIZED',
   scheduledStartAt:index===13?'2027-01-01T00:00:00Z':index<2?'2026-11-08T16:00:00Z':`2026-11-${String(index+8).padStart(2,'0')}T00:00:00Z`,
   lifecycleRevision:1,snapshotRevision:0,classSnapshot:{displayName:'Class',term:{id:'term',name:'Term'},subject:{title:'Subject'}},
   members:[member(student,'LATE'),...(index===0?[]:[member(later,index===1?'EXCUSED':'PRESENT')])],
  })),
 };
 const workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(await buildRegisterXlsx(buildClassroomReport(snapshot)));
 const sheet=workbook.getWorksheet('ATTENDANCES_REPORT')!;
 assert.equal(workbook.worksheets.length,1);
 assert.equal(sheet.pageSetup.orientation,'portrait');
 assert.equal(sheet.getCell('B8').value,'COURSE');
 assert.equal(sheet.getCell('C8').value,'Information Technology');
 assert.equal(sheet.getCell('B10').value,'TOTAL STUDENTS');
 assert.equal(sheet.getCell('C10').value,2);
 assert.equal(sheet.getCell('C10').alignment.horizontal,'left');
 assert.equal(sheet.getCell('D13').value,'2026');
 assert.equal(sheet.getCell('P13').master.address,'D13');
 assert.equal(sheet.getCell('Q13').value,'2027');
 assert.equal(sheet.getCell('Q13').isMerged,false);
 assert.equal((sheet.getCell('D14').value as Date).toISOString(),'2026-11-09T00:00:00.000Z');
 assert.equal(sheet.getCell('D14').numFmt,'mm-dd');
 assert.equal(sheet.getCell('D15').value,'00:00:00 #1');
 assert.equal(sheet.getCell('E15').value,'00:00:00 #2');
 assert.equal(sheet.getCell('B16').value,'00123456789');
 assert.equal(sheet.getCell('B17').value,'LRN 000011112222');
 assert.equal(sheet.getCell('D17').value,'—');
 assert.equal(sheet.getCell('E17').value,'E');
 assert.equal(sheet.getCell('R16').value,14);
 assert.equal(sheet.getCell('R17').value,12);
 assert.equal(sheet.getCell('S12').value,'REMARKS');

 const shortWorkbook=new ExcelJS.Workbook();
 await shortWorkbook.xlsx.load(await buildRegisterXlsx(buildClassroomReport({...snapshot,sessions:[snapshot.sessions[2]]})));
 const shortSheet=shortWorkbook.getWorksheet('ATTENDANCES_REPORT')!;
 assert.equal(shortSheet.getCell('A14').value,'NO.');
 assert.equal(shortSheet.getCell('D15').value,'2026');
 assert.equal(shortSheet.getCell('D16').numFmt,'mm-dd');
 assert.equal(shortSheet.getCell('D17').value,'L');
 assert.equal(shortSheet.getCell('D18').value,'P');
});
