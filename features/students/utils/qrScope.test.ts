import { test } from "node:test";
import assert from "node:assert/strict";
import { Student } from "../../../globals/types/students";
import { filterQRStudents, getRosterContext, studentsForPrint } from "./qrScope";

const students = Array.from({ length: 25 }, (_, index) => ({
  id: `ID-${String(index + 1).padStart(3, "0")}`,
  firstName: index === 0 ? "Juan" : "Student",
  middleName: index === 0 ? null : "",
  lastName: `Number ${index + 1}`,
  program: index < 13 ? "BSCS" : "BSIT",
  yearLevel: index < 13 ? "2" : "1",
  section: index < 13 ? "2A" : "1B",
})) as unknown as Student[];

test("roster context keeps every API-supported filter for its category", () => {
  assert.deepEqual(getRosterContext(new URLSearchParams("category=COLLEGE&department=CS&program=BSCS&house=AZUL&strand=STEM")).filters, { category: "COLLEGE", department: "CS", program: "BSCS", house: "AZUL" });
  assert.deepEqual(getRosterContext(new URLSearchParams("category=SHS&strand=STEM&house=AZUL&program=BSCS")).filters, { category: "SHS", strand: "STEM", house: "AZUL" });
  assert.deepEqual(getRosterContext(new URLSearchParams("category=ALL&house=AZUL&program=BSCS")).filters, { category: "ALL", house: "AZUL" });
  assert.deepEqual(getRosterContext(new URLSearchParams("category=invalid&house=AZUL")).filters, { category: "ALL" });
});

test("filtered print includes all matching students beyond a preview page", () => {
  const filtered = filterQRStudents(students, "", { program: "BSCS", yearLevel: "2" });
  assert.equal(filtered.length, 13);
  assert.deepEqual(studentsForPrint(students, filtered, new Set(["ID-001", "ID-025"]), "filtered").map((student) => student.id), filtered.map((student) => student.id));
  assert.deepEqual(studentsForPrint(students, filtered, new Set(["ID-001", "ID-025"]), "selected").map((student) => student.id), ["ID-001", "ID-025"]);
  assert.equal(studentsForPrint(students, filtered, new Set(), "roster").length, 25);
});

test("search matches unusual IDs and names with missing middle names", () => {
  assert.deepEqual(filterQRStudents(students, "id-001", {}).map((student) => student.firstName), ["Juan"]);
  assert.deepEqual(filterQRStudents(students, "juan", {}).map((student) => student.id), ["ID-001"]);
});

test('QR roster search finds external identifiers for generated internal IDs',()=>{
 const person={...students[0],id:'csyntheticcanonical00000001',usn:'00000123456',lrn:'000000123456'};
 for(const code of [person.usn,person.lrn])assert.equal(filterQRStudents([person],code,{})[0]?.id,person.id);
});


test("QR links preserve an explicit custom group across roster contexts", () => {
  assert.deepEqual(getRosterContext(new URLSearchParams("category=ALL&customGroupId=ssc-id")).filters, {category: "ALL", customGroupId: "ssc-id"});
  assert.deepEqual(getRosterContext(new URLSearchParams("category=SHS&strand=STEM&customGroupId=sslg-id")).filters, {category: "SHS", strand: "STEM", customGroupId: "sslg-id"});
});

test("every print scope stays inside the loaded group, including stale selections", () => {
  const members = students.slice(0, 13);
  const filtered = filterQRStudents(members, "juan", {});
  const selected = new Set([members[0].id, students[24].id]);
  assert.equal(studentsForPrint(members, filtered, selected, "roster").length, 13);
  assert.deepEqual(studentsForPrint(members, filtered, selected, "selected"), [members[0]]);
  assert.deepEqual(studentsForPrint(members, filtered, selected, "filtered"), [members[0]]);
});
