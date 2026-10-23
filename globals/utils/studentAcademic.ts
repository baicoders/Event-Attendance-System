import type {SchoolLevel,YearLevel} from '@prisma/client';
/** An unknown school level does not invalidate a confirmed year. */
export function yearAfterSchoolLevelChange(year:YearLevel|null|undefined,level:SchoolLevel|null|undefined):YearLevel|null {
 if(!year)return null;
 if(!level)return year;
 return year.startsWith(level==='SHS'?'GRADE_':'YEAR_')?year:null;
}
