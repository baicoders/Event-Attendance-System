import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const nodeArgs=['--import',import.meta.resolve('tsx'),fileURLToPath(new URL('./run.mjs',import.meta.url)),...process.argv.slice(2)];
const flags=['--what=sleep:idle','--who=Attendance rehearsal','--why=Running the local event capacity rehearsal','--mode=block'];
let command=process.execPath,args=nodeArgs;
const env={...process.env};
if(env.ATTENDANCE_SLEEP_INHIBITED!=='1') {
  const supported=process.platform==='linux' && spawnSync('systemd-inhibit',[...flags,'/usr/bin/true'],{stdio:'ignore',timeout:5000}).status===0;
  if(supported) {
    command='systemd-inhibit';args=[...flags,process.execPath,...nodeArgs];env.ATTENDANCE_SLEEP_INHIBITED='1';
    console.log('Holding a temporary sleep/idle inhibitor for this rehearsal.');
  } else console.error('Automatic sleep inhibition is unavailable; keep the laptop awake during the rehearsal.');
}
const child=spawn(command,args,{env,stdio:'inherit',detached:process.platform!=='win32'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
  if(child.exitCode!==null || child.signalCode)return;
  // systemd-inhibit ignores INT and waits for its worker. Keep it alive while
  // the runner handles cancellation and cleans up its owned database/processes.
  const forwarded=command==='systemd-inhibit'?'SIGINT':signal;
  try {
    if(process.platform==='win32')child.kill(forwarded);
    else process.kill(-child.pid,forwarded);
  } catch(error) {if(error.code!=='ESRCH')throw error;}
});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
// Preserve failure; never retry a workload after it has started.
child.on('exit',(code,signal)=>{process.exitCode=code ?? (signal==='SIGINT'?130:143);});
