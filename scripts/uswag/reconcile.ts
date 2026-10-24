import { isLocalPostgresUrl, isPostgresUrl } from "../../globals/libs/dbConfig";

export type Participant = {row: number; group: string; name: string; position: string | null};
export type Student = {id: string; firstName: string; middleName: string | null; lastName: string};
export type Membership = {studentId: string; groupId: string; groupName: string; position: string | null};
export type Group = {id: string; name: string; slug: string; category: string};
export type ReconciliationDetail = Participant & {
  match: string;
  studentId?: string;
  candidates: Student[];
  outcome: string;
  action?: "create" | "set-position";
  membership?: Membership;
  reason?: string;
};
export const EXPECTED = {"SSC Officers": 13, "SSLG Officers": 27, "CS Officers": 14, "BA Officers": 11, "YHS Officers": 13, "CCJ Officers": 12, "House Lords/Ladies": 5};

// Keep accents and all letters. Periods are formatting, never edit distance.
export function normalizeName(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("en").replace(/\./g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
export function customGroupSlug(name: string): string {
  return `custom-${normalizeName(name).replace(/ /g, "-")}`;
}
function orderedName(name: string): string {
  const parts = name.split(",");
  return normalizeName(parts.length === 2 ? `${parts[1]} ${parts[0]}` : name);
}
export function matchParticipant(name: string, students: Student[]) {
  const normalized = orderedName(name);
  const matches = students.filter(student => {
    const first = normalizeName(student.firstName);
    const last = normalizeName(student.lastName);
    const middle = normalizeName(student.middleName ?? "");
    const full = [first, middle, last].filter(Boolean).join(" ");
    if (normalized === full) return true;
    // Whole stored first/last components are required, including compound names.
    if (normalized === `${first} ${last}`) return true;
    if (!middle || !normalized.startsWith(`${first} `) || !normalized.endsWith(` ${last}`)) return false;
    const suppliedMiddle = normalized.slice(first.length + 1, -(last.length + 1));
    const supplied = suppliedMiddle.split(" ");
    const stored = middle.split(" ");
    return supplied.length === stored.length && supplied.every((part, i) => part === stored[i] || (part.length === 1 && stored[i].startsWith(part)) || (stored[i].length === 1 && part.startsWith(stored[i])));
  });
  return {status: matches.length === 1 ? "matched" : matches.length ? "ambiguous" : "missing", student: matches.length === 1 ? matches[0] : undefined, candidates: matches};
}
export function validateLocalDatabaseUrl(value: string) {
  return validateDatabaseUrl(value);
}
export function validateDatabaseUrl(value: string, allowRemote = false) {
  if (!value || !isPostgresUrl(value) || (!allowRemote && !isLocalPostgresUrl(value))) throw new Error("--database-url must be an explicit LOCAL PostgreSQL URL; environment defaults are never used.");
  const parsed = new URL(value);
  // pg supports query options overriding the path/host; reject all connection overrides.
  for (const key of parsed.searchParams.keys()) {
    if (!['sslmode', 'connect_timeout', 'application_name'].includes(key)) throw new Error(`Unsupported database URL option: ${key}`);
  }
  if (!isLocalPostgresUrl(value) && parsed.searchParams.getAll("sslmode").some(mode => !["require", "verify-ca", "verify-full"].includes(mode))) throw new Error("Remote PostgreSQL requires verified TLS.");
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (!database || database.includes("/")) throw new Error("An explicit database name is required.");
  return {database, host: parsed.hostname, port: Number(parsed.port || "5432")};
}

export function reconcile(participants: Participant[], students: Student[], memberships: Membership[], groups: Group[]) {
  const matches = participants.map(participant => ({participant, match: matchParticipant(participant.name, students)}));
  const occurrences = new Map<string, number>();
  for (const {match} of matches) if (match.student) occurrences.set(match.student.id, (occurrences.get(match.student.id) ?? 0) + 1);
  const groupPlans = Object.keys(EXPECTED).map(name => {
    const slug = customGroupSlug(name);
    const candidates = groups.filter(group => group.slug === slug || (group.category === "CUSTOM" && normalizeName(group.name) === normalizeName(name)));
    const existing = candidates[0];
    const conflict = candidates.length > 1 || (existing && (existing.category !== "CUSTOM" || normalizeName(existing.name) !== normalizeName(name)));
    return {name, slug, id: existing?.id, action: conflict ? "conflict" : existing ? "reuse" : "create"};
  });
  const details: ReconciliationDetail[] = matches.map(({participant, match}) => {
    const common = {...participant, match: match.status, studentId: match.student?.id, candidates: match.candidates};
    if (!match.student) return {...common, outcome: match.status};
    if ((occurrences.get(match.student.id) ?? 0) > 1) return {...common, outcome: "conflict", reason: "Student occurs more than once in the workbook; review every occurrence."};
    const group = groupPlans.find(group => group.name === participant.group);
    if (!group || group.action === "conflict") return {...common, outcome: "conflict", reason: "Existing group name/slug conflicts with the workbook group."};
    const membership = memberships.find(member => member.studentId === match.student!.id);
    if (!membership) return {...common, outcome: "assignment", action: "create"};
    if (membership.groupId !== group.id) return {...common, outcome: "conflict", reason: `Already belongs to ${membership.groupName}.`, membership};
    if ((membership.position ?? "") === (participant.position ?? "")) return {...common, outcome: "already-assigned", membership};
    if (!membership.position && participant.position) return {...common, outcome: "assignment", action: "set-position", membership};
    return {...common, outcome: "conflict", reason: "Existing position differs; preserve the current assignment for manual review.", membership};
  });
  return {
    counts: {expectedParticipants: participants.length, matchedParticipants: matches.filter(({match}) => match.status === "matched").length, missingParticipants: details.filter(d => d.outcome === "missing").length, ambiguousMatches: details.filter(d => d.outcome === "ambiguous").length, alreadyAssignedMembers: details.filter(d => d.outcome === "already-assigned").length, membershipConflicts: details.filter(d => d.outcome === "conflict").length, plannedAssignments: details.filter(d => d.outcome === "assignment").length, successfullyAppliedAssignments: 0},
    groups: groupPlans,
    assignments: details.filter(d => d.outcome === "assignment"),
    details,
  };
}
