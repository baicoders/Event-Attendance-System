/** Regression for generated canonical IDs across roster maintenance and event searches.
 * Optional BROWSER=1 verifies header placement and decodes switched/printed QR codes.
 * All records live in a migrated disposable test database. Run after build. */
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {Pool} from 'pg';
import {createDisposableDatabase} from './pg-test-db.mjs';
const fixture=await createDisposableDatabase('test_identifier_surroundings');
const pool=new Pool({connectionString:fixture.url});
const db=new PrismaClient({adapter:new PrismaPg(pool)});
const secret='synthetic-identifier-regression-secret';
const port=await new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value));});});
const base=`http://127.0.0.1:${port}`;
let server, chrome, ws, adminCookie;
const scratch=mkdtempSync(join(tmpdir(),"student-qr-identifiers-"));
const origin=base;
async function openBrowser() {
  const profile = join(scratch, 'chrome');
  chrome = spawn('/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', detached: true });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await delay(100);
  assert.ok(existsSync(portFile), 'Chrome started');
  const chromePort = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
  const target = await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const pending = new Map();
  let nextId = 0;
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Browser timeout: ${expression}; body=${await evaluate('document.body.innerText.slice(0,1800)')}`);
  };
  const click = async label => {
    const expression = `[...(document.querySelector('[role="dialog"]')||document).querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
    await until(`Boolean(${expression})`);
    await evaluate(`${expression}.click()`);
  };
  const fill = async (selector, value) => {
    await until(`Boolean(${selector})`);
    await evaluate(`(()=>{const el=${selector};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  };
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Network.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const split = adminCookie.indexOf('=');
  await command('Network.setCookie', { name: adminCookie.slice(0, split), value: adminCookie.slice(split + 1), url: origin });
  return { command, evaluate, until, click, fill };
}

try {
 const actor=await db.user.create({data:{name:'Synthetic Admin',email:'identifier-regression@example.test',password:'fixture',role:'ADMIN',status:'ACTIVE'}});
 const session={id:actor.id,name:actor.name,email:actor.email,role:actor.role,status:actor.status,credentialVersion:0,mustChangePassword:false};
 const encoded=Buffer.from(JSON.stringify({session,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
 const cookie=`event-attendance-auth=${encoded}.${createHmac('sha256',secret).update(encoded).digest('base64url')}`;
 adminCookie=cookie;
 server=spawn('pnpm',['start','-p',String(port)],{env:{...process.env,DATABASE_URL:fixture.url,DIRECT_URL:fixture.url,AUTH_SECRET:secret,NODE_ENV:'production'},stdio:'ignore',detached:true});
 let ready=false;
 for(let i=0;i<120;i++){if(server.exitCode!==null)throw new Error(`Fixture server exited ${server.exitCode}`);try{if((await fetch(`${base}/api/auth/session`)).status<500){ready=true;break;}}catch{}await delay(250);}
 assert.ok(ready,'isolated server ready');
 const api=async(path,body)=>{
  const response=await fetch(`${base}${path}`,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();assert.ok(response.ok,`${path}: ${response.status} ${JSON.stringify(result)}`);assert.equal(result.success,true);return result.data;
 };
 const house=await db.group.create({data:{name:'Synthetic House',slug:'synthetic-house',category:'HOUSE'}});
 const person=await api('/api/students',{usn:'00000123456',lrn:'000000123456',firstName:'Synthetic',lastName:'Student'});
 assert.equal(person.id.length,25);assert.notEqual(person.id,person.usn);
 const preview=await api('/api/students/bulk/preview',{studentIds:[person.id],action:'SET_HOUSE',targetGroupId:house.id});
 assert.equal(preview.changedCount,1);assert.ok(preview.previewToken);
 const committed=await api('/api/students/bulk/commit',{previewToken:preview.previewToken,acknowledgeReportImpact:true});
 assert.deepEqual(committed.changedIds,[person.id]);
 const exported=await api('/api/students/export-selected',{studentIds:[person.id]});
 assert.equal(exported.schemaVersion,2);assert.equal(exported.rows[0].studentId,person.id);assert.equal(exported.rows[0].usn,person.usn);assert.equal(exported.rows[0].lrn,person.lrn);
 const event=await db.event.create({data:{title:'Synthetic Event',category:'ALL',status:'APPROVED',createdById:actor.id,start:new Date(Date.now()-60000),end:new Date(Date.now()+3600000)}});
 await api('/api/records',{eventId:event.id,studentId:person.lrn,method:'MANUAL',expectedMode:'TIME_IN'});
 for(const search of [person.usn,person.lrn,'123456']) {
  const audience=await api('/api/events/audience-preview',{category:'ALL',includedGroups:[],search,includeRoster:true});
  assert.equal(audience.searchMatches,1);assert.equal(audience.students[0].id,person.id);
  const progress=await api(`/api/events/${event.id}/progress?${new URLSearchParams({includeRows:'1',status:'ALL',q:search})}`);
  assert.equal(progress.detail.matchedCount,1);assert.equal(progress.detail.rows[0].studentId,person.id);
  const review=await api(`/api/events/${event.id}/attendance-review?${new URLSearchParams({search})}`);
  assert.equal(review.total,1);assert.equal(review.items[0].studentId,person.id);
 }
 const missingYear=await api(`/api/events/${event.id}/progress?groupBy=YEAR&includeRows=1&bucket=none&status=ALL`);
 assert.equal(missingYear.detail.rows[0].studentId,person.id);
 assert.equal(await db.record.count({where:{studentId:person.id}}),1);
 // Both external lookup codes and old internal QR payloads resolve to one record.
 for(const code of [person.usn,person.lrn,person.id]) {
  const found=await api(`/api/students?${new URLSearchParams({eventId:event.id,studentId:code})}`);
  assert.equal(found.id,person.id);
  const record=await api('/api/records',{eventId:event.id,studentId:code,method:'SCANNED',expectedMode:'TIME_IN'});
  assert.equal(record.studentId,person.id);
 }
 assert.equal(await db.record.count({where:{studentId:person.id}}),1);
 if(process.env.BROWSER==='1') {
  const scannerRequire=createRequire(import.meta.resolve('@yudiel/react-qr-scanner'));
  const barcodeRequire=createRequire(scannerRequire.resolve('barcode-detector'));
  const {prepareZXingModule,readBarcodes}=barcodeRequire('zxing-wasm/reader');
  const wasm=readFileSync(barcodeRequire.resolve('zxing-wasm/reader/zxing_reader.wasm'));
  prepareZXingModule({overrides:{wasmBinary:wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength)}});
  const sharp=createRequire(import.meta.resolve('next'))('sharp');
  const decode=async(svg)=>{
   const png=await sharp(Buffer.from(svg)).resize(320,320,{kernel:'nearest'}).extend({top:40,bottom:40,left:40,right:40,background:'#ffffff'}).png().toBuffer();
   const result=await readBarcodes(png,{formats:['QRCode'],maxNumberOfSymbols:1});assert.equal(result.length,1);return result[0].text;
  };
  const usnOnly=await api('/api/students',{usn:'00000123458',firstName:'USN',lastName:'Only'});
  const lrnOnly=await api('/api/students',{lrn:'000000123459',firstName:'LRN',lastName:'Only'});
  await db.group.createMany({data:[
   ['abm','ABM'],['assh','ASSH'],['stem','STEM'],['animation','Animation'],['css','Computer System Servicing'],['he','Home Economics'],['programming','Programming'],['new-strand','New strand'],
  ].map(([slug,name])=>({slug,name,category:'STRAND'}))});
  const {command,evaluate,until,click}=await openBrowser();
  const choose=async(expression,value)=>{await evaluate(`(()=>{const el=${expression};el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
  await command('Page.navigate',{url:`${base}/students`});
  await until(`Boolean(document.querySelector('a[href="/students/import"]'))`);
  assert.equal(await evaluate(`document.querySelector('a[href*="/students/qr-codes"]').textContent.trim()`),'Manage');
  assert.equal(await evaluate(`Boolean(document.querySelector('a[href="/students/issues"]').closest("header"))`),true);
  assert.equal(await evaluate(`Boolean(document.querySelector('a[href="/students/import"]').closest("header"))`),true);
  await command('Emulation.setDeviceMetricsOverride',{width:375,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'),true);
  writeFileSync('/tmp/student-directory-actions-mobile.png',Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  writeFileSync('/tmp/student-directory-actions-desktop.png',Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await command('Page.navigate',{url:`${base}/students/select-category?category=SHS`});
  await until(`document.querySelectorAll('a[href*="strand="]').length === 8`);
  assert.equal(await evaluate('document.querySelector("h1").textContent'),'Senior High School');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("h2")].map(el=>el.textContent)'),['Academic track','Technical-vocational track','Other strands']);
  assert.equal(await evaluate(`[...document.querySelectorAll('a[href*="strand="]')].every(el=>new URL(el.href).searchParams.get('category')==='SHS')`),true);
  assert.equal(await evaluate(`new Set([...document.querySelectorAll('a[href*="strand="]')].map(el=>Math.round(el.getBoundingClientRect().height))).size`),1);
  writeFileSync('/tmp/shs-strand-selection-desktop.png',Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await command('Emulation.setDeviceMetricsOverride',{width:375,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'),true);
  writeFileSync('/tmp/shs-strand-selection-mobile.png',Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('a[href*="strand=css"]').click()`);
  await until('location.pathname==="/students/student-list" && new URL(location.href).searchParams.get("strand")==="css"');
  await command('Page.navigate',{url:`${base}/students/qr-codes?category=ALL&source=directory`});
  const preview='[...document.querySelectorAll(".no-print .student-qr-card")].find(el=>el.textContent.includes("Synthetic Student"))';
  const printed='[...document.querySelectorAll(".student-qr-print-area .student-qr-card")].find(el=>el.textContent.includes("Synthetic Student"))';
  const preference='[...document.querySelectorAll("label")].find(el=>el.textContent.includes("Preferred QR identifier")).querySelector("select")';
  await until(`Boolean(${preview})`);
  assert.equal(await decode(await evaluate(`${preview}.querySelector("svg").outerHTML`)),person.usn);
  await choose(preference,'LRN');
  await until(`${preview}.textContent.includes("LRN: ${person.lrn}")`);
  const decodedLRN=await decode(await evaluate(`${preview}.querySelector("svg").outerHTML`));assert.equal(decodedLRN,person.lrn);
  assert.equal(await decode(await evaluate(`${printed}.querySelector("svg").outerHTML`)),person.lrn);
  assert.equal(await evaluate(`document.querySelector(".no-print").innerText.includes("USN: ${usnOnly.usn}")`),true);
  assert.equal(await evaluate(`document.querySelector(".no-print").innerText.includes("LRN: ${lrnOnly.lrn}")`),true);
  await evaluate(`${preview}.closest("button").click()`);
  await until(`document.querySelector('[role="dialog"] select')?.value === "LRN"`);
  await choose(`document.querySelector('[role="dialog"] select')`,'USN');
  await until(`document.querySelector('[role="dialog"]').textContent.includes("USN: ${person.usn}")`);
  const decodedUSN=await decode(await evaluate(`document.querySelector('[role="dialog"] svg').outerHTML`));assert.equal(decodedUSN,person.usn);
  for(const code of [decodedUSN,decodedLRN]) assert.equal((await api('/api/records',{eventId:event.id,studentId:code,method:'SCANNED',expectedMode:'TIME_IN'})).studentId,person.id);
  assert.equal(await db.record.count({where:{studentId:person.id}}),1);
  await command('Page.navigate',{url:`${base}/students/${person.id}`});
  await until(`Boolean(document.querySelector('[aria-label="Student QR"] select'))`);
  await choose(`document.querySelector('[aria-label="Student QR"] select')`,'LRN');
  await until(`document.querySelector('[aria-label="Student QR"]').textContent.includes("LRN: ${person.lrn}")`);
  await click('View larger QR');
  await until(`document.querySelector('[role="dialog"] select')?.value === "LRN"`);
  assert.equal(await decode(await evaluate(`document.querySelector('[role="dialog"] svg').outerHTML`)),person.lrn);
  const organizer=await db.user.create({data:{name:'Synthetic Organizer',email:'qr-organizer@example.test',password:'fixture',role:'ORGANIZER',status:'ACTIVE'}});
  const orgBody=Buffer.from(JSON.stringify({session:{...session,id:organizer.id,name:organizer.name,email:organizer.email,role:'ORGANIZER'},exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  await command('Network.setCookie',{name:'event-attendance-auth',value:`${orgBody}.${createHmac('sha256',secret).update(orgBody).digest('base64url')}`,url:base});
  await command('Page.navigate',{url:`${base}/students`});await until(`Boolean(document.querySelector('a[href*="/students/qr-codes"]'))`);
  await until(`Boolean(document.querySelector('button[aria-label="Account menu for Synthetic Organizer"]'))`);
  assert.equal(await evaluate(`Boolean(document.querySelector('a[href="/students/import"]'))`),false);
  assert.equal(await evaluate(`Boolean(document.querySelector('a[href="/students/issues"]'))`),false);
  console.log('Browser/decoder passed: header actions, mobile fit, USN/LRN preview, modal/profile switches, printed QR decoding, fallback identifiers, role visibility and one canonical attendance record.');
 }
 console.log('Identifier surroundings API passed: generated-ID bulk preview/commit, separate USN/LRN export, audience/progress/review searches, missing-year bucket and canonical attendance.');
} finally {
 ws?.close();
 if(chrome?.pid){try{process.kill(-chrome.pid,'SIGTERM');}catch{}}
 if(server?.pid){try{process.kill(-server.pid,'SIGTERM');}catch{}}
 await db.$disconnect();await pool.end();await fixture.cleanup();
 rmSync(scratch,{recursive:true,force:true});
}
