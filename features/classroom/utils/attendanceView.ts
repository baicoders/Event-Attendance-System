import type { AttendanceStatus } from '../types/attendance';
export type AttendanceView={q:string;status:AttendanceStatus|'';page:number;includeExcluded:boolean;mode:'MANUAL'|'SCAN';manualView:'FOCUS'|'ROSTER'};
const statuses=new Set(['UNMARKED','PRESENT','LATE','ABSENT','EXCUSED']);
/** Browser preferences only. Server ownership and membership remain authoritative. */
export function parseAttendanceView(params:URLSearchParams):AttendanceView{
 const rawPage=Number(params.get('page')??1);const rawStatus=params.get('status')??'';
 const legacyRoster=['status','page','includeExcluded'].some(key=>params.has(key));
 const manualView=params.get('manualView');
 return {q:(params.get('q')??'').replaceAll('\0','').trim().slice(0,100),status:statuses.has(rawStatus)?rawStatus as AttendanceStatus:'',page:Number.isInteger(rawPage)&&rawPage>=1&&rawPage<=100000?rawPage:1,includeExcluded:params.get('includeExcluded')==='true',mode:params.get('mode')==='SCAN'?'SCAN':'MANUAL',manualView:manualView==='FOCUS'?'FOCUS':manualView==='ROSTER'||legacyRoster?'ROSTER':'FOCUS'};
}
export function attendanceViewParams(view:AttendanceView){
 // Explicit FOCUS overrides preserved roster filters; ROSTER keeps an otherwise
 // plain review URL from silently becoming focused after a reload.
 const preferences={...(view.q.trim()?{q:view.q.trim()}:{}),...(view.status?{status:view.status}:{}),...(view.page>1?{page:String(view.page)}:{}),...(view.includeExcluded?{includeExcluded:'true'}:{}),...(view.mode==='SCAN'?{mode:'SCAN'}:{})};
 return new URLSearchParams({...preferences,...(view.manualView==='ROSTER'||view.status||view.page>1||view.includeExcluded?{manualView:view.manualView}:{})});
}
