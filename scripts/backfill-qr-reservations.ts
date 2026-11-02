import 'dotenv/config';
import { createQrReservationDb } from './qr-reservation-db';
import { qrReservationInventory,backfillMissingReservations,readQrClaimInventory,qrInventoryFingerprint } from '../features/students/server/qrInventory';
import { takeRosterExclusiveLock } from '../globals/utils/pgLocks';
async function main(){
const {db:prisma,close}=createQrReservationDb();
try{
 const inventory=await qrReservationInventory(prisma);
 if(!process.argv.includes('--apply'))console.log(JSON.stringify({mode:'read-only',fingerprint:inventory.fingerprint,issues:inventory.issues.length,instruction:'Review private audit output. Apply requires the exact fingerprint and --backup-confirmed.'}));
 else{
  const index=process.argv.indexOf('--expected-hash');const expected=process.argv[index+1];
  if(index<0||!process.argv.includes('--backup-confirmed')||expected!==inventory.fingerprint)throw new Error('Apply requires a reviewed current fingerprint and confirmed backup.');
  // Fingerprint covers the complete registry/identity inventory, rechecked under lock.
  await prisma.$transaction(async tx=>{
   await takeRosterExclusiveLock(tx);
   const latest=await readQrClaimInventory(tx);
   if(!latest.schemaReady)throw new Error('Apply reviewed M2 before backfill.');
   if(qrInventoryFingerprint(latest)!==expected)throw new Error('Inventory changed. Review again.');
   if(inventory.issues.some(issue=>!['MISSING','MISSING_HISTORICAL','QUARANTINED'].includes(issue.kind)))throw new Error('Ownership conflict requires separate identity investigation; no changes made.');
   await backfillMissingReservations(tx);
  },{timeout:30000});
  console.log(JSON.stringify({mode:'applied',...(await qrReservationInventory(prisma)),claims:undefined,issues:undefined}));
 }
}finally{await close();}

}
main().catch(error=>{console.error(error instanceof Error?error.message:"QR inventory failed");process.exitCode=1;});
