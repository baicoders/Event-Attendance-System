/** Fixed, operator-approved local USWAG test baseline. No student PII here. */
export const USWAG_TEST_PASSWORD='Uswag2026!';
export const USWAG_BASELINE_ACCOUNTS=[
 {name:'USWAG Admin',email:'admin@uswag.test',role:'ADMIN'},
 ...[1,2,3].map(number=>({name:`USWAG Organizer ${number}`,email:`organizer${number}@uswag.test`,role:'ORGANIZER'})),
];
export const USWAG_BASELINE_EVENT={title:'USWAG 2026',start:'2026-10-26T00:00:00+08:00',end:'2026-10-27T00:00:00+08:00',allDay:true,location:null,status:'APPROVED',category:'CUSTOM'};
export type BaselineUser={id:string;email:string;name:string;role:string;status:string;mustChangePassword:boolean;credentialVersion:number};
type BaselineEvent={id:string;title:string;category:string;status:string;groupIds:string[];start:string|Date;end:string|Date;location:string|null;createdById:string|null;allDay?:boolean;reviewedById?:string|null;reviewedAt?:string|Date|null;recordCount?:number;isTimeout?:boolean};
type BaselineGroup={id:string;category:string};
const sameInstant=(a:string|Date,b:string)=>new Date(a).getTime()===new Date(b).getTime();

export function planUswagBaseline(existingUsers:BaselineUser[],events:BaselineEvent[],groups:BaselineGroup[]){
 const blockers:string[]=[];
 const users=USWAG_BASELINE_ACCOUNTS.map(account=>{
  const matches=existingUsers.filter(user=>user.email.toLowerCase()===account.email);
  const existing=matches[0];
  const conflict=matches.length>1||existing&&(existing.email!==account.email||existing.role!==account.role||existing.status!=='ACTIVE'||existing.mustChangePassword);
  if(conflict)blockers.push(`BASELINE_ACCOUNT_CONFLICT:${account.email}`);
  return {...account,name:existing?.name??account.name,id:existing?.id??`planned:user:${account.email}`,action:conflict?'blocked' as const:existing?'reuse' as const:'create' as const};
 });
 const custom=groups.filter(group=>group.category==='CUSTOM').map(group=>group.id).sort();
 const candidates=events.filter(event=>/\buswag\b/i.test(event.title));
 const existing=candidates.length===1?candidates[0]:undefined;
 if(candidates.length>1)blockers.push('BASELINE_EVENT_AMBIGUOUS');
 const ownerId=users[1].id,reviewerId=users[0].id;
 const matches=existing&&existing.title===USWAG_BASELINE_EVENT.title&&existing.category==='CUSTOM'&&existing.status==='APPROVED'&&existing.allDay===true&&
  sameInstant(existing.start,USWAG_BASELINE_EVENT.start)&&sameInstant(existing.end,USWAG_BASELINE_EVENT.end)&&existing.location===null&&existing.createdById===ownerId&&
  existing.reviewedById===reviewerId&&!!existing.reviewedAt&&existing.groupIds.length===custom.length&&custom.every(id=>existing.groupIds.includes(id));
 if(existing&&!matches&&(existing.recordCount??0)>0)blockers.push('BASELINE_EVENT_HAS_ATTENDANCE');
 const action=blockers.length?'blocked' as const:!existing?'create' as const:matches?'reuse' as const:'approve' as const;
 return {users,blockers,event:{...USWAG_BASELINE_EVENT,id:existing?.id??'planned:event:uswag-2026',ownerId,reviewerId,reviewedAt:existing?.reviewedAt??null,groupIds:custom,action}};
}
export type UswagBaselinePlan=ReturnType<typeof planUswagBaseline>;
