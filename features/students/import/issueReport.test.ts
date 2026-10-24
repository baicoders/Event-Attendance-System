import test from 'node:test';
import assert from 'node:assert/strict';
import type { ImportReviewRow } from './contract';
import { serializeImportIssuesCsv } from './issueReport';

const blocked = (overrides: Partial<ImportReviewRow> = {}): ImportReviewRow => ({
  csvRow: 42,
  student: { id: '', usn: '00000123456', lrn: '000000123456', firstName: 'Synthetic', lastName: 'Student', middleName: '', schoolLevel: '', yearLevel: '', section: '', house: 'unknown-house', program: '', department: '', strand: '' },
  status: 'BLOCKED', changes: [], groupIds: [],
  reasons: [{ code: 'UNKNOWN_GROUP', field: 'house', message: 'Unknown house group "unknown-house".' }],
  ...overrides,
});

test('issue report identifies the source row, identifiers, field, value, problem and corrective action', () => {
  const csv = serializeImportIssuesCsv([blocked()]);
  assert.ok(csv.startsWith('Source row,Sheet,Student name,USN,LRN,Field,Actual value,Problem,Corrective action\r\n'));
  assert.ok(csv.includes('42,,Synthetic Student,00000123456,000000123456,house,unknown-house,'));
  assert.ok(csv.includes('"Unknown house group ""unknown-house""."'));
  assert.ok(csv.includes('Use an existing group slug in the correct category'));
});

test('issue report excludes clean rows and unrelated existing-state change values', () => {
  const rows = [blocked({ status: 'UNCHANGED', csvRow: 5, reasons: [] }), blocked({ changes: [{ field: 'firstName', before: 'Private old value', after: 'Synthetic' }] })];
  const csv = serializeImportIssuesCsv(rows);
  assert.equal(csv.trimEnd().split('\r\n').length, 2);
  assert.ok(!csv.includes('Private old value'));
  assert.ok(!csv.includes('\r\n5,'));
});

test('every untrusted output cell neutralizes formula and whitespace-control prefixes', () => {
  for (const value of ['=1+1', '+cmd', '-cmd', '@cmd', '\tcmd', '\rcmd', '  =cmd', ' \tcmd', '\u0000=cmd', '\u200b+cmd']) {
    const issue = blocked();
    issue.student.firstName = value;
    issue.student.usn = value;
    issue.student.lrn = value;
    issue.student.house = value;
    issue.reasons[0].message = value;
    const csv = serializeImportIssuesCsv([issue]);
    assert.ok(csv.includes(`'${value}`), `unsafe prefix not escaped: ${JSON.stringify(value)}`);
    assert.equal(csv.split(`'${value}`).length - 1, 5, `not all cells escaped: ${JSON.stringify(value)}`);
  }
});

test('all exceptions are exported regardless of preview pagination with one line per reason', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => blocked({ csvRow: i + 2 }));
  rows[999].reasons.push({ code: 'IDENTITY_CONFLICT', field: 'usn', message: 'Conflicting identity.' });
  const csv = serializeImportIssuesCsv(rows);
  assert.equal(csv.trimEnd().split('\r\n').length, 1002);
  assert.ok(csv.includes('\r\n1001,'));
  assert.ok(csv.includes('Review the identifiers and name against the official source'));
});

test('empty issues export is header-only and embedded commas, quotes and newlines are quoted', () => {
  assert.equal(serializeImportIssuesCsv([]).split('\r\n').length, 2);
  const issue = blocked();
  issue.student.firstName = 'Ana, "A"\nLine';
  assert.ok(serializeImportIssuesCsv([issue]).includes('"Ana, ""A""\nLine Student"'));
});
