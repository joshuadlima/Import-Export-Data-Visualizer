const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const compactUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });

export const formatNumber = (n: number) => number.format(n);
export const formatUsd = (n: number) => usd.format(n);
export const formatUsdCompact = (n: number) => compactUsd.format(n);

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'number' ? number.format(v) : String(v);
}
