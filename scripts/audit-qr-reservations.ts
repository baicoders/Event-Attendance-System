import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { createQrReservationDb } from './qr-reservation-db';
import { qrReservationInventory } from '../features/students/server/qrInventory';
async function main(){
const {db:prisma,close}=createQrReservationDb();
try{
 const result=await qrReservationInventory(prisma);
 const index=process.argv.indexOf('--report');
 if(index>=0){const path=process.argv[index+1];if(!path)throw new Error('Provide a private report path.');writeFileSync(path,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});}
 console.log(JSON.stringify({mode:'read-only',fingerprint:result.fingerprint,schemaReady:result.schemaReady,historicalClaims:result.historicalClaims,students:result.students,reservations:result.reservations,issues:result.issues.length,quarantined:result.issues.filter(i=>i.kind==='QUARANTINED').length}));
 if(result.issues.some(i=>i.kind!=='QUARANTINED'))process.exitCode=1;
}finally{await close();}

}
main().catch(error=>{console.error(error instanceof Error?error.message:"QR inventory failed");process.exitCode=1;});
