import assert from "node:assert/strict";
import { test } from "node:test";
import type { Student } from "@/globals/types/students";
import { indexManualRoster, searchManualRoster } from "./manualSearch";

function student(id: string, firstName: string, lastName: string, middleName: string | null = null): Student {
  return { id, firstName, lastName, middleName } as Student;
}

test("exact ID outranks names and preserves leading zeros and letter case", () => {
  const roster = indexManualRoster([
    student("00000123456", "Alpha", "Cruz"),
    student("00000A23456", "00000123456", "Santos"),
  ]);
  assert.deepEqual(searchManualRoster(roster, "00000123456").map((entry) => entry.student.id), ["00000123456", "00000A23456"]);
  assert.deepEqual(searchManualRoster(roster, "00000a"), []);
});

test("ID matching is contiguous and does not use subsequences", () => {
  const roster = indexManualRoster([student("00000123456", "Juan", "Cruz")]);
  assert.equal(searchManualRoster(roster, "00123").length, 1);
  assert.equal(searchManualRoster(roster, "01235").length, 0);
});

test("name tokens match either order with accents, separators and full middle names", () => {
  const roster = indexManualRoster([
    student("00000123456", "José Luis", "Dela-Cruz", "María"),
    student("00000123457", "Anne", "O'Neill"),
  ]);
  assert.equal(searchManualRoster(roster, "Dela Cruz, José")[0]?.student.id, "00000123456");
  assert.equal(searchManualRoster(roster, "Maria Jose").length, 0);
  assert.equal(searchManualRoster(roster, "O'Neill Anne")[0]?.student.id, "00000123457");
});

test("ties sort by names then exact ID and duplicate IDs appear once", () => {
  const roster = indexManualRoster([
    student("00000123459", "Juan", "Cruz"),
    student("00000123458", "Juan", "Cruz"),
    student("00000123458", "Juan", "Cruz"),
  ]);
  assert.deepEqual(searchManualRoster(roster, "Juan").map((entry) => entry.student.id), ["00000123458", "00000123459"]);
  assert.deepEqual(searchManualRoster(roster, " "), []);
});
