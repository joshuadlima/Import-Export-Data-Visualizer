import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { DataService } from '../../core/data.service';
import { FilterService, cellText, totalsOf } from '../../core/filter.service';
import { formatNumber, formatUsd } from '../../core/format';
import { PERIOD, Row, formatPeriod, headerKey } from '../../core/schema';

interface Group {
  key: string;
  label: string;
  count: number;
  usd: number;
  share: number;
  quantity: string;
}

@Component({
  selector: 'app-group-by-view',
  imports: [FormsModule, SelectModule, TableModule],
  templateUrl: './group-by-view.component.html',
  styleUrl: './group-by-view.component.scss',
})
export class GroupByViewComponent {
  protected data = inject(DataService);
  protected filters = inject(FilterService);
  protected formatNumber = formatNumber;
  protected formatUsd = formatUsd;

  /** Emitted after a group is clicked and applied as a filter. */
  readonly drilledDown = output<void>();

  /** Grouping column, by header key so the choice survives data reloads. */
  protected groupKey = signal('country');

  protected columnOptions = computed(() => this.data.columns().map((name) => ({ name, key: headerKey(name) })));

  protected groupCol = computed(() => {
    const col = this.data.col(this.groupKey());
    return col >= 0 ? col : PERIOD;
  });

  protected groups = computed<Group[]>(() => {
    const col = this.groupCol();
    const buckets = new Map<string, Row[]>();
    for (const r of this.filters.filteredRows()) {
      const key = cellText(r[col]);
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, (bucket = []));
      bucket.push(r);
    }

    const total = this.filters.totals().usd ?? 0;
    return [...buckets].map(([key, rows]) => {
      const t = totalsOf(rows, this.data);
      return {
        key,
        label: !key ? '(empty)' : col === PERIOD ? formatPeriod(key) : key,
        count: t.count,
        usd: t.usd ?? 0,
        share: total ? (t.usd ?? 0) / total : 0,
        quantity: t.quantity.map((q) => `${formatNumber(q.sum)} ${q.unit}`).join(', '),
      };
    });
  });

  protected drillDown(group: Group): void {
    this.filters.filterTo(this.groupCol(), group.key);
    this.drilledDown.emit();
  }
}
