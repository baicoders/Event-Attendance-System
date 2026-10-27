import { Agent, request } from 'node:https';

export class RequestFailure extends Error {
  constructor(message, status=0, code='TRANSPORT_ERROR') { super(message); this.status=status; this.code=code; }
}

/** One browser-like cookie jar and bounded connection pool per operator. No request retries. */
export function createClient({ base, ca, onMetric=()=>{} }) {
  if (new URL(base).protocol!=='https:') throw new Error('HTTPS required');
  const agent=new Agent({ca,keepAlive:true,maxSockets:4,rejectUnauthorized:true});
  const cookies=new Map(), pending=new Map();
  function send(path,{method='GET',body,discardResponse=false,expected=false,tag=''}={}) {
    const started=performance.now();
    return new Promise((resolve,reject)=>{
      let status=0,bytes=0,settled=false;
      const finish=(error,data)=>{
        if(settled)return;
        settled=true;
        clearTimeout(timer);
        onMetric({at:new Date().toISOString(),path,method,status,bytes,ms:performance.now()-started,
          outcome:error?.code ?? 'OK',expected,tag});
        if(error)reject(error); else resolve(data);
      };
      const payload=body===undefined?undefined:JSON.stringify(body);
      const req=request(new URL(path,base),{agent,method,headers:{
        ...(cookies.size?{cookie:[...cookies].map(([key,value])=>`${key}=${value}`).join('; ')}:{}),
        ...(payload?{'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{}),
      }},res=>{
        status=res.statusCode;
        for(const cookie of res.headers['set-cookie'] ?? []) {
          const pair=cookie.split(';')[0], split=pair.indexOf('=');
          cookies.set(pair.slice(0,split),pair.slice(split+1));
        }
        const chunks=[];
        res.on('data',chunk=>{
          bytes+=chunk.length;
          if(bytes>16*1024*1024)req.destroy(new Error('Response exceeds 16 MiB'));
          else chunks.push(chunk);
        });
        res.on('aborted',()=>finish(new RequestFailure('Response interrupted',status,'RESULT_UNKNOWN')));
        res.on('error',error=>finish(new RequestFailure(error.message,status,'RESULT_UNKNOWN')));
        res.on('end',()=>{
          if(discardResponse) { finish(new RequestFailure('Injected loss of committed response',status,'RESULT_UNKNOWN')); return; }
          try {
            const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if(status>=400 || result.success!==true) throw new RequestFailure(result.message ?? 'Request rejected',status,result.code ?? 'HTTP_ERROR');
            finish(null,result.data);
          } catch(error) { finish(error instanceof RequestFailure?error:new RequestFailure('Invalid JSON response',status,'INVALID_RESPONSE')); }
        });
      });
      const timer=setTimeout(()=>req.destroy(new Error('Request exceeded 15 seconds')),15000);
      req.on('error',error=>finish(new RequestFailure(error.message,status,method==='GET'?'READ_FAILED':'RESULT_UNKNOWN')));
      req.end(payload);
    });
  }
  return {
    call(path,options={}) {
      if(options.method && options.method!=='GET')return send(path,options);
      if(!pending.has(path)) {
        const promise=send(path,options).finally(()=>pending.delete(path));
        pending.set(path,promise);
      }
      return pending.get(path);
    },
    isPending(path) { return pending.has(path); },
    close() { agent.destroy(); },
  };
}
