import { strFromU8, unzipSync } from 'fflate';

export type Cell = string | number | null;

export interface ParsedSheet {
  headers: string[];
  rows: Cell[][];
}

/**
 * Minimal xlsx reader: first worksheet only, values only (no formatting).
 *
 * Works by string scanning rather than a DOM parser (not available in workers) and
 * jumps straight to cells that hold a value, so the hundreds of thousands of empty
 * formatted rows these exports carry cost almost nothing.
 *
 * Cells formatted as dates are returned as 'YYYY-MM-DD' strings.
 */
export function parseXlsx(data: Uint8Array): ParsedSheet {
  const files = unzipSync(data, {
    filter: (f) =>
      f.name === 'xl/workbook.xml' ||
      f.name === 'xl/_rels/workbook.xml.rels' ||
      f.name === 'xl/sharedStrings.xml' ||
      f.name === 'xl/styles.xml' ||
      f.name.startsWith('xl/worksheets/'),
  });
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : '');

  const sheetPath = firstSheetPath(text('xl/workbook.xml'), text('xl/_rels/workbook.xml.rels'));
  const sheetXml = text(sheetPath);
  if (!sheetXml) throw new Error('Could not find a worksheet in this file');

  const strings = parseSharedStrings(text('xl/sharedStrings.xml'));
  const dateStyles = parseDateStyles(text('xl/styles.xml'));
  const grid = parseSheet(sheetXml, strings, dateStyles);

  const headerRow = grid.shift() ?? [];
  const headers = headerRow.map((h, i) => (h === null || h === '' ? `Column ${i + 1}` : String(h).trim()));
  const rows = grid.map((r) => {
    const out = r.slice(0, headers.length);
    while (out.length < headers.length) out.push(null);
    return out;
  });
  return { headers, rows };
}

function firstSheetPath(workbook: string, rels: string): string {
  const relId = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  if (relId) {
    const rel = new RegExp(`<Relationship\\b[^>]*\\bId="${relId}"[^>]*>`).exec(rels)?.[0];
    const target = rel && /\bTarget="([^"]+)"/.exec(rel)?.[1];
    if (target) return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  }
  return 'xl/worksheets/sheet1.xml';
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let si: RegExpExecArray | null;
  while ((si = siRe.exec(xml))) {
    // Phonetic runs (<rPh>) are not part of the visible text.
    const body = si[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let s = '';
    let t: RegExpExecArray | null;
    tRe.lastIndex = 0;
    while ((t = tRe.exec(body))) s += t[1];
    out.push(decodeXml(s));
  }
  return out;
}

/** Returns the set of cell style indexes (the `s` attribute) that render as dates. */
function parseDateStyles(xml: string): Set<number> {
  const customDate = new Set<number>();
  const fmtRe = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = fmtRe.exec(xml))) {
    // Strip quoted literals and [colour]/[locale] blocks, then look for date tokens.
    const code = decodeXml(m[2]).replace(/"[^"]*"|\[[^\]]*\]/g, '');
    if (/[dy]/i.test(code)) customDate.add(+m[1]);
  }
  const isDateFmt = (id: number) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || customDate.has(id);

  const result = new Set<number>();
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  const xfRe = /<xf\b[^>]*>/g;
  let i = 0;
  while ((m = xfRe.exec(xfs))) {
    const id = /numFmtId="(\d+)"/.exec(m[0])?.[1];
    if (id && isDateFmt(+id)) result.add(i);
    i++;
  }
  return result;
}

function parseSheet(xml: string, strings: string[], dateStyles: Set<number>): Cell[][] {
  const rows: Cell[][] = [];
  const start = xml.indexOf('<sheetData');
  if (start < 0) return rows;

  let pos = start;
  // Next positions of value-bearing tags; cached so each is scanned for at most once per hit.
  let nextV = -2;
  let nextIs = -2;
  for (;;) {
    if (nextV !== -1 && nextV < pos) nextV = xml.indexOf('<v>', pos);
    if (nextIs !== -1 && nextIs < pos) nextIs = xml.indexOf('<is>', pos);
    const hit = nextV === -1 ? nextIs : nextIs === -1 ? nextV : Math.min(nextV, nextIs);
    if (hit === -1) break;

    const rowStart = xml.lastIndexOf('<row', hit);
    let rowEnd = xml.indexOf('</row>', hit);
    if (rowEnd === -1) rowEnd = xml.length;
    rows.push(parseRow(xml.slice(rowStart, rowEnd), strings, dateStyles));
    pos = rowEnd + 6;
  }
  return rows;
}

function parseRow(row: string, strings: string[], dateStyles: Set<number>): Cell[] {
  const cells: Cell[] = [];
  let col = 0;
  let p = 0;
  for (;;) {
    const c = row.indexOf('<c ', p);
    if (c === -1) break;
    const tagEnd = row.indexOf('>', c);
    const tag = row.slice(c, tagEnd);
    const ref = /\br="([A-Z]+)\d*"/.exec(tag)?.[1];
    if (ref) col = colIndex(ref);

    if (row[tagEnd - 1] === '/') {
      p = tagEnd + 1;
      col++;
      continue;
    }
    const cEnd = row.indexOf('</c>', tagEnd);
    const inner = row.slice(tagEnd + 1, cEnd);
    p = cEnd + 4;

    const type = /\bt="([^"]+)"/.exec(tag)?.[1];
    const style = /\bs="(\d+)"/.exec(tag)?.[1];
    let value: Cell = null;
    if (type === 'inlineStr') {
      let s = '';
      for (const t of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += t[1];
      value = decodeXml(s);
    } else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      if (v !== undefined) {
        if (type === 's') value = strings[+v] ?? null;
        else if (type === 'str' || type === 'e') value = decodeXml(v);
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else {
          const n = Number(v);
          value = style !== undefined && dateStyles.has(+style) ? serialToIsoDate(n) : n;
        }
      }
    }
    if (typeof value === 'string') {
      value = value.trim();
      if (value === '') value = null;
    }
    while (cells.length < col) cells.push(null);
    cells[col] = value;
    col++;
  }
  return cells;
}

function colIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

function serialToIsoDate(serial: number): string {
  // Excel's day 0 is 1899-12-30 once its fictional 1900-02-29 is accounted for.
  const ms = Math.round((serial - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

function decodeXml(s: string): string {
  if (s.indexOf('&') === -1 && s.indexOf('_x') === -1) return s;
  return s
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
      switch (e) {
        case 'amp': return '&';
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return "'";
        default:
          return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      }
    });
}
