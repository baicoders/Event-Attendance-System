import test from 'node:test';
import assert from 'node:assert/strict';
import { studentRecordSchema } from './studentRecord';
const name = {firstName:'Synthetic',lastName:'Student'};
test('minimal USN, LRN and both identifiers are accepted without academics', () => {
  for (const identifiers of [{usn:'00000123456'}, {lrn:'000000123456'}, {usn:'ABC00123456',lrn:'000000123456'}]) {
    assert.equal(studentRecordSchema.safeParse({...name,...identifiers}).success,true);
  }
});
test('names and at least one real identifier are required', () => {
  for (const data of [name,{...name,usn:' ',lrn:null},{usn:'00000123456'},{...name,usn:'123'},{...name,lrn:'ABCDEFGHIJKL'}]) {
    assert.equal(studentRecordSchema.safeParse(data).success,false);
  }
});
test('identifiers preserve leading zeros and are never padded or truncated', () => {
  assert.equal(studentRecordSchema.parse({...name,usn:' 00000123456 '}).usn,'00000123456');
  assert.equal(studentRecordSchema.safeParse({...name,lrn:'12345678901'}).success,false);
});
test('known academic constraints remain enforced without requiring missing fields', () => {
  assert.equal(studentRecordSchema.safeParse({...name,usn:'00000123456',schoolLevel:'SHS'}).success,true);
  for (const data of [{schoolLevel:'SHS',yearLevel:'YEAR_1'}, {schoolLevel:'COLLEGE',strand:'stem'}, {schoolLevel:'SHS',program:'bsit'}]) {
    assert.equal(studentRecordSchema.safeParse({...name,usn:'00000123456',...data}).success,false);
  }
});
