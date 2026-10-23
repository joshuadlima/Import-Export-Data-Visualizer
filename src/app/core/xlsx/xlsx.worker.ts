/// <reference lib="webworker" />

import { parseXlsx } from './parse-xlsx';

export interface ParseRequest {
  id: number;
  buffer: ArrayBuffer;
}

export type ParseResponse =
  | { id: number; ok: true; headers: string[]; rows: (string | number | null)[][] }
  | { id: number; ok: false; error: string };

addEventListener('message', ({ data }: MessageEvent<ParseRequest>) => {
  let response: ParseResponse;
  try {
    response = { id: data.id, ok: true, ...parseXlsx(new Uint8Array(data.buffer)) };
  } catch (e) {
    response = { id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  postMessage(response);
});
