import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verificationContentHash } from './verificationContent';
const profile={id:'stable',usn:'00000123456',lrn:null,firstName:'Student',lastName:'Name',middleName:null,schoolLevel:null,yearLevel:null,groups:[{id:'section',slug:'3a',category:'SECTION',name:'BSIT 3A'},{id:'house',slug:'red',category:'HOUSE',name:'Red'}]};
test('verification hash excludes timestamps, house/custom membership and cosmetic labels',()=>{
 const hash=verificationContentHash(profile);
 assert.equal(verificationContentHash({...profile,groups:[{...profile.groups[0],name:'Renamed'}, {id:'other',slug:'blue',name:'Blue',category:'HOUSE'}]}),hash);
 assert.notEqual(verificationContentHash({...profile,firstName:'Corrected'}),hash);
 assert.notEqual(verificationContentHash({...profile,groups:[{...profile.groups[0],slug:'3b'}]}),hash);
});
