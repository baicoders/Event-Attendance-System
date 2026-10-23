import { studentSchema } from '@/globals/schemas/studentSchema';
import { hasAmbiguousStudentGroups } from '@/globals/utils/studentGroupReview';
import {CSV_HEADERS,IMPORT_GROUP_FIELDS,type CanonicalRow,type ExistingImportStudent,type ImportChange,type ImportField,type ImportGroup,type ImportGroupField,type ImportReason,type ImportReview,type ParsedImportRow,type UnknownImportGroup} from './contract';
const groupFields=Object.keys(IMPORT_GROUP_FIELDS) as ImportGroupField[];
/** Blanks are omissions. Legacy id input is an explicit USN alias, never a new primary key. */
export function normalizeStudentImportRow(row:CanonicalRow, legacyAlias=true):CanonicalRow {
 const normalized={...row};
 for(const field of CSV_HEADERS) normalized[field]=(row[field]??'').trim();
 normalized.usn=normalized.usn || (legacyAlias?normalized.id:"");
 for(const field of groupFields)normalized[field]=normalized[field].toLowerCase();
 return normalized;
}
export function existingImportRow(student:ExistingImportStudent):CanonicalRow {
 const value:CanonicalRow={id:student.id,usn:student.usn ?? (student.usn===undefined&&student.id.length===11?student.id:''),lrn:student.lrn??'',firstName:student.firstName,lastName:student.lastName,middleName:student.middleName??'',schoolLevel:student.schoolLevel??'',yearLevel:student.yearLevel??'',section:'',house:'',program:'',department:'',strand:''};
 for(const field of groupFields)value[field]=student.groups.find(group=>group.category===IMPORT_GROUP_FIELDS[field])?.slug??'';
 return value;
}
function domainReasons(student:CanonicalRow):ImportReason[] {
 const validation=studentSchema.safeParse({...student,schoolLevel:student.schoolLevel||null,yearLevel:student.yearLevel||null});
 return validation.success?[]:validation.error.issues.map(issue=>({code:'INVALID_STUDENT',field:issue.path[0] as ImportField,message:issue.message}));
}
export function classifyStudentImport(input:{rows:ParsedImportRow[];groups:ImportGroup[];students:ExistingImportStudent[]}):ImportReview {
 const groups=new Map(input.groups.map(group=>[group.slug,group]));
 const byCode=new Map<string,Map<string,ExistingImportStudent>>();
 for(const student of input.students)for(const code of [student.id,student.usn,student.lrn])if(code) {
  const matches=byCode.get(code)??new Map();matches.set(student.id,student);byCode.set(code,matches);
 }
 const matching=(row:CanonicalRow)=>[...new Map([row.usn,row.lrn].flatMap(code=>code?[...(byCode.get(code)?.values()??[])]:[]).map(student=>[student.id,student])).values()];
 const normalized=input.rows.map(row=>({...row,student:normalizeStudentImportRow(row.student)}));
 const codeCounts=new Map<string,number>();const targetCounts=new Map<string,number>();
 for(const row of normalized) {
  for(const code of [row.student.usn,row.student.lrn].filter(Boolean) as string[])codeCounts.set(code,(codeCounts.get(code)??0)+1);
  for(const student of matching(row.student))targetCounts.set(student.id,(targetCounts.get(student.id)??0)+1);
 }
 const unknown=new Map<string,UnknownImportGroup>();
 const rows=normalized.map(({csvRow,student:incoming})=>{
  const reasons:ImportReason[]=[];
  const matches=matching(incoming);
  if(incoming.id&&incoming.usn!==incoming.id)reasons.push({code:'INVALID_STUDENT',field:'id',message:'Legacy id is a USN alias and must equal the USN column when both are supplied.'});
  if(matches.length>1)reasons.push({code:'IDENTITY_CONFLICT',message:'USN and LRN resolve to different students. Resolve the identities before import.'});
  if([incoming.usn,incoming.lrn].some(code=>code&&(codeCounts.get(code)??0)>1)||matches.some(s=>(targetCounts.get(s.id)??0)>1))reasons.push({code:'DUPLICATE_ID',message:'An identifier or canonical student occurs more than once in this CSV.'});
  const before=matches.length===1?matches[0]:undefined;
  const previous=before?existingImportRow(before):undefined;
  const student={...incoming,id:before?.id??''};
  if(previous) {
   for(const field of CSV_HEADERS)if(!['id','firstName','lastName'].includes(field)&&!student[field])student[field]=previous[field]??"";
   for(const field of ['usn','lrn'] as const)if(incoming[field]&&previous[field]&&incoming[field]!==previous[field])reasons.push({code:'IDENTITY_CONFLICT',field,message:`Existing ${field.toUpperCase()} differs. Review the student manually before replacing identifiers.`});
   for(const membership of before!.groups) {
     const authoritative=groups.get(membership.slug);
     if(authoritative&&(authoritative.id!==membership.id||authoritative.category!==membership.category)) reasons.push({code:'INVALID_EXISTING_STUDENT',field:groupFields.find(field=>IMPORT_GROUP_FIELDS[field]===membership.category),message:'Existing group identity conflicts with the reviewed group.'});
   }
   if(hasAmbiguousStudentGroups(before!.groups))reasons.push({code:'AMBIGUOUS_EXISTING_GROUPS',message:'Existing memberships require manual review.'});
   if(before!.groups.some(group=>group.slug==='employees'))reasons.push({code:'IDENTITY_CONFLICT',message:'Employee identities cannot be changed through student import.'});
  }
  reasons.push(...domainReasons(student));
  const groupIds:string[]=[];
  for(const field of groupFields) {
   const slug=student[field];if(!slug)continue;
   const group=groups.get(slug)??before?.groups.find(g=>g.slug===slug&&g.category===IMPORT_GROUP_FIELDS[field]);
   if(slug==='employees')reasons.push({code:'INVALID_GROUP',field,message:'Employees is reserved for employee registration.'});
   if(!group) {
    reasons.push({code:'UNKNOWN_GROUP',field,message:`Unknown ${field} group "${slug}".`});
    const key=`${IMPORT_GROUP_FIELDS[field]}:${slug}`;const reference=unknown.get(key)??{slug,category:IMPORT_GROUP_FIELDS[field],referenceCount:0};reference.referenceCount++;unknown.set(key,reference);
   } else if(group.category!==IMPORT_GROUP_FIELDS[field])reasons.push({code:'GROUP_CATEGORY_MISMATCH',field,message:`"${slug}" is not a ${field} group.`});
   else groupIds.push(group.id);
  }
  const changes:ImportChange[]=[];
  if(previous)for(const field of CSV_HEADERS)if(field!=='id') {
   const oldValue=previous[field]||null;const newValue=student[field]||null;
   if(oldValue!==newValue)changes.push({field,before:oldValue,after:newValue});
  }
  const status=reasons.length?'BLOCKED' as const:!before?'CREATE' as const:changes.length?'UPDATE' as const:'UNCHANGED' as const;
  return {csvRow,student,status,changes,reasons,groupIds};
 });
 const counts={total:rows.length,create:0,update:0,unchanged:0,blocked:0};
 for(const row of rows)if(row.status==='CREATE')counts.create++;else if(row.status==='UPDATE')counts.update++;else if(row.status==='UNCHANGED')counts.unchanged++;else counts.blocked++;
 return {rows,counts,unknownGroups:[...unknown.values()]};
}
