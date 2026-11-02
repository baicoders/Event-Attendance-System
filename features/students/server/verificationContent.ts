import { createHash } from 'node:crypto';
type Profile={id:string;usn?:string|null;lrn?:string|null;firstName:string;lastName:string;middleName:string|null;schoolLevel:string|null;yearLevel:string|null;groups:Array<{id:string;category:string;slug:string;name?:string}>};
export function verificationContentHash(student:Profile){
 const {id,usn,lrn,firstName,lastName,middleName,schoolLevel,yearLevel}=student;
 const groups=student.groups.filter(g=>!['HOUSE','CUSTOM'].includes(g.category)).map(({id,category,slug})=>({id,category,slug})).sort((a,b)=>a.id.localeCompare(b.id));
 return createHash('sha256').update(JSON.stringify({v:1,id,usn:usn??null,lrn:lrn??null,firstName,lastName,middleName,schoolLevel,yearLevel,groups})).digest('hex');
}
