/** Public, synthetic complete bundle. Never copy real attendee identifiers here. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ORGANIZATIONS = {
  "SSC Officers": "SUPREME STUDENT COUNCIL (SSC OFFICERS)",
  "SSLG Officers": "SUPREME SECONDARY LEARNER GOVERNMENT (SSLG OFFICERS)",
  "CS Officers": "COLLEGE OF COMPUTER STUDIES OFFICERS (CS OFFICERS)",
  "BA Officers": "ASSOCIATION OF JUNIOR BUSINESS EXECUTIVES (BA OFFICERS)",
  "YHS Officers": "YOUNG HOTELLIERS SOCIETY (YHS OFFICERS)",
  "CCJ Officers": "COLLEGE OF CRIMINAL JUSTICE (CCJ OFFICERS)",
  "House Lords/Ladies": "COLLEGE DEPARTMENT HOUSE LORD/LADY",
};
export function writeCsv(path: string, rows: Record<string, string>[]) {
  const headers = Object.keys(rows[0]);
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  writeFileSync(path, [headers, ...rows.map(row => headers.map(key => row[key] ?? ""))].map(row => row.map(quote).join(",")).join("\r\n") + "\r\n");
}
export function hashFile(path: string) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
export function createFixture(directory: string) {
  for (const part of ["01_AUTHORITATIVE", "02_GROUP_REVIEW", "03_REFERENCE"]) mkdirSync(join(directory, part), {recursive: true});
  const paths = {
    workbook: join(directory, "01_AUTHORITATIVE/USWAG_ATTENDANCE_2026.xlsx"),
    manifest: join(directory, "01_AUTHORITATIVE/USWAG_2026_APPROVED_SETUP_MANIFEST_95.csv"),
    provenance: join(directory, "01_AUTHORITATIVE/USWAG_2026_SETUP_PROVENANCE.json"),
    officerReview: join(directory, "03_REFERENCE/USWAG_officers_review_PREVIOUS.csv"),
    academicAndHouseImport: join(directory, "03_REFERENCE/USWAG_students_94_ACADEMICS_AND_HOUSES.csv"),
    requiredGroups: join(directory, "02_GROUP_REVIEW/USWAG_REQUIRED_GROUP_IDENTIFIERS_67.csv"),
    groupCatalog: join(directory, "02_GROUP_REVIEW/group_catalog_review.csv"),
    houseCatalog: join(directory, "02_GROUP_REVIEW/HOUSE_group_seed_catalog.csv"),
  };
  const houses = ["azul", "cahel", "giallio", "roxxo", "vierrdy"];
  const definitions = Object.entries({SECTION:38, PROGRAM:10, STRAND:11, DEPARTMENT:3, HOUSE:5}).flatMap(([category,count]) => Array.from({length:count}, (_,i) => ({category,slug:category === "HOUSE" ? houses[i] : `${category.toLowerCase()}-${i+1}`,displayName:category === "HOUSE" ? houses[i][0].toUpperCase()+houses[i].slice(1) : `${category} ${i+1}`})));
  const manifests: Record<string,string>[] = [], participants: {row:number;name:string;position:string;organization:string;number:number}[] = [];
  let sourceRow = 1, index = 0;
  for (const [group,count] of Object.entries({"SSC Officers":13,"SSLG Officers":27,"CS Officers":14,"BA Officers":11,"YHS Officers":13,"CCJ Officers":12,"House Lords/Ladies":5})) {
    const organization = ORGANIZATIONS[group as keyof typeof ORGANIZATIONS];
    sourceRow++;
    for(let number=1;number<=count;number++) {
      sourceRow++; index++;
      const held = group === "SSLG Officers" && number === 27;
      const studentIndex = index - (index > 40 ? 1 : 0);
      const firstName = `Student${index}`, lastName = "Synthetic", attendeeName = index <= 2 ? `Alias${index} Synthetic` : `${firstName} ${lastName}`;
      const usn = held ? "" : String(26000000000 + studentIndex);
      const position = `Officer ${number}`;
      const shs = !held && studentIndex <= 30;
      const fields = {usn,lrn:"",firstName:held?"":firstName,middleName:"",lastName:held?"":lastName,schoolLevel:held?"":shs?"SHS":"COLLEGE",yearLevel:held?"":shs?"GRADE_11":"YEAR_1",section:held?"":`section-${(studentIndex-1)%38+1}`,house:held||shs?"":houses[(studentIndex-1)%5],program:held||shs?"":`program-${(studentIndex-1)%10+1}`,department:held||shs?"":`department-${(studentIndex-1)%3+1}`,strand:held||!shs?"":`strand-${(studentIndex-1)%11+1}`};
      manifests.push({sourceRow:String(sourceRow),attendeeName,organization,position,approvalStatus:held?"PENDING_IDENTIFIER":"APPROVED",approvalBasis:held?"NO_VERIFIED_USN_OR_LRN":index<=2?`ORGANIZER_CONFIRMED_ALIAS_${index}`:"APPROVED_ROSTER_RECONCILIATION",...fields});
      participants.push({row:sourceRow,name:attendeeName,position,organization,number});
    }
  }
  // Minimal XLSX written with the same standard-library zip/XML format the production reader consumes.
  execFileSync("python3", ["-c", `import json,sys,zipfile,html
p=json.loads(sys.argv[2]); rows=[]; previous=None
for x in p:
 if x['organization']!=previous:
  r=x['row']-1; rows.append('<row r="%s"><c r="A%s" t="inlineStr"><is><t>%s</t></is></c></row>'%(r,r,html.escape(x['organization']))); previous=x['organization']
 r=x['row']; cells=[]
 for c,v in [('A',str(x['number'])),('B',x['name']),('C',x['position'])]: cells.append('<c r="%s%s" t="inlineStr"><is><t>%s</t></is></c>'%(c,r,html.escape(v)))
 rows.append('<row r="%s">%s</row>'%(r,''.join(cells)))
with zipfile.ZipFile(sys.argv[1],'w') as z:
 z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ATTENDANCE" sheetId="1" r:id="rId1"/></sheets></workbook>')
 z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
 z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+''.join(rows)+'</sheetData></worksheet>')`, paths.workbook, JSON.stringify(participants)]);
  writeCsv(paths.manifest, manifests);
  writeCsv(paths.academicAndHouseImport, manifests.filter(row=>row.approvalStatus === "APPROVED").map(row => Object.fromEntries(["usn","lrn","lastName","firstName","middleName","schoolLevel","yearLevel","section","house","program","department","strand"].map(key => [key,row[key]]))));
  writeCsv(paths.officerReview, manifests.map(row => ({"USWAG source row":row.sourceRow,"Organization":row.organization,"Position":row.position,"Name on USWAG list":row.attendeeName,"USN":row.usn,"LRN":row.lrn})));
  writeCsv(paths.requiredGroups, definitions.map((group,i)=>({category:group.category,slug:group.slug,displayNameFromExistingCatalog:group.displayName,studentReferences:String(manifests.filter(row=>row[group.category.toLowerCase()] === group.slug).length),inDemoSeed:i<17?"YES":"NO",inHistoricalCatalog:group.category === "HOUSE"?"NO":"YES",catalogRecommendation:"REVIEW",reviewRequirement:i<15?"REVIEW_SEMANTICS_AND_APPROVE":"VERIFY_BEFORE_APPLY"})));
  writeCsv(paths.groupCatalog, definitions.filter(group=>group.category !== "HOUSE").map(group=>({...group,reviewDecision:"PENDING",approvedLabel:"",approvedSlug:""})));
  writeCsv(paths.houseCatalog, definitions.filter(group=>group.category === "HOUSE").map(group=>({...group,seedingStatus:"MUST_SEED_BEFORE_IMPORT"})));
  const provenance = {sourceWorkbook:"synthetic.xlsx",sourceWorkbookSha256:hashFile(paths.workbook),approvedManifestSha256:hashFile(paths.manifest),officerReviewSha256:hashFile(paths.officerReview),academicAndHouseImportSha256:hashFile(paths.academicAndHouseImport),attendeeCount:95,approvedUSNs:94,pendingIdentifierNames:manifests.filter(row=>row.approvalStatus !== "APPROVED").map(row=>row.attendeeName),organizerConfirmedAliases:manifests.slice(0,2).map(row=>({uswagName:row.attendeeName,approvedUSN:row.usn})),approvedGroupAssignments:{"SSC Officers":13,"SSLG Officers":26,"CS Officers":14,"BA Officers":11,"YHS Officers":13,"CCJ Officers":12,"House Lords/Ladies":5},uniqueAcademicAndHouseGroups:67,missingFromFreshDemoSeed:50};
  writeFileSync(paths.provenance,JSON.stringify(provenance));
  const approvalsPath = join(directory,"approvals.json");
  writeFileSync(approvalsPath,JSON.stringify({v:1,sourceHashes:{requiredGroups:hashFile(paths.requiredGroups),groupCatalog:hashFile(paths.groupCatalog)},decisions:definitions.filter(group=>group.category !== "HOUSE").map(group=>({slug:group.slug,category:group.category,name:group.displayName,approved:true}))}));
  return {directory,inputDir:directory,paths,approvalsPath};
}
