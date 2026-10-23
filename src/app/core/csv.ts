import type { Row } from './schema';

/** Downloads rows as a CSV (UTF-8 with BOM so Excel shows non-ASCII text correctly). */
export function downloadCsv(fileName: string, headers: string[], cols: number[], rows: Row[]): void {
  const lines = [headers.map(escape).join(',')];
  for (const r of rows) lines.push(cols.map((c) => escape(r[c])).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function escape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
