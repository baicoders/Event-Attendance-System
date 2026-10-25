import {randomUUID} from 'node:crypto';
import {closeSync,fsyncSync,openSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

/** Keep the previous valid recovery record until the replacement is fully synced. */
export function writePrivateReport(path:string,value:unknown){
 const temporary=`${path}.${randomUUID()}.tmp`;let fd:number|undefined;
 try{
  fd=openSync(temporary,'wx',0o600);writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);closeSync(fd);fd=undefined;
  renameSync(temporary,path);
  // Windows cannot open directories as file descriptors. The file itself is
  // synced on every platform; POSIX also persists the rename's directory entry.
  if(process.platform!=='win32'){const directory=openSync(dirname(path),'r');try{fsyncSync(directory);}finally{closeSync(directory);}}
 }finally{
  if(fd!==undefined)closeSync(fd);
  try{unlinkSync(temporary);}catch{/* Rename already consumed it, or cleanup is unavailable. */}
 }
}
