import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { parseStudentImportCsv } from './csv';
import { studentXlsxToCsv } from './xlsx';

async function workbook(values: ExcelJS.CellValue[][], extraSheet = false) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Synthetic roster');
  sheet.addRows(values);
  if (extraSheet) wb.addWorksheet('Second roster').addRows(values);
  const bytes = await wb.xlsx.writeBuffer();
  return new Uint8Array(bytes).buffer;
}
const header = ['usn', 'lrn', 'firstName', 'lastName'];

test('XLSX text identifiers retain leading zeros and source row numbers through canonical CSV', async () => {
  const bytes = await workbook([header, ['00000123456', '000000123456', 'Synthetic', 'Student'], [], ['00000123457', '', 'Second', 'Student']]);
  const result = await studentXlsxToCsv(bytes);
  assert.equal(result.sheetName, 'Synthetic roster');
  const parsed = parseStudentImportCsv(result.csv);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.rows.map(row => [row.csvRow, row.student.usn, row.student.lrn]), [[2, '00000123456', '000000123456'], [4, '00000123457', '']]);
});

test('XLSX rejects identifiers stored as numbers, dates, formulas or scientific-notation text', async () => {
  for (const identifier of [12345678901, new Date('2026-01-01'), { formula: '1+1', result: 2 }, '1.2345678901E+10']) {
    await assert.rejects(studentXlsxToCsv(await workbook([header, [identifier, '', 'Synthetic', 'Student']])), /A2.*(?:text|formula|scientific)/i);
  }
});

test('XLSX rejects multiple populated sheets instead of silently dropping a roster', async () => {
  await assert.rejects(studentXlsxToCsv(await workbook([header, ['00000123456', '', 'Synthetic', 'Student']], true)), /one populated worksheet/i);
});

test('XLSX reports malformed archives safely and rejects oversized compressed sources', async () => {
  await assert.rejects(studentXlsxToCsv(new Uint8Array([1, 2, 3]).buffer), /valid.*XLSX/i);
  await assert.rejects(studentXlsxToCsv(new ArrayBuffer(10 * 1024 * 1024 + 1)), /10 MiB/i);
});

test('XLSX validates actual ZIP expansion before loading workbook objects', async () => {
  const archive = zipSync({ 'xl/worksheets/sheet1.xml': strToU8('x'.repeat(17 * 1024 * 1024)) });
  // Lie about expanded lengths in both local header and central directory.
  // A resource guard that trusts either declaration would miss this archive.
  const view = new DataView(archive.buffer);
  for (let offset = 0; offset <= archive.length - 28; offset++) {
    if (view.getUint32(offset, true) === 0x04034b50) view.setUint32(offset + 22, 0, true);
    if (view.getUint32(offset, true) === 0x02014b50) view.setUint32(offset + 24, 0, true);
  }
  await assert.rejects(studentXlsxToCsv(archive.buffer as ArrayBuffer), /expanded|resource/i);
});

test('XLSX rejects excessive source rows, merged cells and unsafe archive parts before workbook load', async () => {
  for (const [name, xml] of [
    ['xl/worksheets/sheet1.xml', '<worksheet><row r="10002"/></worksheet>'],
    ['xl/worksheets/sheet1.xml', '<worksheet><mergeCells><mergeCell ref="A1:XFD1048576"/></mergeCells></worksheet>'],
    ['xl/worksheets/sheet1.xml', '<worksheet><cols><col min="1" max="1048576"/></cols></worksheet>'],
    ['xl/vbaProject.bin', 'synthetic macro placeholder'],
    ['../outside.xml', 'synthetic unsafe path'],
  ]) {
    const archive = zipSync({ [name]: strToU8(xml) });
    await assert.rejects(studentXlsxToCsv(archive.buffer as ArrayBuffer), /row|column|merged|unsupported|unsafe/i);
  }
});

test('XLSX rejects multiline cells because converted CSV diagnostics must retain spreadsheet rows', async () => {
  await assert.rejects(studentXlsxToCsv(await workbook([header, ['00000123456', '', 'Synthetic\nOther', 'Student']])), /C2.*line/i);
});

test('XLSX accepts 10,000 synthetic text-identifier records without truncation', async () => {
  const values = Array.from({ length: 10_000 }, (_, index) => [String(index).padStart(11, '0'), '', `Synthetic ${index}`, 'Student']);
  const result = await studentXlsxToCsv(await workbook([header, ...values]));
  const parsed = parseStudentImportCsv(result.csv);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 10_000);
  assert.equal(parsed.rows[9999].csvRow, 10_001);
  assert.equal(parsed.rows[9999].student.usn, '00000009999');
});

test('XLSX rejects encoded or malformed allocation-driving XML attributes before loading worksheet models', async () => {
  const original = new Uint8Array(await workbook([header, ['00000123456', '', 'Synthetic', 'Student']]));
  const modifications = [
    (xml: string) => xml.replace('r="2"', 'r="1000&#50;"'),
    (xml: string) => xml.replace('r="A2"', 'r="A1000&#x32;"'),
    (xml: string) => xml.replace('r="2"', "r='-2'"),
    (xml: string) => xml.replace('r="A2"', 'r="A0"'),
    (xml: string) => xml.replace('r="2"', 'r="2e10"'),
    (xml: string) => xml.replace('ref="A1:D2"', 'ref="A1:D1000&#50;"'),
    (xml: string) => xml.replace('spans="1:4"', 'spans="1:1000&#50;"'),
    (xml: string) => xml.replace('<sheetData>', '<cols><col min="1" max="1&#53;"/></cols><sheetData>'),
    (xml: string) => xml.replace('<sheetData>', '<cols><col min="0" max="14"/></cols><sheetData>'),
    (xml: string) => xml.replace('<sheetData>', '<x:row xmlns:x="urn:synthetic" r="1000&#50;"/><sheetData>'),
    (xml: string) => xml.replace('r="2"', 'ignored="quoted > delimiter" r="1000&#50;"'),
    (xml: string) => xml.replace('<sheetData>', '<dataValidations><dataValidation sqref="A1:A1000&#50;"/></dataValidations><sheetData>'),
  ];
  for (const modify of modifications) {
    const parts = unzipSync(original);
    const source = strFromU8(parts['xl/worksheets/sheet1.xml']);
    const changed = modify(source);
    assert.notEqual(changed, source, 'synthetic mutation must replace an actual source attribute');
    parts['xl/worksheets/sheet1.xml'] = strToU8(changed);
    await assert.rejects(studentXlsxToCsv(zipSync(parts).buffer as ArrayBuffer), /worksheet (?:coordinate|range|span)/i);
  }
});

test('XLSX bounds workbook sheet identifiers before sparse worksheet-array allocation', async () => {
  const original = new Uint8Array(await workbook([header, ['00000123456', '', 'Synthetic', 'Student']]));
  for (const id of ['1000&#50;', '10002', '-1', '0', '1e9']) {
    const parts = unzipSync(original);
    const source = strFromU8(parts['xl/workbook.xml']);
    const changed = source.replace('sheetId="1"', `sheetId="${id}"`);
    assert.notEqual(changed, source);
    parts['xl/workbook.xml'] = strToU8(changed);
    await assert.rejects(studentXlsxToCsv(zipSync(parts).buffer as ArrayBuffer), /worksheet (?:coordinate|range|span)/i);
  }
});

test('XLSX rejects disagreeing ZIP local and central filenames before classifying XML resources', async () => {
  const bytes = new Uint8Array(await workbook([header, ['00000123456', '', 'Synthetic', 'Student']]));
  const view = new DataView(bytes.buffer);
  for (let offset = 0; offset < bytes.length - 30; offset++) {
    if (view.getUint32(offset, true) !== 0x04034b50) continue;
    const length = view.getUint16(offset + 26, true);
    const name = strFromU8(bytes.subarray(offset + 30, offset + 30 + length));
    if (name !== 'xl/worksheets/sheet1.xml') continue;
    bytes.set(strToU8('xl/worksheets/style1.xml'), offset + 30);
    break;
  }
  await assert.rejects(studentXlsxToCsv(bytes.buffer), /archive.*(?:directory|header|name)/i);
});

test('XLSX refuses resource paths normalized differently by the workbook ZIP reader', async () => {
  const parts = unzipSync(new Uint8Array(await workbook([header, ['00000123456', '', 'Synthetic', 'Student']])));
  parts['xl//worksheets/sheet1.xml'] = parts['xl/worksheets/sheet1.xml'];
  delete parts['xl/worksheets/sheet1.xml'];
  await assert.rejects(studentXlsxToCsv(zipSync(parts).buffer as ArrayBuffer), /unsafe.*path/i);
});

test('XLSX bounds defined-name cell-matrix expansion before loading the workbook', async () => {
  const original = new Uint8Array(await workbook([header, ['00000123456', '', 'Synthetic', 'Student']]));
  for (const reference of ["'Synthetic roster'!$A$1:$D$1000&#50;", "'Synthetic roster'!$A$1:$D$10002", "'Synthetic roster'!$A$1:$XFD$2"]) {
    const parts = unzipSync(original);
    const source = strFromU8(parts['xl/workbook.xml']);
    parts['xl/workbook.xml'] = strToU8(source.replace('</workbook>', `<definedNames><definedName name="SyntheticRange">${reference}</definedName></definedNames></workbook>`));
    await assert.rejects(studentXlsxToCsv(zipSync(parts).buffer as ArrayBuffer), /worksheet (?:coordinate|range|span)/i);
  }
});

test('XLSX bounds generated validation-cell models across the entire archive', async () => {
  const xml = '<worksheet><dataValidations><dataValidation sqref="A1:N6000"/></dataValidations></worksheet>';
  const parts = { 'xl/worksheets/sheet1.xml': strToU8(xml), 'xl/worksheets/sheet2.xml': strToU8(xml) };
  await assert.rejects(studentXlsxToCsv(zipSync(parts).buffer as ArrayBuffer), /expanded.*cell.*resource/i);
});
