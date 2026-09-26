export type AudienceRosterStudent = {
  id: string;
  firstName: string;
  lastName: string;
  schoolLevel: "COLLEGE" | "SHS";
  yearLevel: string;
  section: string | null;
};

export type AudiencePreview = {
  scopeSignature: string;
  evaluatedAt: string;
  totalEligible: number;
  searchMatches: number;
  page: number;
  pageSize: number;
  students: AudienceRosterStudent[];
  limitation?: string;
};
