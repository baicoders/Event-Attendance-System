import ExcelJS from 'exceljs';
import { Unzip, UnzipInflate } from 'fflate';
import { IMPORT_INPUT_HEADERS, MAX_IMPORT_BYTES, MAX_IMPORT_CELL_CHARS, MAX_IMPORT_ROWS } from './contract';

const MAX_ZIP_ENTRIES = 128;
const MAX_EXPANDED_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_COLUMNS = IMPORT_INPUT_HEADERS.length;

export class StudentXlsxError extends Error {
  constructor(message: string) { super(message); this.name = 'StudentXlsxError'; }
}

const reject = (message: string): never => { throw new StudentXlsxError(message); };
const columnNumber = (letters: string) => [...letters].reduce((number, letter) => number * 26 + letter.charCodeAt(0) - 64, 0);

/** Both ZIP readers must see identical entries. fflate follows local headers;
 * JSZip follows the central directory, including its file offsets and lengths.
 */
function validateZipDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = (): never => reject('XLSX archive directory and local headers are invalid or inconsistent.');
  const bounds = (offset: number, length: number) => { if (offset < 0 || offset + length > bytes.length) invalid(); };
  const nameAt = (offset: number, length: number) => {
    bounds(offset, length);
    const name = bytes.subarray(offset, offset + length);
    // Internal XLSX resource paths are ASCII; Unicode display names live in XML.
    if (name.some(value => value < 32 || value > 126)) return invalid();
    return new TextDecoder().decode(name);
  };
  const extras = (offset: number, length: number) => {
    const end = offset + length;
    bounds(offset, length);
    while (offset < end) {
      if (offset + 4 > end) return invalid();
      const type = view.getUint16(offset, true);
      const size = view.getUint16(offset + 2, true);
      if (type === 0x0001 || type === 0x7075 || offset + 4 + size > end) return invalid();
      offset += 4 + size;
    }
  };
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 65535); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0) return invalid();
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || !count || count > MAX_ZIP_ENTRIES || directoryOffset + directorySize !== end) return invalid();
  const names = new Set<string>();
  const entries: { offset: number; end: number }[] = [];
  let cursor = directoryOffset;
  for (let index = 0; index < count; index++) {
    bounds(cursor, 46);
    if (view.getUint32(cursor, true) !== 0x02014b50 || view.getUint16(cursor + 34, true)) return invalid();
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressed = view.getUint32(cursor + 20, true);
    const expanded = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true);
    const name = nameAt(cursor + 46, nameLength);
    if (names.has(name) || flags & 0x2001 || ![0, 8].includes(method) || compressed === 0xffffffff || expanded === 0xffffffff) return invalid();
    names.add(name);
    extras(cursor + 46 + nameLength, extraLength);
    bounds(offset, 30);
    if (view.getUint32(offset, true) !== 0x04034b50 || view.getUint16(offset + 6, true) !== flags || view.getUint16(offset + 8, true) !== method) return invalid();
    const localNameLength = view.getUint16(offset + 26, true);
    const localExtraLength = view.getUint16(offset + 28, true);
    if (nameAt(offset + 30, localNameLength) !== name) return invalid();
    extras(offset + 30 + localNameLength, localExtraLength);
    for (const [local, expected] of [[view.getUint32(offset + 14, true), crc], [view.getUint32(offset + 18, true), compressed], [view.getUint32(offset + 22, true), expanded]]) {
      if (local !== expected && (!(flags & 8) || local !== 0)) return invalid();
    }
    let dataEnd = offset + 30 + localNameLength + localExtraLength + compressed;
    bounds(dataEnd, flags & 8 ? 12 : 0);
    if (flags & 8) {
      if (view.getUint32(dataEnd, true) === 0x08074b50) dataEnd += 4;
      bounds(dataEnd, 12);
      if (view.getUint32(dataEnd, true) !== crc || view.getUint32(dataEnd + 4, true) !== compressed || view.getUint32(dataEnd + 8, true) !== expanded) return invalid();
      dataEnd += 12;
    }
    entries.push({ offset, end: dataEnd });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) return invalid();
  entries.sort((a, b) => a.offset - b.offset);
  let nextOffset = 0;
  for (const entry of entries) {
    if (entry.offset !== nextOffset) return invalid();
    nextOffset = entry.end;
  }
  if (nextOffset !== directoryOffset) return invalid();
}

/** Coordinates must be literal canonical ASCII. XML entity decoding occurs in
 * ExcelJS after this check, so accepting only a matching subset is unsafe.
 * Read entire quoted attribute values, including embedded > delimiters.
 */
function validateWorksheetCoordinates(source: string) {
  let coordinates = 0;
  let validationCells = 0;
  const maximumCells = (MAX_IMPORT_ROWS + 1) * MAX_COLUMNS;
  const invalid = (): never => reject('Invalid or unsupported worksheet coordinate, range or span. Use literal cell references within the import row and column limits.');
  const integer = (value: string, maximum: number) => {
    if (!/^[1-9]\d*$/.test(value) || value.length > 10 || Number(value) > maximum) return invalid();
    return Number(value);
  };
  const address = (value: string): [number, number] => {
    const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/.exec(value);
    if (!match) return invalid();
    const column = columnNumber(match[1]);
    if (column > MAX_COLUMNS) return invalid();
    return [column, integer(match[2], MAX_IMPORT_ROWS + 1)];
  };
  const ranges = (value: string, countValidationCells: boolean) => {
    if (!value || value.includes('&')) return invalid();
    for (const range of value.split(/\s+/)) {
      const parts = range.split(':');
      if (parts.length > 2) return invalid();
      const [left, top] = address(parts[0]);
      const [right, bottom] = address(parts[1] ?? parts[0]);
      if (left > right || top > bottom) return invalid();
      if (countValidationCells) {
        validationCells += (right - left + 1) * (bottom - top + 1);
        if (validationCells > maximumCells) return invalid();
      }
    }
  };
  for (const [, qualifiedName, rawAttributes] of source.matchAll(/<([A-Za-z_][\w.:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const name = qualifiedName.split(':').at(-1);
    const attributes = new Map<string, string>();
    for (const [, qualifiedAttribute, doubleQuoted, singleQuoted] of rawAttributes.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const attribute = qualifiedAttribute.split(':').at(-1)!;
      if (attributes.has(attribute)) return invalid();
      attributes.set(attribute, doubleQuoted ?? singleQuoted);
    }
    if (name === 'mergeCell') reject('Merged worksheet cells are unsupported. Unmerge source cells and review again.');
    if (name === 'row') integer(attributes.get('r') ?? '', MAX_IMPORT_ROWS + 1);
    if (name === 'sheet') integer(attributes.get('sheetId') ?? '', MAX_ZIP_ENTRIES);
    if (name === 'c') address(attributes.get('r') ?? '');
    if ((name === 'row' || name === 'c') && ++coordinates > maximumCells + MAX_IMPORT_ROWS + 1) return invalid();
    if (name === 'col') {
      const minimum = integer(attributes.get('min') ?? '', MAX_COLUMNS);
      const maximum = integer(attributes.get('max') ?? '', MAX_COLUMNS);
      if (minimum > maximum) return invalid();
    }
    for (const [attribute, value] of attributes) {
      if (attribute === 'ref' || attribute === 'sqref' || attribute === 'activeCell' || attribute === 'topLeftCell') ranges(value, name === 'dataValidation' && attribute === 'sqref');
      if (attribute === 'spans') {
        const parts = value.split(':');
        if (parts.length !== 2 || integer(parts[0], MAX_COLUMNS) > integer(parts[1], MAX_COLUMNS)) return invalid();
      }
    }
  }
  // Workbook defined names expand through ExcelJS CellMatrix, rather than the
  // worksheet row parser. Bound those text ranges before model construction too.
  for (const [, attributes, content] of source.matchAll(/<(?:[\w.-]+:)?definedName\b((?:[^>"']|"[^"]*"|'[^']*')*)>([^<]*)<\/(?:[\w.-]+:)?definedName\s*>/g)) {
    const printTitles = /\bname\s*=\s*["']_xlnm\.Print_Titles["']/.test(attributes);
    let quoted = false;
    let item = '';
    const check = () => {
      const reference = item.slice(item.lastIndexOf('!') + 1);
      const rowTitles = /^\$?([1-9]\d*):\$?([1-9]\d*)$/.exec(reference);
      const columnTitles = /^\$?([A-Z]{1,3}):\$?([A-Z]{1,3})$/.exec(reference);
      if (printTitles && rowTitles) {
        if (integer(rowTitles[1], MAX_IMPORT_ROWS + 1) > integer(rowTitles[2], MAX_IMPORT_ROWS + 1)) invalid();
      } else if (printTitles && columnTitles) {
        if (columnNumber(columnTitles[1]) > columnNumber(columnTitles[2]) || columnNumber(columnTitles[2]) > MAX_COLUMNS) invalid();
      } else ranges(reference, true);
      item = '';
    };
    for (const character of content) {
      if (character === "'") quoted = !quoted;
      if (character === ',' && !quoted) check();
      else item += character;
    }
    if (quoted) invalid();
    check();
  }
  return validationCells;
}

/** Measure actual decompression, not attacker-controlled ZIP size declarations.
 * Feed small compressed chunks so an oversized entry cannot inflate in one push.
 * Validate sparse worksheet coordinates/merges before ExcelJS allocates models.
 */
function preflightXlsx(bytes: Uint8Array) {
  if (bytes.length > MAX_IMPORT_BYTES) reject('XLSX exceeds the 10 MiB file limit.');
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) reject('Choose a valid, unencrypted XLSX workbook.');
  validateZipDirectory(bytes);
  const names = new Set<string>();
  let expandedBytes = 0;
  let xmlElements = 0;
  let expandedCellModels = 0;
  let completed = 0;
  const unzip = new Unzip(file => {
    if (names.size >= MAX_ZIP_ENTRIES) reject('XLSX archive exceeds the supported resource limit.');
    const pathParts = (file.name.endsWith('/') ? file.name.slice(0, -1) : file.name).split('/');
    if (names.has(file.name) || file.name.startsWith('/') || file.name.includes('\\') || pathParts.some(part => !part || part === '..' || part === '.')) reject('XLSX contains an unsafe or duplicate archive path.');
    if (!/\.(?:xml|rels)$/i.test(file.name) && !file.name.endsWith('/')) reject('XLSX contains unsupported embedded or macro content.');
    if (/(?:^|\/)(?:externalLinks|activeX|embeddings)\//i.test(file.name)) reject('XLSX contains unsupported external or embedded content.');
    names.add(file.name);
    if ((file.originalSize ?? 0) > MAX_EXPANDED_ENTRY_BYTES) reject('XLSX expanded entry exceeds the supported resource limit.');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const xml: string[] = [];
    let entryBytes = 0;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      entryBytes += chunk.byteLength;
      expandedBytes += chunk.byteLength;
      if (entryBytes > MAX_EXPANDED_ENTRY_BYTES || expandedBytes > MAX_EXPANDED_BYTES) reject('XLSX expanded content exceeds the supported resource limit.');
      xml.push(decoder.decode(chunk, { stream: !final }));
      if (!final) return;
      completed++;
      const source = xml.join('');
      const elements = source.matchAll(/<[A-Za-z_]/g);
      while (!elements.next().done) {
        if (++xmlElements > 750_000) reject('XLSX XML exceeds the supported element resource limit.');
      }
      if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(source)) reject('XLSX contains unsupported XML declarations.');
      if (file.name === '[Content_Types].xml' && /macroEnabled|vbaProject/i.test(source)) reject('XLSX macro content is unsupported.');
      if (file.name === 'xl/workbook.xml' || /^xl\/worksheets\/[^/]+\.xml$/i.test(file.name)) {
        expandedCellModels += validateWorksheetCoordinates(source);
        if (expandedCellModels > (MAX_IMPORT_ROWS + 1) * MAX_COLUMNS) reject('XLSX expanded cell models exceed the supported resource limit.');
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 1024) unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  if (completed !== names.size || !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) reject('Choose a valid, unencrypted XLSX workbook.');
}

function cellText(cell: ExcelJS.Cell, identifier: boolean, sheetName: string): string {
  const where = `Worksheet "${sheetName}", cell ${cell.address}`;
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) reject(`${where}: formulas are unsupported. Replace the formula with verified source text.`);
  if (identifier && typeof value !== 'string') reject(`${where}: identifiers must be stored as text. Restore the original identifier, including any leading zeros; formatting an already rounded number as text cannot recover it.`);
  let text: string;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' && Number.isFinite(value)) text = String(value);
  else if (typeof value === 'object' && 'richText' in value && !identifier) text = value.richText.map(part => part.text).join('');
  else return reject(`${where}: use plain text instead of dates, errors, links or unsupported cell values.`);
  if (identifier && /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(text.trim())) reject(`${where}: scientific-notation identifiers are unsupported. Restore the exact original identifier as text.`);
  if (text.length > MAX_IMPORT_CELL_CHARS) reject(`${where}: cell exceeds the ${MAX_IMPORT_CELL_CHARS}-character resource limit.`);
  if (/[\r\n]/.test(text)) reject(`${where}: remove line breaks so diagnostic row numbers match the spreadsheet.`);
  return text;
}

const csvCell = (value: string) => /[",]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** Single-sheet document parser, intentionally bounded rather than streaming.
 * The caller should run this adapter in a worker to keep the upload UI responsive.
 * Numeric identifiers are refused: neither formatting nor padding can prove that
 * Excel has preserved an original identifier's zeros or precision.
 */
export async function studentXlsxToCsv(buffer: ArrayBuffer): Promise<{ csv: string; sheetName: string }> {
  try {
    preflightXlsx(new Uint8Array(buffer));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheets = workbook.worksheets.filter(sheet => sheet.actualRowCount > 0);
    if (sheets.length !== 1) reject('Use exactly one populated worksheet per XLSX import. Save each roster sheet as a separate workbook.');
    const sheet = sheets[0];
    if (sheet.rowCount > MAX_IMPORT_ROWS + 1) reject(`XLSX exceeds the ${MAX_IMPORT_ROWS.toLocaleString()}-student row limit.`);
    if (sheet.columnCount > MAX_COLUMNS) reject('XLSX has more columns than the canonical student-import format.');
    const headers = Array.from({ length: sheet.columnCount }, (_, index) => cellText(sheet.getRow(1).getCell(index + 1), false, sheet.name));
    const lines: string[] = [];
    for (let number = 1; number <= sheet.rowCount; number++) {
      const row = sheet.getRow(number);
      if (row.actualCellCount === 0) { lines.push(''); continue; }
      const values = headers.map((header, index) => cellText(row.getCell(index + 1), number > 1 && ['id', 'usn', 'lrn'].includes(header), sheet.name));
      lines.push(values.map(csvCell).join(','));
    }
    const csv = `${lines.join('\n')}\n`;
    if (new TextEncoder().encode(csv).byteLength > MAX_IMPORT_BYTES) reject('Converted XLSX exceeds the 10 MiB canonical CSV limit. Split the workbook before continuing.');
    return { csv, sheetName: sheet.name };
  } catch (error) {
    if (error instanceof StudentXlsxError) throw error;
    throw new StudentXlsxError('Unable to read a valid, unencrypted XLSX workbook. Save the source as XLSX or UTF-8 CSV and try again.');
  }
}
