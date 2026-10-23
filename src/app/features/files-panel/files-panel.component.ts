import { Component, computed, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TooltipModule } from 'primeng/tooltip';
import { DataService, FileMeta } from '../../core/data.service';
import { formatNumber } from '../../core/format';
import { headerKey } from '../../core/schema';

interface FileRow extends FileMeta {
  warning: string | null;
}

@Component({
  selector: 'app-files-panel',
  imports: [ButtonModule, ProgressSpinnerModule, TooltipModule],
  templateUrl: './files-panel.component.html',
  styleUrl: './files-panel.component.scss',
})
export class FilesPanelComponent {
  protected data = inject(DataService);
  protected dragging = signal(false);
  protected formatNumber = formatNumber;

  protected totalRows = computed(() => this.data.files().reduce((n, f) => n + f.rowCount, 0));

  /** Files annotated with how their columns differ from the most common layout. */
  protected fileRows = computed<FileRow[]>(() => {
    const files = this.data.files();
    const signature = (f: FileMeta) => f.headers.map(headerKey).sort().join('|');
    const counts = new Map<string, number>();
    for (const f of files) counts.set(signature(f), (counts.get(signature(f)) ?? 0) + 1);
    const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const reference = files.find((f) => signature(f) === common);

    return files.map((f) => {
      if (!reference || signature(f) === common) return { ...f, warning: null };
      const mine = new Set(f.headers.map(headerKey));
      const theirs = new Set(reference.headers.map(headerKey));
      const missing = reference.headers.filter((h) => !mine.has(headerKey(h)));
      const extra = f.headers.filter((h) => !theirs.has(headerKey(h)));
      const parts = [];
      if (missing.length) parts.push(`Missing: ${missing.join(', ')}`);
      if (extra.length) parts.push(`Extra: ${extra.join(', ')}`);
      return { ...f, warning: `Columns differ from most files. ${parts.join('. ')}` };
    });
  });

  protected onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(false);
    this.data.ingest([...(e.dataTransfer?.files ?? [])]);
  }

  protected onPick(input: HTMLInputElement): void {
    this.data.ingest([...(input.files ?? [])]);
    input.value = '';
  }

  protected remove(name: string): void {
    if (confirm(`Remove "${name}"?`)) this.data.deleteFile(name);
  }

  protected clearAll(): void {
    if (confirm('Remove all loaded files?')) this.data.clearAll();
  }
}
