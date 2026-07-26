# Power BI Tabulator

Convert between an editable table, DAX dynamic tables, and Power Query M — a static microapp on the [microapp-template](https://github.com/filcuk/microapp-template) design system.

## Features

- **Source / target switches** — Tabular, DAX, or M on each side (same language on both sides is not allowed)
- **Tabular input** — typed columns (text, number, logical), paste from Excel/TSV (in-place or replace whole table)
- **DAX dialects** — `DATATABLE()`, table constructor via `SELECTCOLUMNS` + `{}`, and `UNION` / `ROW`
- **M dialects** — `#table`, `Table.FromRecords`, and Enter Data–style `Binary.FromText` + `Binary.Decompress`

## Quick start

```bash
npm ci
npm run lint
npm test
npx serve .
```

Then open `http://localhost:3000`. CI (`.github/workflows/ci.yml`) runs lint and tests on push and pull requests.

## Documentation

| Guide | Contents |
| ----- | -------- |
| **[USAGE.md](USAGE.md)** | Template layout, GitHub Pages, and component catalogue |
| **[AGENTS.md](AGENTS.md)** | Rules for AI assistants working in this repo |
| **[DISCLAIMER.md](DISCLAIMER.md)** | LLM assistance notice |

## Stack

- Plain HTML, CSS custom properties, and ES modules
- Light / dark / system theme with flash-free `theme-init.js`
- Shared page chrome (footer, theme toggle, page nav) via `initShell()`
- Deployed with GitHub Actions to GitHub Pages

## License

MIT - see [LICENSE](LICENSE).
