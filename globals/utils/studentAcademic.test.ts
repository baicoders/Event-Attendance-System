import assert from 'node:assert/strict';
import test from 'node:test';
import {yearAfterSchoolLevelChange} from './studentAcademic';
test('clearing school level preserves a confirmed year instead of clearing unrelated data',()=>{
 assert.equal(yearAfterSchoolLevelChange('YEAR_2',null),'YEAR_2');
 assert.equal(yearAfterSchoolLevelChange('GRADE_11',undefined),'GRADE_11');
});
test('setting school level keeps compatible years and clears only incompatible years',()=>{
 assert.equal(yearAfterSchoolLevelChange('YEAR_2','COLLEGE'),'YEAR_2');
 assert.equal(yearAfterSchoolLevelChange('YEAR_2','SHS'),null);
 assert.equal(yearAfterSchoolLevelChange('GRADE_12','SHS'),'GRADE_12');
 assert.equal(yearAfterSchoolLevelChange(null,'COLLEGE'),null);
});
