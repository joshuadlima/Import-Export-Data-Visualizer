import { Injectable, computed, inject, signal } from '@angular/core';
import { ColumnType, DERIVED_COLUMNS, KNOWN, PERIOD, Row, SOURCE_FILE, headerKey, periodOf } from './schema';
import { StorageService, StoredFile } from './storage.service';
import type { ParseRequest, ParseResponse } from './xlsx/xlsx.worker';

export interface FileMeta {
  name: string;
  uploadedAt: number;
  rowCount: number;
  headers: string[];
}

export interface Job {
  name: string;
  status: 'queued' | 'parsing' | 'error';
  error?: string;
}

const MAX_WORKERS = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));

/**
 * Holds every loaded row in memory and handles uploads.
 *
 * Columns are the union of all file headers, matched by name and appended in order of
 * first appearance, so a row's indexes never shift when new files bring new columns.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private storage = inject(StorageService);

  readonly columns = signal<string[]>([...DERIVED_COLUMNS]);
  readonly rows = signal<Row[]>([]);
  readonly files = signal<FileMeta[]>([]);
  readonly jobs = signal<Job[]>([]);
  readonly loading = signal(true);

  /** headerKey -> column index */
  private keyIndex = new Map<string, number>(DERIVED_COLUMNS.map((c, i) => [headerKey(c), i]));
  private columnNames: string[] = [...DERIVED_COLUMNS];
  private columnIndex = computed(() => {
    this.columns();
    return new Map(this.keyIndex);
  });

  /** A column is numeric when every non-empty value in it is a number. */
  readonly columnTypes = computed<ColumnType[]>(() => {
    const rows = this.rows();
    return this.columns().map((_, c) => {
      let seen = false;
      for (const r of rows) {
        const v = r[c];
        if (v === null || v === undefined) continue;
        if (typeof v !== 'number') return 'text';
        seen = true;
      }
      return seen ? 'number' : 'text';
    });
  });

  /** Interned strings, so repeated values (countries, exporters...) are stored once. */
  private strings = new Map<string, string>();

  private queue: { id: number; file: File }[] = [];
  private nextId = 0;
  private idle: Worker[] = [];
  private workerCount = 0;
  private inFlight = 0;
  private parsed: StoredFile[] = [];

  constructor() {
    this.storage
      .getAll()
      .then((stored) => this.commit(stored))
      .catch((e) => console.error('Could not load saved files', e))
      .finally(() => this.loading.set(false));
  }

  /** Index of a column by (case-insensitive) header name, or -1. */
  col(name: string): number {
    return this.columnIndex().get(headerKey(name)) ?? -1;
  }

  ingest(files: File[]): void {
    const accepted = files.filter((f) => /\.xlsx$/i.test(f.name));
    if (!accepted.length) return;
    this.jobs.update((jobs) => [
      ...jobs.filter((j) => !accepted.some((f) => f.name === j.name)),
      ...accepted.map((f) => ({ name: f.name, status: 'queued' as const })),
    ]);
    for (const file of accepted) this.queue.push({ id: this.nextId++, file });
    this.pump();
  }

  dismissJob(name: string): void {
    this.jobs.update((jobs) => jobs.filter((j) => j.name !== name));
  }

  async deleteFile(name: string): Promise<void> {
    await this.storage.delete(name);
    this.rows.update((rows) => rows.filter((r) => r[SOURCE_FILE] !== name));
    this.files.update((files) => files.filter((f) => f.name !== name));
  }

  async clearAll(): Promise<void> {
    await this.storage.clear();
    this.strings.clear();
    this.keyIndex = new Map(DERIVED_COLUMNS.map((c, i) => [headerKey(c), i]));
    this.columnNames = [...DERIVED_COLUMNS];
    this.columns.set([...DERIVED_COLUMNS]);
    this.rows.set([]);
    this.files.set([]);
  }

  private pump(): void {
    while (this.queue.length) {
      const worker = this.idle.pop() ?? (this.workerCount < MAX_WORKERS ? this.createWorker() : null);
      if (!worker) return;
      const job = this.queue.shift()!;
      this.inFlight++;
      this.setJob(job.file.name, { status: 'parsing' });
      this.run(worker, job.id, job.file);
    }
  }

  private createWorker(): Worker {
    this.workerCount++;
    return new Worker(new URL('./xlsx/xlsx.worker', import.meta.url), { type: 'module' });
  }

  private async run(worker: Worker, id: number, file: File): Promise<void> {
    let result: ParseResponse;
    try {
      const buffer = await file.arrayBuffer();
      result = await new Promise<ParseResponse>((resolve) => {
        worker.onmessage = (e: MessageEvent<ParseResponse>) => resolve(e.data);
        worker.onerror = (e) => resolve({ id, ok: false, error: e.message || 'Worker crashed' });
        worker.postMessage({ id, buffer } satisfies ParseRequest, [buffer]);
      });
    } catch (e) {
      result = { id, ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    if (result.ok && !result.rows.length) result = { id, ok: false, error: 'No data rows found' };
    if (result.ok) {
      const stored: StoredFile = { name: file.name, uploadedAt: Date.now(), headers: result.headers, rows: result.rows };
      try {
        await this.storage.put(stored);
        this.parsed.push(stored);
        this.dismissJob(file.name);
      } catch (e) {
        this.setJob(file.name, { status: 'error', error: `Could not save: ${e instanceof Error ? e.message : e}` });
      }
    } else {
      this.setJob(file.name, { status: 'error', error: result.error });
    }

    this.idle.push(worker);
    this.inFlight--;
    this.pump();
    // Rebuilding the row list is the expensive part, so do it once per upload batch.
    if (this.inFlight === 0 && !this.queue.length) {
      const batch = this.parsed;
      this.parsed = [];
      this.commit(batch);
    }
  }

  /** Adds (or replaces, by file name) files in memory. */
  private commit(batch: StoredFile[]): void {
    if (!batch.length) return;
    const replaced = new Set(batch.map((f) => f.name));
    const rows = this.rows().filter((r) => !replaced.has(r[SOURCE_FILE] as string));
    const files = this.files().filter((f) => !replaced.has(f.name));

    for (const file of batch) {
      const map = uniqueHeaders(file.headers).map((h) => this.columnFor(h));
      const fk = file.headers.map(headerKey);
      const monthAt = fk.indexOf(KNOWN.month);
      const dateAt = fk.indexOf(KNOWN.shipmentDate);
      const name = this.intern(file.name);
      for (const raw of file.rows) {
        const row: Row = new Array(this.keyIndex.size).fill(null);
        row[PERIOD] = this.intern(periodOf(raw[monthAt] ?? null, raw[dateAt] ?? null, file.name));
        row[SOURCE_FILE] = name;
        for (let i = 0; i < raw.length; i++) row[map[i]] = this.intern(raw[i]);
        rows.push(row);
      }
      files.push({ name: file.name, uploadedAt: file.uploadedAt, rowCount: file.rows.length, headers: file.headers });
    }

    files.sort((a, b) => a.name.localeCompare(b.name));
    this.columns.set([...this.columnNames]);
    this.rows.set(rows);
    this.files.set(files);
  }

  private columnFor(header: string): number {
    const key = headerKey(header);
    let idx = this.keyIndex.get(key);
    if (idx === undefined) {
      idx = this.keyIndex.size;
      this.keyIndex.set(key, idx);
      this.columnNames[idx] = header.trim();
    }
    return idx;
  }

  private intern<T extends string | number | null>(v: T): T {
    if (typeof v !== 'string') return v;
    let s = this.strings.get(v);
    if (s === undefined) this.strings.set(v, (s = v));
    return s as T;
  }

  private setJob(name: string, patch: Partial<Job>): void {
    this.jobs.update((jobs) => jobs.map((j) => (j.name === name ? { ...j, ...patch } : j)));
  }
}

/** Renames repeated headers within one file ("Name", "Name (2)") so they map to separate columns. */
function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h) => {
    const n = (seen.get(headerKey(h)) ?? 0) + 1;
    seen.set(headerKey(h), n);
    return n === 1 ? h : `${h} (${n})`;
  });
}
