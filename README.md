# Trade Data Explorer

A fully client-side app for exploring monthly import/export `.xlsx` reports. Drop in as many files as you like, then filter, group and export the combined data. Nothing leaves your browser.

## Running

```bash
npm install
npm start          # http://localhost:4200
npm run build      # static files in dist/import-export-visualizer/browser, host anywhere
```

## Deploying

Pushing to `main` builds and publishes the site to GitHub Pages via [.github/workflows/deploy.yml](.github/workflows/deploy.yml). One-time setup: in the repo go to **Settings → Pages → Source** and choose **GitHub Actions**. The site is then at `https://<user>.github.io/<repo>/`.

## Features

- **Upload** many `.xlsx` files at once (parsed in background workers). Re-uploading a file with the same name replaces it.
- **Saved in the browser** (IndexedDB), so files survive a refresh. Remove files one at a time or all at once.
- **Filters:** period, item description text, HS code prefix, plus a filter on any column: pick values for text columns, min/max for numeric ones.
- **Rows view:** choose visible columns, sort by clicking a header, click a row to see every field. Totals show row count, total USD value and quantity per unit.
- **Group by** any column for count, total USD, share and quantity per group. Click a group to filter to it.
- **CSV export** of the filtered rows and visible columns.

## How files are read

- Only the first sheet of each workbook is read, and its first row is the header.
- Columns are matched across files by header name (case-insensitive). If a file's columns differ from most others, a warning icon in the file list shows what's missing or extra.
- `Period` (YYYY-MM) comes from the `Month` column (e.g. `DEC--2025`), else `Shipment_Date`, else the file name (e.g. `... DEC 25.xlsx`).
- Totals and group-by rely on the `Total Value USD`, `Quantity` and `UQC` columns. The description and HS code filters rely on `Item_Description` and `RITC_Code`. See `KNOWN` in [src/app/core/schema.ts](src/app/core/schema.ts).

## Code layout

```
src/app/
  core/
    xlsx/parse-xlsx.ts      xlsx reader (string scanning; skips empty formatted rows cheaply)
    xlsx/xlsx.worker.ts     runs the reader off the main thread
    schema.ts               derived columns, known column names, period parsing
    storage.service.ts      IndexedDB persistence
    data.service.ts         worker pool, ingest, in-memory rows and columns
    filter.service.ts       filter state, filtered/sorted rows, totals
    csv.ts, format.ts
  features/
    files-panel/            upload + file list
    filters-panel/
    rows-view/
    group-by-view/
```
