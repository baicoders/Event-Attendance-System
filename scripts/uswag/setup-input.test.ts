import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFixture, hashFile } from "./setup-fixture.test-support";
import { loadSetupInput } from "./setup-input";

type ApprovalFixture = {sourceHashes:{requiredGroups:string;groupCatalog:string};decisions:Array<{slug:string;name:string;category:string;approved:boolean}>};
function fixture(t: {after(fn:()=>void):void}) {
 const dir=mkdtempSync(join(tmpdir(),"uswag-input-test-")); t.after(()=>rmSync(dir,{recursive:true,force:true})); return createFixture(dir);
}
function updateProvenance(f: ReturnType<typeof createFixture>,key:string,path:string) {
 const p=JSON.parse(readFileSync(f.paths.provenance,"utf8")); p[key]=hashFile(path);writeFileSync(f.paths.provenance,JSON.stringify(p));
}
test("validates the complete 95/94/1 source and 67 groups without treating pending decisions as approvals",t=>{
 const f=fixture(t), input=loadSetupInput(f.directory);
 assert.equal(input.rows.length,94);assert.equal(input.held.length,1);assert.equal(input.groups.filter(g=>g.category!=="CUSTOM").length,67);
 assert.equal(input.groups.filter(g=>g.category==="CUSTOM").length,7);assert.equal(input.groups.filter(g=>!g.approved).length,62);
 assert.ok(input.blockers.length>=15);assert.equal(input.rows[0].student.firstName,"Student1");
 assert.equal(input.hashes.manifest,hashFile(f.paths.manifest));
});
test("exact source-bound group approvals remove pending decisions",t=>{
 const f=fixture(t),input=loadSetupInput(f.directory,f.approvalsPath);
 assert.deepEqual(input.blockers,[]);assert.ok(input.groups.every(g=>g.approved));
 const counts=Object.fromEntries(input.groups.filter(g=>g.category==="CUSTOM").map(g=>[g.name,input.rows.filter(row=>row.group===g.name).length]));
 assert.deepEqual(counts,{"SSC Officers":13,"SSLG Officers":26,"CS Officers":14,"BA Officers":11,"YHS Officers":13,"CCJ Officers":12,"House Lords/Ladies":5});
});
test("rejects changed bytes before parsing a manifest",t=>{
 const f=fixture(t);writeFileSync(f.paths.manifest,readFileSync(f.paths.manifest,"utf8")+"\n");
 assert.throws(()=>loadSetupInput(f.directory),/hash|checksum|provenance/i);
});
test("rejects source-row, organization, name and position mismatches even with refreshed manifest checksum",t=>{
 for(const [before,after] of [['"3"','"999"'],['Student3 Synthetic','Unbound Synthetic'],['Officer 1','Different position'],['SUPREME STUDENT COUNCIL (SSC OFFICERS)','Unexpected organization']]) {
  const f=fixture(t);writeFileSync(f.paths.manifest,readFileSync(f.paths.manifest,"utf8").replace(before,after));updateProvenance(f,"approvedManifestSha256",f.paths.manifest);
  assert.throws(()=>loadSetupInput(f.directory),/workbook|source|binding|organization/i);
 }
});
test("rejects duplicate or malformed USNs and swaps against independently bound references",t=>{
 for(const replacement of ['26000000002','bad-usn','26000999999']) {
  const f=fixture(t);writeFileSync(f.paths.manifest,readFileSync(f.paths.manifest,"utf8").replace('26000000001',replacement));updateProvenance(f,"approvedManifestSha256",f.paths.manifest);
  assert.throws(()=>loadSetupInput(f.directory),/USN|identity|reference/i);
 }
});
test("rejects missing or changed references and missing required group definitions",t=>{
 const f=fixture(t);writeFileSync(f.paths.academicAndHouseImport,readFileSync(f.paths.academicAndHouseImport,"utf8")+"\n");
 assert.throws(()=>loadSetupInput(f.directory),/hash|checksum|provenance/i);
 const g=fixture(t);writeFileSync(g.paths.requiredGroups,readFileSync(g.paths.requiredGroups,"utf8").replace('section-1','section-999'));
 assert.throws(()=>loadSetupInput(g.directory),/group|catalog|reference/i);
});
test("rejects stale, unknown, duplicate or renamed approval decisions",t=>{
 for(const mutate of [(p:ApprovalFixture)=>p.sourceHashes.requiredGroups="0".repeat(64),(p:ApprovalFixture)=>p.decisions[0].name="Unreviewed name",(p:ApprovalFixture)=>p.decisions.push(p.decisions[0]),(p:ApprovalFixture)=>p.decisions[0].category="HOUSE"]){
 const f=fixture(t),p=JSON.parse(readFileSync(f.approvalsPath,"utf8"));mutate(p);writeFileSync(f.approvalsPath,JSON.stringify(p));
 assert.throws(()=>loadSetupInput(f.directory,f.approvalsPath),/approval/i);
 }
});
test("aliases require a generic exact name/USN provenance entry",t=>{
 const f=fixture(t),p=JSON.parse(readFileSync(f.paths.provenance,"utf8"));p.organizerConfirmedAliases[0].approvedUSN="26000999999";writeFileSync(f.paths.provenance,JSON.stringify(p));
 assert.throws(()=>loadSetupInput(f.directory),/alias/i);
});
test("missing historical definitions remain blocked until a source-bound explicit name is approved",t=>{
 const f=fixture(t);
 // Remove one existing catalog definition and its required display name, matching the handoff's historical gaps.
 writeFileSync(f.paths.groupCatalog,readFileSync(f.paths.groupCatalog,"utf8").split("\r\n").filter(line=>!line.includes('"program-1"')).join("\r\n"));
 const required=readFileSync(f.paths.requiredGroups,"utf8").replace('"PROGRAM","program-1","PROGRAM 1"','"PROGRAM","program-1",""').replace(/("PROGRAM","program-1","","[0-9]+","(?:YES|NO)",)"YES"/,'$1"NO"');writeFileSync(f.paths.requiredGroups,required);
 const pending=loadSetupInput(f.directory);assert.equal(pending.groups.find(g=>g.slug==='program-1')?.approved,false);
 assert.equal(pending.groups.find(g=>g.slug==='program-1')?.name,"");
 const p=JSON.parse(readFileSync(f.approvalsPath,"utf8"));p.sourceHashes.requiredGroups=hashFile(f.paths.requiredGroups);p.sourceHashes.groupCatalog=hashFile(f.paths.groupCatalog);writeFileSync(f.approvalsPath,JSON.stringify(p));
 const approved=loadSetupInput(f.directory,f.approvalsPath);assert.equal(approved.groups.find(g=>g.slug==='program-1')?.name,"PROGRAM 1");assert.deepEqual(approved.blockers,[]);
});
test("keeps the held attendee without placeholder identity and rejects filled held identifiers",t=>{
 const f=fixture(t),input=loadSetupInput(f.directory);assert.equal(input.held[0].group,"SSLG Officers");
 const manifest=readFileSync(f.paths.manifest,"utf8").replace(/("PENDING_IDENTIFIER","NO_VERIFIED_USN_OR_LRN",)""/, '$1"26000999999"');writeFileSync(f.paths.manifest,manifest);updateProvenance(f,"approvedManifestSha256",f.paths.manifest);
 assert.throws(()=>loadSetupInput(f.directory),/reference|held|identity/i);
});
test("all four authoritative provenance checksums are enforced",t=>{
 for(const key of ["sourceWorkbookSha256","approvedManifestSha256","officerReviewSha256","academicAndHouseImportSha256"]){const f=fixture(t),p=JSON.parse(readFileSync(f.paths.provenance,"utf8"));p[key]="f".repeat(64);writeFileSync(f.paths.provenance,JSON.stringify(p));assert.throws(()=>loadSetupInput(f.directory),/checksum/i);}
});
test("rejects renamed permanent houses before accepting any group approvals",t=>{
 const f=fixture(t);writeFileSync(f.paths.houseCatalog,readFileSync(f.paths.houseCatalog,"utf8").replace('"Azul"','"Different house"'));assert.throws(()=>loadSetupInput(f.directory,f.approvalsPath),/house/i);
});
test("a partial or rejected approval leaves remaining group decisions blocked",t=>{
 const f=fixture(t),p=JSON.parse(readFileSync(f.approvalsPath,"utf8"));p.decisions=p.decisions.slice(0,1);p.decisions[0].approved=false;writeFileSync(f.approvalsPath,JSON.stringify(p));
 const input=loadSetupInput(f.directory,f.approvalsPath);assert.equal(input.groups.filter(g=>!g.approved).length,62);assert.equal(input.blockers.length,62);
});
