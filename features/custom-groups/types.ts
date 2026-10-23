export type CustomGroup = {
  id: string;
  name: string;
  slug: string;
  category: "CUSTOM";
  memberCount: number;
};

export type GroupStudent = {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  usn: string | null;
  lrn: string | null;
};

export type CustomGroupMember = {
  groupId: string;
  studentId: string;
  position: string | null;
  student: GroupStudent;
};

export type CustomGroupDetail = CustomGroup & {
  members: CustomGroupMember[];
};

export type StudentSearchResult = GroupStudent & {
  customGroupId: string | null;
  customGroupName: string | null;
};

export const studentName = (student: GroupStudent) =>
  [student.lastName + ",", student.firstName, student.middleName]
    .filter(Boolean)
    .join(" ");
