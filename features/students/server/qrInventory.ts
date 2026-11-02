import { createHash } from 'node:crypto';
import type { Prisma,PrismaClient } from '@prisma/client';
/** Includes old receipt evidence without promoting uncertain history to ownership. */
export async function readQrClaimInventory(tx:Prisma.TransactionClient){
 const students=await tx.student.findMany({select:{id:true,usn:true,lrn:true},orderBy:{id:'asc'}});
 const historicalClaims=await tx.$queryRaw<Array<{code:string;owner:string}>>`
 WITH receipt_rows AS (
  SELECT row FROM "StudentImportBatch" b CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(b.result->'rows')='array' THEN b.result->'rows' ELSE '[]'::jsonb END) AS row
 ), claims AS (
  SELECT claim.code,row->>'studentId' AS owner FROM receipt_rows
  CROSS JOIN LATERAL (VALUES(row->'student'->>'id'),(row->'student'->>'usn'),(row->'student'->>'lrn')) AS claim(code) WHERE row->>'status'='CREATE'
  UNION ALL SELECT claim.code,row->>'studentId' FROM receipt_rows
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(row->'changes')='array' THEN row->'changes' ELSE '[]'::jsonb END) AS change
  CROSS JOIN LATERAL (VALUES(change->>'before'),(change->>'after')) AS claim(code) WHERE change->>'field' IN ('usn','lrn')
 ) SELECT DISTINCT code,owner FROM claims WHERE code IS NOT NULL AND code<>'' AND owner IS NOT NULL ORDER BY code,owner`;
 const [schema]=await tx.$queryRaw<Array<{ready:boolean}>>`SELECT to_regclass('"StudentQrCode"') IS NOT NULL AS ready`;
 const registry=schema.ready?await tx.studentQrCode.findMany({orderBy:{code:'asc'}}):[];
 return {students,registry,historicalClaims,schemaReady:schema.ready};
}
export function qrInventoryFingerprint(input:Pick<Awaited<ReturnType<typeof readQrClaimInventory>>,'students'|'registry'|'historicalClaims'>){
 return createHash('sha256').update(JSON.stringify({v:2,students:input.students,registry:input.registry,historicalClaims:input.historicalClaims})).digest('hex');
}
function collectClaims(input:Awaited<ReturnType<typeof readQrClaimInventory>>){
 const claims=new Map<string,{owners:Set<string>;current:boolean;external:boolean;kind:string}>();
 for(const student of input.students)for(const [code,kind] of [[student.id,'INTERNAL_ID'],[student.usn,'USN'],[student.lrn,'LRN']] as const){
  if(!code)continue;const claim=claims.get(code)??{owners:new Set<string>(),current:true,external:false,kind};claim.owners.add(student.id);claim.external ||= kind!=='INTERNAL_ID';claims.set(code,claim);
 }
 for(const {code,owner} of input.historicalClaims){const claim=claims.get(code)??{owners:new Set<string>(),current:false,external:false,kind:'HISTORICAL_IMPORT'};claim.owners.add(owner);claims.set(code,claim);}
 return claims;
}
export async function qrReservationInventory(db:PrismaClient){
 return db.$transaction(async tx=>{
  const input=await readQrClaimInventory(tx);const byCode=new Map(input.registry.map(row=>[row.code,row]));const claims=collectClaims(input);
  const issues=[...claims].sort(([a],[b])=>a.localeCompare(b)).flatMap(([code,claim])=>{
   const row=byCode.get(code);const claimants=[...claim.owners].sort();
   if(!row)return [{code,claimants,kind:claimants.length>1?'COLLISION_UNSAFE':claim.current?'MISSING':'MISSING_HISTORICAL'}];
   if(claimants.length>1)return [{code,claimants,kind:row.state==='QUARANTINED'?'QUARANTINED':'COLLISION_UNSAFE'}];
   if(row.state==='QUARANTINED')return [{code,claimants,kind:'QUARANTINED'}];
   if(row.state==='RETIRED'&&claim.external)return [{code,claimants,kind:'RETIRED_CURRENT'}];
   if(row.reservedOwnerId!==claimants[0])return [{code,claimants,kind:'OWNER_MISMATCH'}];
   return [];
  });
  return {fingerprint:qrInventoryFingerprint(input),schemaReady:input.schemaReady,students:input.students.length,reservations:input.registry.length,historicalClaims:input.historicalClaims.length,issues,claims:[...claims].map(([code,claim])=>({code,owners:[...claim.owners].sort(),current:claim.current}))};
 },{isolationLevel:'RepeatableRead'});
}
export async function backfillMissingReservations(tx:Prisma.TransactionClient){
 const input=await readQrClaimInventory(tx);if(!input.schemaReady)throw new Error('Apply the reviewed M2 schema migration before backfill.');
 const registry=new Set(input.registry.map(row=>row.code));
 for(const [code,claim] of [...collectClaims(input)].sort(([a],[b])=>a.localeCompare(b))){
  if(registry.has(code))continue;const owners=[...claim.owners];
  await tx.studentQrCode.create({data:{code,originalKind:claim.kind,...(owners.length===1&&claim.current?{studentId:owners[0],reservedOwnerId:owners[0]}:{state:'QUARANTINED',candidateEvidence:owners})}});
 }
}
