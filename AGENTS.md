# AGENTS.md

## Project overview

A searchable Traditional-Chinese directory of Taiwan ETFs, published to GitHub Pages at
<https://allenchiwei.github.io/taiwan-etf/>. Data comes from TWSE/TPEx open data plus
MoneyDJ, refreshed by a weekday cron and committed back to the repo.

```
app/                    React 19 + TypeScript + Vite + Tailwind v4 — the site
  public/data/etfs.json   generated dataset, fetched at runtime
  src/lib/                pure logic (filters, sorting, formatting) — no React imports
  tests/                  node --test, exercises the real modules
scripts/                Python pipeline: scrape → etfs.json + legacy HTML
  fetch_chips.py          籌碼 (TAIFEX + TWSE/TPEx) → chips.json, built at deploy time
tools/                  dev helpers (headless screenshots, static server)
taiwan_etf_list.html    original single-file page, still served at its old URL
.github/workflows/      daily data update, Pages deploy
```

## Working conventions

- The React app in `app/` is the primary front end. `taiwan_etf_list.html` is in
  **maintenance mode**: keep it working, don't add features to it.
- All user-facing text is Traditional Chinese.
- Comments explain **why**, not what, in the language the surrounding file already uses.
- Preserve public names the verifiers and tests depend on: section ids (`cat-domestic`,
  `cat-foreign`, `cat-bond`, `cat-leveraged`, `cat-futures`, `cat-leveraged-futures`),
  the legacy page's `filterRows` / `resetFilters` / `scrollToTop` / `sortTable` functions
  and its `data-custodian` / `data-frequency` row attributes.

## Data

- **Never hand-edit `app/public/data/etfs.json` or the ETF rows in the legacy HTML.**
  Both are generated. Run the pipeline (see `.claude/skills/update-etf-list/SKILL.md`)
  or the `update-data` workflow.
- If a data feed is unreachable, stop and say so. A plausible-looking invented 保管銀行
  is worse than a missing row.
- Adding a payout frequency touches four places: `FREQ_CLASS`/`FREQ_ORDER` in
  `scripts/etfdata.py`, `PILL` in `app/src/lib/format.ts`, a `.pill-*` rule in
  `app/src/styles.css`, and `FreqLabel` in `app/src/types.ts`.
- Adding a numeric column touches `RETURN_PERIODS` (etfdata.py), `PERIOD_KEY`
  (build_data.py), `NUMERIC_COLUMNS` (app/src/components/columns.ts), `NUMERIC_LABEL`
  (format.ts), `NumericKey`/`Etf` (types.ts), `SORTABLE` (useFilterState.ts),
  `SORT_OPTIONS` (FilterBar.tsx), plus the legacy page's header, `NCELLS` in
  verify_page.py and its mobile `nth-child` block.

- 籌碼 (`chips.json`) is a daily snapshot built at deploy time and **not in version
  control**. Institutional buy/sell **amounts are estimates** — the exchanges publish
  share counts only; the pipeline multiplies by that day's average price (turnover ÷
  volume). Never present them as actual amounts.
- TPEx's institutional table repeats the same field names for all seven investor types,
  so columns are taken by position and checked against the published three-institution
  total on every run. If that check warns, the columns moved — fix the indices, don't
  silence it.

## Conventions that are deliberate

- **紅漲綠跌**: gains are red, losses green — the Taiwan convention, opposite of the US one.
- Returns are 市價 (market price), cumulative not annualised; `N/A` means the fund is
  younger than that period.
- 殖利率 `N/A` is ambiguous at source (no distribution vs. hasn't distributed yet); the
  配息 column is what distinguishes them. Don't infer one from the other.
- Section row counts are static and do not change while filtering.

## Verification

```bash
cd app && npm test                                      # 篩選/排序/顏色，含真實資料檢查
cd app && npm run build                                 # tsc -b && vite build
python scripts/verify_data.py app/public/data/etfs.json
python scripts/fetch_chips.py .cache/chips.json          # 籌碼管線（會打外部端點）
python scripts/verify_page.py taiwan_etf_list.html
node scripts/test_sort.js taiwan_etf_list.html
```

For layout and interaction, use `tools/shot.mjs` (DevTools-Protocol screenshots; reports
horizontal overflow and page exceptions) served by `tools/serve.py`. Do not use Chrome's
`--screenshot` with `--window-size` on Windows and do not serve with `python -m http.server`
— both produce misleading results; `CLAUDE.md` explains why.
