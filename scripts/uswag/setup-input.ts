/** Source validation only: no database access and no attendee values in errors. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CSV_HEADERS, IMPORT_GROUP_FIELDS, type CanonicalRow } from "../../features/students/import/contract";
import { customGroupSlug, EXPECTED, type Participant } from "./reconcile";

export type GroupDefinition = {slug:string;name:string;category:string;approved:boolean};
export type SetupInput = {
  rows: Array<{sourceRow:number;group:string;position:string|null;student:CanonicalRow}>;
  groups: GroupDefinition[];
  hashes: Record<string,string>;
  blockers: string[];
  held: Array<{sourceRow:number;group:string;name:string}>;
};
const ORGANIZATIONS: Record<string,string> = {
 "SUPREME STUDENT COUNCIL (SSC OFFICERS)":"SSC Officers",
 "SUPREME SECONDARY LEARNER GOVERNMENT (SSLG OFFICERS)":"SSLG Officers",
 "COLLEGE OF COMPUTER STUDIES OFFICERS (CS OFFICERS)":"CS Officers",
 "ASSOCIATION OF JUNIOR BUSINESS EXECUTIVES (BA OFFICERS)":"BA Officers",
 "YOUNG HOTELLIERS SOCIETY (YHS OFFICERS)":"YHS Officers",
 "COLLEGE OF CRIMINAL JUSTICE (CCJ OFFICERS)":"CCJ Officers",
 "COLLEGE DEPARTMENT HOUSE LORD/LADY":"House Lords/Ladies",
};
const APPROVED_COUNTS = {...EXPECTED,"SSLG Officers":26};
const FIXED_HOUSES = {azul:"Azul",cahel:"Cahel",giallio:"Giallio",roxxo:"Roxxo",vierrdy:"Vierrdy"};
const GROUP_COUNTS: Record<string,number> = {SECTION:38,PROGRAM:10,STRAND:11,DEPARTMENT:3,HOUSE:5};
const SOURCE_FILES = {
 workbook:"01_AUTHORITATIVE/USWAG_ATTENDANCE_2026.xlsx",
 manifest:"01_AUTHORITATIVE/USWAG_2026_APPROVED_SETUP_MANIFEST_95.csv",
 provenance:"01_AUTHORITATIVE/USWAG_2026_SETUP_PROVENANCE.json",
 officerReview:"03_REFERENCE/USWAG_officers_review_PREVIOUS.csv",
 academicAndHouseImport:"03_REFERENCE/USWAG_students_94_ACADEMICS_AND_HOUSES.csv",
 requiredGroups:"02_GROUP_REVIEW/USWAG_REQUIRED_GROUP_IDENTIFIERS_67.csv",
 groupCatalog:"02_GROUP_REVIEW/group_catalog_review.csv",
 houseCatalog:"02_GROUP_REVIEW/HOUSE_group_seed_catalog.csv",
};
function fail(message:string): never {throw new Error(message);}
function check(condition:unknown,message:string): asserts condition {if(!condition)fail(message);}
function object(value:unknown): Record<string,unknown> {check(value && typeof value === "object" && !Array.isArray(value),"Invalid setup JSON structure.");return value as Record<string,unknown>;}
function array(value:unknown):unknown[] {check(Array.isArray(value),"Invalid setup JSON array.");return value;}
function json(bytes:Buffer):Record<string,unknown> {try{return object(JSON.parse(bytes.toString("utf8")));}catch{fail("Invalid setup JSON document.");}}
function read(path:string):Buffer {try{const bytes=readFileSync(path);check(bytes.length<=16*1024*1024,"Setup source exceeds size limit.");return bytes;}catch{fail("Missing, unreadable or oversized setup source.");}}
function sha256(bytes:Buffer):string{return createHash("sha256").update(bytes).digest("hex");}
/** Strict CSV parser independent of student-import headers; preserves exact cell bytes. */
function csv(bytes:Buffer, required:string[]):Record<string,string>[] {
 const text=bytes.toString("utf8").replace(/^\uFEFF/,"");
 let cell="",cells:string[]=[],quoted=false,closed=false;
 const records:string[][]=[];
 const finish=()=>{cells.push(cell);if(cells.some(value=>value!==""))records.push(cells);cells=[];cell="";closed=false;};
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(quoted){if(char==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=char;}
  else if(char===","){cells.push(cell);cell="";closed=false;}
  else if(char==="\n"||char==="\r"){finish();if(char==="\r"&&text[i+1]==="\n")i++;}
  else if(char==='"'&&!cell&&!closed)quoted=true;
  else {check(char!=='"'&&!closed,"Malformed setup CSV.");cell+=char;}
  check(cell.length<=8192&&cells.length<=100&&records.length<=20000,"Setup CSV exceeds limits.");
 }
 check(!quoted,"Malformed setup CSV.");finish();
 const headers=records.shift();check(headers&&new Set(headers).size===headers.length&&required.every(key=>headers.includes(key)),"Missing or duplicate setup CSV headers.");
 return records.map(row=>{check(row.length===headers.length,"Invalid setup CSV column count.");return Object.fromEntries(headers.map((key,i)=>[key,row[i]]));});
}
function unique(rows:Record<string,string>[],key:string,label:string):Map<string,Record<string,string>> {
 const result=new Map<string,Record<string,string>>();for(const row of rows){check(row[key]&&!result.has(row[key]),`Duplicate or missing ${label}.`);result.set(row[key],row);}return result;
}
function groupKey(category:string,slug:string){return `${category}:${slug}`;}
export function loadSetupInput(directory:string,approvalsPath?:string):SetupInput {
 const buffers=Object.fromEntries(Object.entries(SOURCE_FILES).map(([key,path])=>[key,read(join(directory,path))]));
 const hashes:Record<string,string>=Object.fromEntries(Object.entries(buffers).map(([key,bytes])=>[key,sha256(bytes)]));
 const provenance=json(buffers.provenance);
 for(const [key,source] of Object.entries({sourceWorkbookSha256:"workbook",approvedManifestSha256:"manifest",officerReviewSha256:"officerReview",academicAndHouseImportSha256:"academicAndHouseImport"}))check(provenance[key]===hashes[source],"Setup provenance checksum mismatch.");
 check(provenance.attendeeCount===95&&provenance.approvedUSNs===94&&provenance.uniqueAcademicAndHouseGroups===67&&provenance.missingFromFreshDemoSeed===50,"Invalid setup provenance counts.");
 const assignmentCounts=object(provenance.approvedGroupAssignments);
 check(Object.keys(assignmentCounts).length===7&&Object.entries(APPROVED_COUNTS).every(([group,count])=>assignmentCounts[group]===count),"Invalid provenance group counts.");
 let workbook:{participants:Participant[]};
 try{workbook=JSON.parse(execFileSync("python3",[join(dirname(fileURLToPath(import.meta.url)),"read-workbook.py"),"-"],{input:buffers.workbook,encoding:"utf8",maxBuffer:8*1024*1024,stdio:["pipe","pipe","pipe"]}));}catch{fail("Workbook source validation failed.");}
 check(Array.isArray(workbook.participants)&&workbook.participants.length===95,"Workbook source counts differ.");
 const manifest=csv(buffers.manifest,["sourceRow","attendeeName","organization","position","approvalStatus","approvalBasis",...CSV_HEADERS.filter(key=>key!=="id")]);
 check(manifest.length===95,"Manifest source count differs.");
 const byRow=unique(manifest,"sourceRow","source row");
 const officers=csv(buffers.officerReview,["USWAG source row","Organization","Position","Name on USWAG list","USN","LRN"]);
 check(officers.length===95,"Officer reference count differs.");
 const officerByRow=unique(officers,"USWAG source row","officer reference row");
 const academics=csv(buffers.academicAndHouseImport,CSV_HEADERS.filter(key=>key!=="id"));
 check(academics.length===94,"Academic reference count differs.");
 const academicByUsn=unique(academics,"usn","reference USN");
 const aliases=array(provenance.organizerConfirmedAliases).map(object);
 const heldNames=array(provenance.pendingIdentifierNames);
 check(heldNames.length===1&&typeof heldNames[0]==="string","Invalid held source provenance.");
 const rows:SetupInput["rows"]=[],held:SetupInput["held"]=[],seenUsns=new Set<string>(),usedAliases=new Set<number>();
 for(const participant of workbook.participants){
  const row=byRow.get(String(participant.row));
  check(row&&ORGANIZATIONS[row.organization]===participant.group&&row.attendeeName===participant.name&&(row.position||null)===participant.position,"Manifest/workbook source binding mismatch.");
  check((participant.position?.length??0)<=160,"Workbook position exceeds schema limit.");
  const officer=officerByRow.get(row.sourceRow);
  check(officer&&officer.Organization===row.organization&&officer.Position===row.position&&officer["Name on USWAG list"]===row.attendeeName&&officer.USN===row.usn&&officer.LRN===row.lrn,"Officer reference identity/source binding mismatch.");
  if(row.approvalStatus==="PENDING_IDENTIFIER"){
   check(!row.usn&&!row.lrn&&heldNames[0]===row.attendeeName&&participant.group==="SSLG Officers","Invalid held source identity.");
   held.push({sourceRow:participant.row,group:participant.group,name:participant.name});continue;
  }
  check(row.approvalStatus==="APPROVED","Unrecognized source approval status.");
  check(/^\d{11}$/.test(row.usn)&&!seenUsns.has(row.usn),"Malformed or duplicate approved USN.");seenUsns.add(row.usn);
  check(!row.lrn||/^\d{12}$/.test(row.lrn),"Malformed approved identity LRN.");
  const academic=academicByUsn.get(row.usn);
  check(academic&&CSV_HEADERS.filter(key=>key!=="id").every(key=>academic[key]===row[key]),"Academic reference identity binding mismatch.");
  if(row.approvalBasis.startsWith("ORGANIZER_CONFIRMED_ALIAS")){
   const index=aliases.findIndex(alias=>alias.uswagName===row.attendeeName&&alias.approvedUSN===row.usn);
   check(index>=0&&!usedAliases.has(index),"Unbound or duplicate organizer alias.");usedAliases.add(index);
  }else check(row.approvalBasis==="APPROVED_ROSTER_RECONCILIATION","Unknown identity approval basis.");
  const student=Object.fromEntries(CSV_HEADERS.map(key=>[key,key==="id"?"":row[key]??""])) as CanonicalRow;
  if(row.enrollmentStatus!==undefined)student.enrollmentStatus=row.enrollmentStatus;
  rows.push({sourceRow:participant.row,group:participant.group,position:participant.position,student});
 }
 check(rows.length===94&&held.length===1&&usedAliases.size===aliases.length,"Invalid 95/94/1 source or alias counts.");
 check(Object.entries(APPROVED_COUNTS).every(([name,count])=>rows.filter(row=>row.group===name).length===count),"Approved workbook group counts differ.");
 const required=csv(buffers.requiredGroups,["category","slug","displayNameFromExistingCatalog","studentReferences","inDemoSeed","inHistoricalCatalog","reviewRequirement"]);
 const catalog=csv(buffers.groupCatalog,["category","slug","displayName","reviewDecision","approvedLabel","approvedSlug"]);
 const houses=csv(buffers.houseCatalog,["category","slug","displayName"]);
 const requiredKeys=new Set<string>(),catalogByKey=new Map<string,Record<string,string>>();
 for(const row of catalog){const key=groupKey(row.category,row.slug);check(!catalogByKey.has(key),"Duplicate group catalog definition.");catalogByKey.set(key,row);}
 check(required.length===67&&required.filter(row=>row.inDemoSeed==="NO").length===50,"Required group catalog counts differ.");
 check(Object.entries(GROUP_COUNTS).every(([category,count])=>required.filter(row=>row.category===category).length===count),"Required group catalog categories differ.");
 check(houses.length===5&&Object.entries(FIXED_HOUSES).every(([slug,name])=>houses.filter(row=>row.slug===slug&&row.displayName===name&&row.category==="HOUSE").length===1),"Permanent house catalog differs from fixed definitions.");
 const referenced=new Map<string,number>();
 for(const {student} of rows)for(const [field,category] of Object.entries(IMPORT_GROUP_FIELDS)){
  const slug=student[field as keyof typeof IMPORT_GROUP_FIELDS];if(slug){const key=groupKey(category,slug);referenced.set(key,(referenced.get(key)??0)+1);}
 }
 check(referenced.size===67,"Required academic group reference count differs.");
 const groups:GroupDefinition[]=required.map(row=>{
  const key=groupKey(row.category,row.slug);check(!requiredKeys.has(key),"Duplicate required group identifier.");requiredKeys.add(key);
  check(referenced.get(key)===Number(row.studentReferences)&&Number.isSafeInteger(Number(row.studentReferences))&&Number(row.studentReferences)>0,"Required group references differ from manifest.");
  const isHouse=row.category==="HOUSE",source=isHouse?houses.find(house=>house.slug===row.slug):catalogByKey.get(key);
  check(row.slug.length<=100&&row.slug.length>0&&(!source ? !isHouse&&!row.displayNameFromExistingCatalog&&row.inHistoricalCatalog==="NO" : source.displayName===row.displayNameFromExistingCatalog&&source.displayName.length>0&&source.displayName.length<=120),"Missing or conflicting required group catalog definition.");
  check(["REVIEW_SEMANTICS_AND_APPROVE","VERIFY_BEFORE_APPLY"].includes(row.reviewRequirement),"Unknown group review requirement.");
  const explicitlyReviewed=source?.reviewDecision==="APPROVED"&&source.approvedSlug===row.slug&&source.approvedLabel===source.displayName;
  return {slug:row.slug,name:source?.displayName??"",category:row.category,approved:isHouse||explicitlyReviewed};
 });
 if(approvalsPath){
  const bytes=read(approvalsPath);hashes.approvals=sha256(bytes);
  const approval=json(bytes),sourceHashes=object(approval.sourceHashes);
  check(approval.v===1&&sourceHashes.requiredGroups===hashes.requiredGroups&&sourceHashes.groupCatalog===hashes.groupCatalog,"Group approval source hashes are stale or invalid.");
  const seen=new Set<string>();
  for(const value of array(approval.decisions)){
   const decision=object(value);check(typeof decision.category==="string"&&typeof decision.slug==="string"&&typeof decision.name==="string"&&typeof decision.approved==="boolean","Invalid group approval decision.");
   const key=groupKey(decision.category,decision.slug),group=groups.find(group=>groupKey(group.category,group.slug)===key);
   check(group&&(!group.name||group.name===decision.name)&&decision.name.trim()===decision.name&&decision.name.length>0&&decision.name.length<=120&&!seen.has(key),"Unknown, renamed or duplicate group approval decision.");seen.add(key);group.name=decision.name;group.approved=decision.approved;
  }
 }
 const blockers=groups.filter(group=>!group.approved).map(group=>`Group definition requires explicit approval: ${group.category}:${group.slug}`);
 groups.push(...Object.keys(EXPECTED).map(name=>({name,slug:customGroupSlug(name),category:"CUSTOM",approved:true})));
 return {rows,groups,hashes,held,blockers};
}
