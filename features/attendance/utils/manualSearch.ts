import type { Student } from "@/globals/types/students";

export type ManualEntry = {
  student: Student;
  displayName: string;
  name: string;
  alternateName: string;
  words: string[];
  sortKey: string[];
};

const normalizeName = (value: string) => value.normalize("NFC").toLocaleLowerCase("en")
  .replace(/[,\-\s]+/gu, " ").trim();

export function indexManualRoster(students: Student[]): ManualEntry[] {
  const seen = new Set<string>();
  return students.flatMap((student) => {
    if (seen.has(student.id)) return [];
    seen.add(student.id);
    const parts = [student.firstName, student.middleName, student.lastName].filter(Boolean) as string[];
    const displayName = parts.join(" ");
    const name = normalizeName(displayName);
    const alternateName = normalizeName([student.lastName, student.firstName, student.middleName].filter(Boolean).join(" "));
    return [{ student, displayName, name, alternateName, words: name.split(" "),
      sortKey: [student.lastName, student.firstName, student.middleName ?? "", student.id].map(normalizeName) }];
  });
}

function compareString(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function searchManualRoster(index: ManualEntry[], input: string): ManualEntry[] {
  const raw = input.trim();
  if (!raw) return [];
  const nameQuery = normalizeName(raw);
  const tokens = nameQuery.split(" ").filter(Boolean);
  return index.map((entry) => {
    const id = entry.student.id;
    let tier = 0;
    let strength = 0;
    if (id === raw) tier = 1;
    else if (id.startsWith(raw)) tier = 2;
    else if (id.includes(raw)) tier = 3;
    else if (entry.name === nameQuery || entry.alternateName === nameQuery) tier = 4;
    else if (tokens.every((token) => entry.words.some((word) => word.startsWith(token)))) {
      tier = 5;
      strength = tokens.filter((token) => entry.words.includes(token)).length;
    } else if (tokens.every((token) => entry.name.includes(token))) tier = 6;
    return { entry, tier, strength };
  }).filter(({ tier }) => tier > 0)
    .sort((a, b) => a.tier - b.tier || b.strength - a.strength ||
      a.entry.sortKey.reduce((order, part, i) => order || compareString(part, b.entry.sortKey[i]), 0) ||
      compareString(a.entry.student.id, b.entry.student.id))
    .map(({ entry }) => entry);
}
