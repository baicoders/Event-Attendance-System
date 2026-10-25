import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QRCode from "react-qr-code";
import { StudentQRCard } from "./StudentQRCard";
import { StudentQRPrintGrid } from "./StudentQRPrintGrid";
import type { Student } from "@/globals/types/students";

const student = { id: "canonical-student-id", usn: "00000123456", lrn: "000000123456", firstName: "Sample", lastName: "Student" } as Student;
const paths = (html: string) => [...html.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)].map(match => match[1]);

test("USN and LRN cards encode the selected external identifier, preserving leading zeros", () => {
  for (const identifierType of ["USN", "LRN"] as const) {
    const value = identifierType === "USN" ? student.usn! : student.lrn!;
    const html = renderToStaticMarkup(createElement(StudentQRCard, { student, identifierType }));
    assert.deepEqual(paths(html), paths(renderToStaticMarkup(createElement(QRCode, { value }))));
    assert.ok(html.includes(`${identifierType}: ${value}`));
    assert.equal(html.includes(student.id), false);
  }
});

test("cards use the available external identifier and retain legacy internal-ID QR support", () => {
  for (const [person, identifierType, expected] of [
    [{ ...student, usn: null }, "USN", student.lrn],
    [{ ...student, lrn: null }, "LRN", student.usn],
    [{ ...student, usn: null, lrn: null }, "USN", student.id],
  ] as const) {
    const html = renderToStaticMarkup(createElement(StudentQRCard, { student: person, identifierType }));
    assert.deepEqual(paths(html), paths(renderToStaticMarkup(createElement(QRCode, { value: expected! }))));
  }
});

test("printed QR grids encode the same identifier preference as preview cards", () => {
  const html = renderToStaticMarkup(createElement(StudentQRPrintGrid, { students: [student], size: "standard", identifierType: "LRN" }));
  assert.deepEqual(paths(html), paths(renderToStaticMarkup(createElement(QRCode, { value: student.lrn! }))));
  assert.ok(html.includes(`LRN: ${student.lrn}`));
});

test("custom-group batches label every card without changing identifiers or 12/6-card pagination", () => {
  const students = Array.from({ length: 13 }, (_, index) => ({ ...student, id: `student-${index}` }));
  for (const [size, pages] of [["standard", 2], ["large", 3]] as const) {
    const html = renderToStaticMarkup(createElement(StudentQRPrintGrid, { students, size, identifierType: "LRN", customGroupName: "Arts & Culture Council" }));
    const cards = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)].map(match => match[1]);
    assert.equal(cards.length, 13);
    assert.equal((html.match(/class="student-qr-print-sheet"/g) ?? []).length, pages);
    for (const card of cards) {
      assert.match(card, /<h2\b[^>]*>Arts &amp; Culture Council<\/h2>/);
      assert.ok(card.indexOf("Arts &amp; Culture Council") < card.indexOf("<svg"));
      assert.ok(card.includes(`LRN: ${student.lrn}`));
    }
  }
});
