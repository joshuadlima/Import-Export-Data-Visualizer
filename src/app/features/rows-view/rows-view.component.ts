import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { MultiSelectModule } from 'primeng/multiselect';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { downloadCsv } from '../../core/csv';
import { DataService } from '../../core/data.service';
import { FilterService } from '../../core/filter.service';
import { formatCell, formatNumber, formatUsd } from '../../core/format';
import { DEFAULT_VISIBLE, KNOWN, Row, headerKey } from '../../core/schema';

const STORAGE_KEY = 'visibleColumns';

interface VisibleColumn {
  index: number;
  name: string;
  numeric: boolean;
  width: string;
}

@Component({
  selector: 'app-rows-view',
  imports: [FormsModule, ButtonModule, DrawerModule, MultiSelectModule, TableModule, TooltipModule],
  templateUrl: './rows-view.component.html',
  styleUrl: './rows-view.component.scss',
})
export class RowsViewComponent {
  protected data = inject(DataService);
  protected filters = inject(FilterService);
  protected formatCell = formatCell;
  protected formatNumber = formatNumber;
  protected formatUsd = formatUsd;

  /** Header keys of the chosen columns, remembered across sessions in this browser. */
  protected visibleKeys = signal<string[]>(loadVisible());

  protected columnOptions = computed(() => this.data.columns().map((name) => ({ name, key: headerKey(name) })));

  protected visibleColumns = computed<VisibleColumn[]>(() => {
    const keys = new Set(this.visibleKeys());
    const types = this.data.columnTypes();
    return this.data
      .columns()
      .map((name, index) => ({ name, index, key: headerKey(name) }))
      .filter((c) => keys.has(c.key))
      .map(({ name, index, key }) => ({
        name,
        index,
        numeric: types[index] === 'number',
        width: key === KNOWN.description ? '22rem' : types[index] === 'number' ? '9rem' : '13rem',
      }));
  });

  protected quantityTooltip = computed(() =>
    this.filters
      .totals()
      .quantity.map((q) => `${formatNumber(q.sum)} ${q.unit}`)
      .join('\n'),
  );

  protected selected = signal<Row | null>(null);

  protected setVisible(keys: string[]): void {
    this.visibleKeys.set(keys);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
    } catch {
      // Storage unavailable; the choice just won't be remembered.
    }
  }

  protected exportCsv(): void {
    const cols = this.visibleColumns();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `trade-data-${stamp}.csv`,
      cols.map((c) => c.name),
      cols.map((c) => c.index),
      this.filters.sortedRows(),
    );
  }
}

function loadVisible(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {
    // Fall through to defaults.
  }
  return DEFAULT_VISIBLE;
}
