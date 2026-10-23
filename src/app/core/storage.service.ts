import { Injectable } from '@angular/core';
import { openDB } from 'idb';
import type { Cell } from './schema';

export interface StoredFile {
  name: string;
  uploadedAt: number;
  headers: string[];
  rows: Cell[][];
}

/** Parsed files kept in IndexedDB, one record per file name. */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private db = openDB('ie-visualizer', 1, {
    upgrade(db) {
      db.createObjectStore('files', { keyPath: 'name' });
    },
  });

  constructor() {
    // Ask the browser not to evict our data under storage pressure. Best effort.
    navigator.storage?.persist?.().catch(() => {});
  }

  async getAll(): Promise<StoredFile[]> {
    return (await this.db).getAll('files');
  }

  async put(file: StoredFile): Promise<void> {
    await (await this.db).put('files', file);
  }

  async delete(name: string): Promise<void> {
    await (await this.db).delete('files', name);
  }

  async clear(): Promise<void> {
    await (await this.db).clear('files');
  }
}
