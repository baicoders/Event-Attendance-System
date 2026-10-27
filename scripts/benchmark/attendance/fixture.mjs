import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QRCode from 'react-qr-code';
import passwordUtils from '../../../globals/utils/password.ts';
const { hashPassword } = passwordUtils;
import { createDisposableDatabase } from '../../pg-test-db.mjs';
import { assertLocalMaintenanceUrl, buildTestEnv } from '../../attendance-e2e/safety.mjs';
import { cleanupAll } from '../../attendance-e2e/cleanup.mjs';
import { createClient } from './http.mjs';

export function sourceIdentity() {
  const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{encoding:'utf8'}).split('\0')
    .filter(path=>/^(app\/|features\/|globals\/|prisma\/|next.config.ts$|package.json$|pnpm-lock.yaml$)/.test(path)).sort();
  const hash=createHash('sha256');
  for(const path of paths) if(existsSync(path))hash.update(path).update('\0').update(readFileSync(path));
  return { commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().split('\n').filter(Boolean),
    sourceHash:hash.digest('hex'),node:process.version };
}

export async function availablePort(port=0) {
  const listener=createServer();
  await new Promise((ok,fail)=>{listener.once('error',fail);listener.listen(port,'127.0.0.1',ok);});
  const selected=listener.address().port;
  await new Promise(ok=>listener.close(ok));
  return selected;
}

function findCertificate(dir) {
  if(!existsSync(dir))return null;
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    const path=join(dir,entry.name);
    if(entry.isDirectory()) { const found=findCertificate(path);if(found)return found; }
    else if(path.endsWith('.crt'))return path;
  }
  return null;
}

export async function startFixture(options,artifacts) {
  assertLocalMaintenanceUrl(process.env.TEST_DATABASE_URL);
  // Refuse an occupied normal upstream before creating anything for phone mode.
  if(options.phones)await availablePort(3000);
  const children=[],logs=[];
  const scratch=mkdtempSync(join(tmpdir(),'attendance-load-'));
  let disposable,pool,db,cleanupPromise;
  let cancelled=false;
  const cleanup=()=>cleanupPromise ??= cleanupAll([
    ...children.slice().reverse().map(child=>async()=>{
      if(!child.pid || child.exitCode!==null || child.signalCode)return;
      try{process.kill(-child.pid,'SIGTERM');}catch{return;}
      await Promise.race([new Promise(ok=>child.once('exit',ok)),delay(1500)]);
      try{process.kill(-child.pid,'SIGKILL');}catch{ /* already stopped */ }
    }),
    async()=>db?.$disconnect(),async()=>pool?.end(),async()=>disposable?.cleanup(),
    async()=>{for(const log of logs)await new Promise(ok=>log.end(ok));},
    async()=>rmSync(scratch,{recursive:true,force:true}),
  ]);
  function start(command,args,env,label) {
    const log=createWriteStream(join(artifacts,`${label}.log`));logs.push(log);
    const child=spawn(command,args,{env,detached:true,stdio:['ignore','pipe','pipe']});children.push(child);
    child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
    child.on('error',error=>log.write(`${error.message}\n`));
    return child;
  }
  async function ready(check,child,label) {
    const until=Date.now()+90000;
    while(Date.now()<until) {
      if(cancelled)throw new Error('Fixture setup interrupted');
      if(child.exitCode!==null || child.signalCode)throw new Error(`${label} exited; inspect ${label}.log`);
      try{if(await check())return;}catch{ /* readiness only */ }
      await delay(250);
    }
    throw new Error(`${label} readiness timed out`);
  }
  const interrupt=()=>{
    cancelled=true;
    for(const child of children)if(child.pid && child.exitCode===null && !child.signalCode) {
      try{process.kill(-child.pid,'SIGTERM');}catch{ /* exited */ }
    }
  };
  process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  try {
    disposable=await createDisposableDatabase('test_attendance_load');
    const env=buildTestEnv(process.env,disposable.url,randomBytes(32).toString('hex'));
    pool=new Pool({connectionString:disposable.url,max:2});
    db=new PrismaClient({adapter:new PrismaPg(pool)});
    const password=randomBytes(18).toString('base64url');
    const hashed=await hashPassword(password);
    const accounts=[];
    for(let index=0;index<6;index++)accounts.push(await db.user.create({data:{name:index===5?'Rehearsal Admin':`Phone ${index+1}`,
      email:`${index===5?'admin':`phone${index+1}`}@rehearsal.example.test`,password:hashed,status:'ACTIVE',role:index===5?'ADMIN':'ORGANIZER'}}));
    const students=Array.from({length:options.roster},(_,index)=>({id:`c${String(index+1).padStart(24,'0')}`,
      usn:index%20===0?null:String(26000000001+index),lrn:index%40===0?null:String(126000000001+index),
      firstName:'Rehearsal',middleName:index%3===0?'Test':null,lastName:`Student${String(index+1).padStart(4,'0')}`,
      schoolLevel:index%5===0?'SHS':'COLLEGE',yearLevel:index%5===0?'GRADE_11':'YEAR_1'}));
    await db.student.createMany({data:students});
    // A bounded set of representative academic relations, including missing memberships.
    for(let section=0;section<15;section++)await db.group.create({data:{name:`Section ${section+1}`,slug:`rehearsal-section-${section+1}`,category:'SECTION',
      students:{connect:students.filter((_,index)=>index%16===section).map(({id})=>({id}))}}});
    for(const [category,name] of [['PROGRAM','Information Technology'],['HOUSE','Rehearsal House']])await db.group.create({data:{name,slug:`rehearsal-${category.toLowerCase()}`,category,
      students:{connect:students.filter(student=>student.schoolLevel==='COLLEGE').map(({id})=>({id}))}}});
    const identity=sourceIdentity();
    const dist=resolve('test-results','attendance-build',options.label);
    // Next cleans distDir before compiling; its input tsconfig must live outside it.
    const config=resolve('test-results','attendance-build',`config-${options.label}.json`);
    const buildMeta=join(dist,'source.json');
    mkdirSync(dist,{recursive:true});
    env.USWAG_TEST_DIST_DIR=relative(process.cwd(),dist);
    env.USWAG_TEST_TSCONFIG=relative(process.cwd(),config);
    if(options.skipBuild) {
      if(!existsSync(join(dist,'BUILD_ID')) || !existsSync(buildMeta) || JSON.parse(readFileSync(buildMeta,'utf8')).sourceHash!==identity.sourceHash)throw new Error('--skip-build requires a matching production build for this label and source hash');
    } else {
      writeFileSync(config,JSON.stringify({extends:'../../tsconfig.json',
        include:['../../next-env.d.ts','../../app/**/*.ts','../../app/**/*.tsx','../../features/**/*.ts','../../features/**/*.tsx','../../globals/**/*.ts','../../globals/**/*.tsx',`${options.label}/types/**/*.ts`],exclude:['../../node_modules']},null,2));
      console.log('Building isolated production app…');
      const child=start('pnpm',['build'],env,'build');
      const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM');}catch{ /* ended */ }},600000);
      const code=await new Promise((ok,fail)=>{child.once('error',fail);child.once('exit',ok);});clearTimeout(timer);
      if(code!==0 || cancelled)throw new Error('Production build failed or interrupted; inspect build.log');
      writeFileSync(buildMeta,JSON.stringify(identity,null,2));
    }
    const appPort=options.phones?3000:await availablePort();
    const app=start(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(appPort)],env,'app');
    await ready(async()=>(await fetch(`http://127.0.0.1:${appPort}/api/auth/session`,{signal:AbortSignal.timeout(3000)})).status<500,app,'app');
    let base,ca,pin,proxy;
    if(options.phones) {
      const host=readFileSync('Caddyfile','utf8').match(/^\s*([^#\s{}]+)\s*\{/m)?.[1];
      base=options.baseUrl ?? (host?new URL(host.includes('://')?host:`https://${host}`).origin:null);
      if(!base || !base.startsWith('https:'))throw new Error('Specify --base-url https://<laptop-LAN-IP>');
      // Node uses the existing CA only for this client. Never change global TLS settings.
      ca=process.env.ATTENDANCE_CADDY_CA?readFileSync(process.env.ATTENDANCE_CADDY_CA):undefined;
    } else {
      const tlsPort=await availablePort();
      base=`https://127.0.0.1:${tlsPort}`;
      const storage=join(scratch,'caddy');
      const caddyfile=join(scratch,'Caddyfile');
      writeFileSync(caddyfile,`{\n admin off\n skip_install_trust\n auto_https disable_redirects\n storage file_system ${storage}\n}\n${base} {\n bind 127.0.0.1\n tls internal\n reverse_proxy 127.0.0.1:${appPort}\n}\n`);
      proxy=start(process.env.E2E_CADDY || 'caddy',['run','--config',caddyfile,'--adapter','caddyfile'],{...env,XDG_CONFIG_HOME:join(scratch,'config'),XDG_DATA_HOME:join(scratch,'data')},'caddy');
      await ready(()=>findCertificate(join(storage,'certificates')),proxy,'caddy');
      ca=readFileSync(join(storage,'pki/authorities/local/root.crt'));
      const cert=new X509Certificate(readFileSync(findCertificate(join(storage,'certificates'))));
      pin=createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64');
    }
    const probe=createClient({base,ca});
    try {
      await ready(async()=>{await probe.call('/api/auth/session');return true;},app,'HTTPS');
      const session=await probe.call('/api/auth/login',{method:'POST',body:{email:accounts[5].email,password}});
      if(session.id!==accounts[5].id)throw new Error('HTTPS target is not the runner-owned rehearsal app');
    } finally {probe.close();}
    const newEvent=title=>db.event.create({data:{title:`Rehearsal ${title}`,category:'ALL',status:'APPROVED',createdById:accounts[0].id,
      start:new Date(Date.now()-3600000),end:new Date(Date.now()+86400000)}});
    return {db,students,accounts,password,base,ca,pin,identity,newEvent,buildId:readFileSync(join(dist,'BUILD_ID'),'utf8').trim(),appPid:app.pid,caddyPid:proxy?.pid,
      async browserParity() {
        const events={};
        for(const screen of ['operator','regular'])events[screen]=(await newEvent(`${screen} browser parity`)).id;
        const QR=QRCode.default ?? QRCode;
        const input=join(scratch,'browser.json');
        writeFileSync(input,JSON.stringify({base,pin,events,email:accounts[0].email,password,manual:students[1],
          qr:renderToStaticMarkup(React.createElement(QR,{value:students[0].id,size:320})),scratch,artifacts,
          chrome:process.env.E2E_CHROME || '/usr/bin/google-chrome'}),{mode:0o600});
        const browser=start(process.env.E2E_PYTHON || 'python3',['scripts/benchmark/attendance/traffic.py',input],env,'browser-traffic');
        const timer=setTimeout(()=>{try{process.kill(-browser.pid,'SIGTERM');}catch{ /* exited */ }},240000);
        const code=await new Promise((ok,fail)=>{browser.once('error',fail);browser.once('exit',ok);});clearTimeout(timer);
        if(code!==0)throw new Error('Browser request-parity check failed; inspect browser-traffic.log and traces');
        for(const eventId of Object.values(events)) {
          if(await db.record.count({where:{eventId}})!==2 || await db.attendanceChange.count({where:{eventId}})!==2)throw new Error('Browser traffic writes did not reconcile with PostgreSQL');
        }
      },
      cleanup:async()=>{process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);await cleanup();},
      writePhoneCards() {
        const QR=QRCode.default ?? QRCode;
        const cards=students.slice(0,100).map(student=>`<article>${renderToStaticMarkup(React.createElement(QR,{value:student.usn ?? student.lrn ?? student.id,size:160}))}<p>${student.lastName}</p><small>${student.usn ?? student.lrn ?? student.id}</small></article>`).join('');
        writeFileSync(join(artifacts,'qr-cards.html'),`<!doctype html><html><meta charset="utf-8"><title>Synthetic rehearsal cards</title><style>body{font-family:sans-serif;display:flex;flex-wrap:wrap}article{break-inside:avoid;text-align:center;width:200px;padding:12px;border:1px solid #ccc}small{font-size:10px}</style>${cards}</html>`);
      },
    };
  } catch(error) {
    process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
    try{await cleanup();}catch(cleanupError){
      const failure=new AggregateError([error,cleanupError],`Fixture failed and cleanup also failed: ${cleanupError.message}`);
      failure.cleanupFailed=true;
      throw failure;
    }
    throw error;
  }
}
