import type { Cell } from './xlsx/parse-xlsx';

export type { Cell };

/** One data row, indexed by global column index (see DataService.columns). Missing trailing cells read as null. */
export type Row = Cell[];

export type ColumnType = 'number' | 'text';

/** Columns the app adds to every row; they always occupy the first indexes. */
export const PERIOD = 0;
export const SOURCE_FILE = 1;
export const DERIVED_COLUMNS = ['Period', 'Source File'];

/** Header keys (see headerKey) of columns the app gives special meaning to. Missing ones just disable that feature. */
export const KNOWN = {
  month: 'month',
  shipmentDate: 'shipment_date',
  totalUsd: 'total value usd',
  quantity: 'quantity',
  unit: 'uqc',
  hsCode: 'ritc_code',
  description: 'item_description',
} as const;

export const DEFAULT_VISIBLE = [
  'period', 'country', 'exporter_name', 'consignee name', 'ritc_code',
  'item_description', 'quantity', 'uqc', 'total value usd',
];

/** Normalised form used to match the same column across files. */
export function headerKey(header: string): string {
  return header.trim().replace(/\s+/g, ' ').toLowerCase();
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * 'YYYY-MM' for a row, taken from the Month cell (e.g. 'DEC--2025'), else the shipment date,
 * else the file name (e.g. '... DEC 25.xlsx'). Null when none of them say.
 */
export function periodOf(month: Cell, shipmentDate: Cell, fileName: string): string | null {
  return (
    (typeof month === 'string' && monthYear(month)) ||
    (typeof shipmentDate === 'string' && /^\d{4}-\d{2}/.test(shipmentDate) && shipmentDate.slice(0, 7)) ||
    monthYear(fileName.replace(/\.xlsx$/i, '')) ||
    null
  );
}

function monthYear(s: string): string | null {
  const m = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-_'.]*(\d{4}|\d{2})\b/i.exec(s);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toUpperCase()) + 1;
  const year = m[2].length === 2 ? 2000 + +m[2] : +m[2];
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function formatPeriod(period: string): string {
  const [y, m] = period.split('-');
  return `${MONTHS[+m - 1] ?? m} ${y}`;
}
