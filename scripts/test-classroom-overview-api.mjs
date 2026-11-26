import assert from 'node:assert/strict';
import { withClassroomTestApp } from './classroom-test-app.mjs';
await withClassroomTestApp(async({db,request})=>{
 const createActor=async(id,{role='MEMBER',membership='APPROVED'}={})=>{
  await db.user.create({data:{id,name:id,email:id+'@example.test',password:'test-password',role,status:role==='ADMIN'?'ACTIVE':'PENDING'}});
  if(membership)await db.classroomMembership.create({data:{userId:id,status:membership,departmentOrDesignation:'Teacher'}});
  const login=await request('/api/auth/login',{method:'POST',body:{email:id+'@example.test',password:'test-password',workspace:'CLASS'}});assert.equal(login.response.status,200,login.text);return login.cookie;
 };
 const teacher=await createActor('overview-api-teacher'),other=await createActor('overview-api-other'),admin=await createActor('overview-api-admin',{role:'ADMIN',membership:null}),pending=await createActor('overview-api-pending',{membership:'PENDING'});
 await db.user.create({data:{id:'overview-api-organizer',name:'Organizer',email:'overview-organizer@example.test',password:'test-password',role:'ORGANIZER',status:'ACTIVE'}});
 const organizer=(await request('/api/auth/login',{method:'POST',body:{email:'overview-organizer@example.test',password:'test-password'}})).cookie;
 const read=async(cookie,path='/api/classroom/overview')=>{const result=await request(path,{cookie});assert.equal(result.response.headers.get('cache-control'),'private, no-store');return result;};
 for(const [cookie,status] of [[undefined,401],[pending,403],[organizer,403]])assert.equal((await read(cookie)).response.status,status);
 await db.academicTerm.create({data:{id:'overview-api-term',name:'API Term',normalizedKey:'api-term',startDate:new Date('2026-01-01'),endDate:new Date('2027-12-31'),createdById:'overview-api-teacher'}});
 await db.subject.create({data:{id:'overview-api-subject',title:'API Subject',normalizedTitle:'api subject',createdById:'overview-api-teacher'}});
 await db.classOffering.createMany({data:[{id:'overview-api-own',displayName:'Private own class',primaryTeacherId:'overview-api-teacher',termId:'overview-api-term',subjectId:'overview-api-subject'},{id:'overview-api-other-class',displayName:'Other private class',primaryTeacherId:'overview-api-other',termId:'overview-api-term',subjectId:'overview-api-subject'}]});
 const own=await read(teacher);assert.equal(own.response.status,200,own.text);assert.equal(own.json.data.stats.classCount,1);assert.deepEqual(own.json.data.recentClasses.items.map(item=>item.id),['overview-api-own']);assert.ok(!own.text.includes('Other private class'));
 assert.equal((await read(admin)).json.data.stats.classCount,2);
 assert.equal((await read(other)).json.data.stats.classCount,1);
 const invalid=await read(teacher,'/api/classroom/overview?teacherId=overview-api-other');assert.equal(invalid.response.status,400,invalid.text);
 await db.classOffering.update({where:{id:'overview-api-own'},data:{primaryTeacherId:'overview-api-other'}});
 assert.equal((await read(teacher)).json.data.stats.classCount,0);assert.equal((await read(other)).json.data.stats.classCount,2);
 await db.classroomMembership.update({where:{userId:'overview-api-other'},data:{status:'SUSPENDED'}});assert.equal((await read(other)).response.status,403);
 await db.user.update({where:{id:'overview-api-teacher'},data:{accountState:'DISABLED'}});assert.equal((await read(teacher)).response.status,403);
 console.log('PASS Classroom overview API ownership, admin scope, admission, strict query, transfer, revocation and private no-store responses.');
});
