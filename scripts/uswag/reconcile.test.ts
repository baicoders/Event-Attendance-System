import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { normalizeName, matchParticipant, reconcile, validateDatabaseUrl, validateLocalDatabaseUrl } from "./reconcile";

const student = (id: string, firstName: string, middleName: string | null, lastName: string) => ({id, firstName, middleName, lastName});
const participant = (name: string, group = "SSC Officers", row = 1) => ({name, group, row, position: "President"});

test("normalization tolerates case, spacing and periods, retains meaningful Unicode letters", () => {
  assert.equal(normalizeName("  Ana   M.  PEÑA "), "ana m peña");
  assert.notEqual(normalizeName("Peña"), normalizeName("Pena"));
});
test("matches full names, comma order, absent middle names and matching middle initials", () => {
  const students = [student("s1", "Ana Maria", "Reyes", "Dela Cruz")];
  for (const name of ["Ana Maria Reyes Dela Cruz", "Dela Cruz, Ana Maria R.", "Ana Maria Dela Cruz"]) {
    assert.equal(matchParticipant(name, students).student?.id, "s1");
  }
  assert.equal(matchParticipant("Ana Maria P Dela Cruz", students).status, "missing");
  assert.equal(matchParticipant("Ana Marie Dela Cruz", students).status, "missing");
});
test("does not resolve omitted-middle collisions or duplicate full names", () => {
  const students = [student("a", "Ana", "Reyes", "Cruz"), student("b", "Ana", "Ramos", "Cruz")];
  assert.equal(matchParticipant("Ana Cruz", students).status, "ambiguous");
  assert.equal(matchParticipant("Ana R Cruz", students).status, "ambiguous");
  assert.equal(matchParticipant("Ana Reyes Cruz", students).student?.id, "a");
  assert.equal(matchParticipant("Ana Reyes Cruz", [students[0], {...students[0], id: "c"}]).status, "ambiguous");
});
test("reconciliation skips duplicate workbook students, prior group conflicts, and changed positions", () => {
  const students = [student("a", "Ana", null, "Cruz"), student("b", "Bea", null, "Reyes"), student("c", "Cora", null, "Lee")];
  const memberships = [
    {studentId: "b", groupId: "else", groupName: "Elsewhere", position: "Member"},
    {studentId: "c", groupId: "ssc", groupName: "SSC Officers", position: "Treasurer"},
  ];
  const result = reconcile([participant("Ana Cruz"), participant("Ana Cruz", "BA Officers", 2), participant("Bea Reyes", "SSC Officers", 3), participant("Cora Lee", "SSC Officers", 4), participant("Missing Student", "SSC Officers", 5)], students, memberships, [{id: "ssc", name: "SSC Officers", slug: "custom-ssc-officers", category: "CUSTOM"}]);
  assert.equal(result.counts.matchedParticipants, 4);
  assert.equal(result.counts.missingParticipants, 1);
  assert.equal(result.counts.membershipConflicts, 4);
  assert.equal(result.assignments.length, 0);
});
test("same membership is idempotent and an empty position can be populated", () => {
  const students = [student("a", "Ana", null, "Cruz")];
  const groups = [{id: "ssc", name: "SSC Officers", slug: "custom-ssc-officers", category: "CUSTOM"}];
  const participants = [participant("Ana Cruz")];
  const membership = {studentId: "a", groupId: "ssc", groupName: "SSC Officers", position: "President"};
  const result = reconcile(participants, students, [membership], groups);
  assert.equal(result.counts.alreadyAssignedMembers, 1);
  assert.equal(result.assignments.length, 0);
  assert.equal(reconcile(participants, students, [{...membership, position: null}], groups).assignments[0].action, "set-position");
});
test("connection URL must be explicit, PostgreSQL, local and cannot override host or database", () => {
  for (const url of ["", "postgresql://u:p@prod.example/db", "http://localhost/db", "postgresql://u:p@127.0.0.1/db?host=prod.example", "postgresql://u:p@localhost/db?dbname=other"]) {
    assert.throws(() => validateLocalDatabaseUrl(url));
  }
  assert.equal(validateLocalDatabaseUrl("postgresql://u:p@127.0.0.1:5433/event_attendance_dev").database, "event_attendance_dev");
});
test("supplied workbook parser validates 95 participants and all group counts", () => {
  const parsed = JSON.parse(execFileSync("python3", ["scripts/uswag/read-workbook.py", "USWAG ATTENDANCE.xlsx"], {encoding: "utf8"}));
  assert.equal(parsed.participants.length, 95);
  assert.deepEqual(Object.fromEntries(Object.keys(parsed.expected).map(group => [group, parsed.participants.filter((p: {group: string}) => p.group === group).length])), parsed.expected);
  assert.ok(parsed.participants.every((p: {name: string; row: number}) => p.name && p.row > 0));
});
test("a colliding system slug cannot be reused as a custom group", () => {
  const result = reconcile([participant("Ana Cruz")], [student("a", "Ana", null, "Cruz")], [], [{id: "system", name: "SSC Officers", slug: "custom-ssc-officers", category: "HOUSE"}]);
  assert.equal(result.groups[0].action, "conflict");
  assert.equal(result.assignments.length, 0);
  assert.equal(result.counts.membershipConflicts, 1);
});
test("CLI never falls back to DATABASE_URL and apply requires a reviewed report", () => {
  for (const args of [[], ["--database-url", "postgresql://u:p@remote.example/db"], ["--database-url", "postgresql://u:p@127.0.0.1:5433/db", "--apply"]]) {
    assert.throws(() => execFileSync(process.execPath, ["--import", "tsx", "scripts/uswag/seed.ts", ...args], {encoding: "utf8", env: {...process.env, DATABASE_URL: "postgresql://u:p@remote.example/db"}, stdio: "pipe"}), (error: unknown) => {
      const result = error as {status: number; stderr: string};
      assert.equal(result.status, 1);
      assert.match(result.stderr, /LOCAL PostgreSQL|requires --approval-report/);
      return true;
    });
  }
});

test("remote seeding requires explicit opt-in and forbids connection overrides", () => {
  const url = "postgresql://u:p@db.prisma.io/postgres?sslmode=require";
  assert.throws(() => validateDatabaseUrl(url), /LOCAL/);
  assert.deepEqual(validateDatabaseUrl(url, true), {database: "postgres", host: "db.prisma.io", port: 5432});
  for (const suffix of ["&host=other.example", "&dbname=other", "&sslmode=disable"]) {
    assert.throws(() => validateDatabaseUrl(url + suffix, true));
  }
  assert.throws(() => validateDatabaseUrl("", true));
  assert.throws(() => validateDatabaseUrl("https://db.prisma.io/postgres", true));
});

test("remote apply still requires a reviewed report before connecting", () => {
  assert.throws(() => execFileSync(process.execPath, ["--import", "tsx", "scripts/uswag/seed.ts", "--database-url", "postgresql://u:p@db.prisma.io/postgres?sslmode=require", "--allow-remote", "--apply"], {encoding: "utf8", stdio: "pipe"}), (error: unknown) => {
    assert.match((error as {stderr: string}).stderr, /requires --approval-report/);
    return true;
  });
});
