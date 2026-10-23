import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { DataService } from '../../core/data.service';
import { FilterService, cellText } from '../../core/filter.service';
import { formatNumber } from '../../core/format';
import { PERIOD, formatPeriod } from '../../core/schema';

interface Option {
  label: string;
  value: string;
}

@Component({
  selector: 'app-filters-panel',
  imports: [FormsModule, ButtonModule, InputNumberModule, InputTextModule, MultiSelectModule, SelectModule],
  templateUrl: './filters-panel.component.html',
  styleUrl: './filters-panel.component.scss',
})
export class FiltersPanelComponent {
  protected data = inject(DataService);
  protected filters = inject(FilterService);

  protected periodOptions = computed<Option[]>(() =>
    this.filters.periodOptions().map((p) => ({ label: formatPeriod(p), value: p })),
  );

  /** Columns that can still get a filter (Period has its own control). */
  protected addableColumns = computed(() => {
    const used = new Set(this.filters.columnFilters().map((f) => f.col));
    return this.data
      .columns()
      .map((name, index) => ({ name, index }))
      .filter((c) => c.index !== PERIOD && !used.has(c.index));
  });

  /** Per-column value lists, rebuilt lazily whenever the data changes. */
  private optionsCache = computed(() => {
    this.data.rows();
    return new Map<number, Option[]>();
  });

  protected options(col: number): Option[] {
    const cache = this.optionsCache();
    let options = cache.get(col);
    if (!options) {
      const counts = new Map<string, number>();
      for (const r of this.data.rows()) {
        const v = cellText(r[col]);
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      options = [...counts]
        .sort((a, b) => b[1] - a[1])
        .map(([value, n]) => ({ label: `${value || '(empty)'} (${formatNumber(n)})`, value }));
      cache.set(col, options);
    }
    return options;
  }

  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  // Text filters apply after typing pauses, so each keystroke doesn't re-filter everything.
  protected setSearch(v: string): void {
    this.debounce('search', () => this.filters.search.set(v));
  }

  protected setHsPrefix(v: string): void {
    this.debounce('hs', () => this.filters.hsPrefix.set(v));
  }

  private debounce(key: string, apply: () => void): void {
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(apply, 250));
  }

  protected addFilter(col: number | null): void {
    if (col !== null) this.filters.addFilter(col);
  }
}
