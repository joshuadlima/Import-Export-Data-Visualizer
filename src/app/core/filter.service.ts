import { Injectable, computed, inject, signal } from '@angular/core';
import { DataService } from './data.service';
import { KNOWN, PERIOD, Row } from './schema';

/** Keep rows whose value in `col` is one of `values`. */
export interface ValuesFilter {
  kind: 'values';
  col: number;
  values: string[];
}

/** Keep rows whose numeric value in `col` lies within [min, max]; either bound may be open. */
export interface RangeFilter {
  kind: 'range';
  col: number;
  min: number | null;
  max: number | null;
}

export type ColumnFilter = ValuesFilter | RangeFilter;

export interface Sort {
  col: number;
  dir: 1 | -1;
}

export interface Totals {
  count: number;
  usd: number | null;
  /** Quantity summed per unit (PCS, NOS...), largest first. Empty when there is no quantity column. */
  quantity: { unit: string; sum: number }[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Text form of a cell, as used by value filters, grouping and the value pickers. Empty cells become ''. */
export function cellText(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

@Injectable({ providedIn: 'root' })
export class FilterService {
  private data = inject(DataService);

  /** Selected periods ('YYYY-MM'); empty means all. */
  readonly periods = signal<string[]>([]);
  /** Case-insensitive substring match on the item description. */
  readonly search = signal('');
  /** Comma/space separated HS code prefixes, e.g. '850211, 850213'. */
  readonly hsPrefix = signal('');
  readonly columnFilters = signal<ColumnFilter[]>([]);
  readonly sort = signal<Sort | null>(null);

  readonly periodOptions = computed(() => {
    const set = new Set<string>();
    for (const r of this.data.rows()) if (r[PERIOD]) set.add(r[PERIOD] as string);
    return [...set].sort().reverse();
  });

  readonly activeCount = computed(
    () =>
      (this.periods().length ? 1 : 0) +
      (this.search().trim() ? 1 : 0) +
      (this.hsPrefix().trim() ? 1 : 0) +
      this.columnFilters().filter(isActive).length,
  );

  readonly filteredRows = computed(() => {
    const rows = this.data.rows();
    const tests: ((r: Row) => boolean)[] = [];

    const periods = new Set(this.periods());
    if (periods.size) tests.push((r) => periods.has(r[PERIOD] as string));

    const search = this.search().trim().toLowerCase();
    const descCol = this.data.col(KNOWN.description);
    if (search && descCol >= 0) tests.push((r) => cellText(r[descCol]).toLowerCase().includes(search));

    const prefixes = this.hsPrefix().split(/[\s,;]+/).filter(Boolean);
    const hsCol = this.data.col(KNOWN.hsCode);
    if (prefixes.length && hsCol >= 0) {
      tests.push((r) => {
        const code = cellText(r[hsCol]);
        return prefixes.some((p) => code.startsWith(p));
      });
    }

    for (const f of this.columnFilters()) {
      if (!isActive(f)) continue;
      if (f.kind === 'values') {
        const values = new Set(f.values);
        tests.push((r) => values.has(cellText(r[f.col])));
      } else {
        const { col, min, max } = f;
        tests.push((r) => {
          const v = r[col];
          return typeof v === 'number' && (min === null || v >= min) && (max === null || v <= max);
        });
      }
    }

    if (!tests.length) return rows;
    return rows.filter((r) => tests.every((t) => t(r)));
  });

  readonly sortedRows = computed(() => {
    const rows = this.filteredRows();
    const sort = this.sort();
    if (!sort) return rows;
    const { col, dir } = sort;
    // Empty cells always sort last.
    return [...rows].sort((a, b) => {
      const x = a[col] ?? null;
      const y = b[col] ?? null;
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return collator.compare(String(x), String(y)) * dir;
    });
  });

  readonly totals = computed<Totals>(() => totalsOf(this.filteredRows(), this.data));

  toggleSort(col: number): void {
    const s = this.sort();
    if (s?.col !== col) this.sort.set({ col, dir: 1 });
    else if (s.dir === 1) this.sort.set({ col, dir: -1 });
    else this.sort.set(null);
  }

  addFilter(col: number): void {
    if (this.columnFilters().some((f) => f.col === col)) return;
    const filter: ColumnFilter =
      this.data.columnTypes()[col] === 'number'
        ? { kind: 'range', col, min: null, max: null }
        : { kind: 'values', col, values: [] };
    this.columnFilters.update((fs) => [...fs, filter]);
  }

  /** Restricts `col` to exactly `value`, creating the filter if needed (used by group-by drill-down). */
  filterTo(col: number, value: string): void {
    if (col === PERIOD) {
      this.periods.set(value ? [value] : []);
      return;
    }
    const filter: ValuesFilter = { kind: 'values', col, values: [value] };
    this.columnFilters.update((fs) =>
      fs.some((f) => f.col === col) ? fs.map((f) => (f.col === col ? filter : f)) : [...fs, filter],
    );
  }

  updateFilter(col: number, patch: Partial<ValuesFilter> | Partial<RangeFilter>): void {
    this.columnFilters.update((fs) => fs.map((f) => (f.col === col ? ({ ...f, ...patch } as ColumnFilter) : f)));
  }

  removeFilter(col: number): void {
    this.columnFilters.update((fs) => fs.filter((f) => f.col !== col));
  }

  clearAll(): void {
    this.periods.set([]);
    this.search.set('');
    this.hsPrefix.set('');
    this.columnFilters.set([]);
  }
}

function isActive(f: ColumnFilter): boolean {
  return f.kind === 'values' ? f.values.length > 0 : f.min !== null || f.max !== null;
}

export function totalsOf(rows: Row[], data: DataService): Totals {
  const usdCol = data.col(KNOWN.totalUsd);
  const qtyCol = data.col(KNOWN.quantity);
  const unitCol = data.col(KNOWN.unit);

  let usd = 0;
  const qty = new Map<string, number>();
  for (const r of rows) {
    if (usdCol >= 0) {
      const v = r[usdCol];
      if (typeof v === 'number') usd += v;
    }
    if (qtyCol >= 0) {
      const q = r[qtyCol];
      if (typeof q === 'number') {
        const unit = unitCol >= 0 ? cellText(r[unitCol]) || '?' : '';
        qty.set(unit, (qty.get(unit) ?? 0) + q);
      }
    }
  }
  return {
    count: rows.length,
    usd: usdCol >= 0 ? usd : null,
    quantity: [...qty].map(([unit, sum]) => ({ unit, sum })).sort((a, b) => b.sum - a.sum),
  };
}
