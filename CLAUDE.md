# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A searchable Traditional-Chinese directory of Taiwan and US ETFs, published at
<https://allenchiwei.github.io/taiwan-etf/>. Refreshed on a weekday cron and committed back.

Where each field comes from, because it is not one source:

| Field | Source |
| --- | --- |
| Taiwan ETF list | TWSE + TPEx open data (+ a FinMind sweep for stragglers) |
| Taiwan returns (3m/6m/1y/3y/5y) | computed from FinLab `etl:adj_close` — **total return** |
| Taiwan 保管銀行 / 配息頻率 / 殖利率 | MoneyDJ `Basic0004` — no FinLab equivalent exists |
| US ETF list | Nasdaq Trader's public symbol file ∩ FinLab price matrix |
| US returns | computed from FinLab `us_fund_price` — **price return only**, see below |

MoneyDJ's `Basic0008` returns scrape was dropped in favour of FinLab, halving the daily
request count against them (718 pages → 359). Their robots.txt says data mining without
consent is not allowed, so taking less matters.

```
app/                       React 19 + TypeScript + Vite + Tailwind v4 — the site
  public/data/etfs.json      the dataset the app fetches at runtime (generated)
  src/lib/                   pure logic: filters, sorting, formatting (Node-testable)
  src/components/            presentation
  src/routes/                one file per page
  tests/                     node --test, runs the real modules
scripts/                   the Python data pipeline (scrape → JSON + legacy HTML)
tools/                     dev helpers: headless screenshots, static server
taiwan_etf_list.html       the original single-file page, still live at its old URL
.github/workflows/         daily data update + Pages deploy
.claude/skills/            the update-etf-list skill (docs; its scripts live in scripts/)
```

**Two front ends exist on purpose, for now.** The React app is the primary site; the
single-file page is kept working at `/taiwan_etf_list.html` so existing links and bookmarks
don't break. One pipeline run updates both, and CI verifies both. When the React app has
been stable for a while, dropping the legacy page is a one-line change in `deploy.yml`
plus deleting the file and its three scripts.

## Verify changes

```bash
cd app && npm test          # 篩選/排序/顏色慣例，含對真實 etfs.json 的檢查
cd app && npm run build     # tsc -b && vite build
python scripts/verify_data.py app/public/data/etfs.json
python scripts/verify_page.py taiwan_etf_list.html
node scripts/test_sort.js taiwan_etf_list.html
```

Visual and interaction checks go through `tools/shot.mjs` (see **Verifying mobile** below)
rather than by opening a browser by hand.

## Data

`app/public/data/etfs.json` is the single source of truth for both front ends:

```jsonc
{
  "meta": { "updated": "2026-09-13", "snapshot": "09/12", "total": 359, "source": "…" },
  "sections":    [ { "id": "cat-domestic", "title": "台股ETF", "count": 87 }, … ],
  "custodians":  ["上海商業儲蓄銀行", …],        // 篩選選項，必須涵蓋所有 etfs[].cust
  "frequencies": ["月配", "雙月配", …, "—"],
  "etfs": [ { "code": "0050", "name": "元大台灣50", "cust": "…", "freq": "半年配",
              "yield": "1.49", "r3": "8.52", "r6": "38.56", "r12": "98.17",
              "r36": "…", "sec": "cat-domestic" } ]
}
```

**Never hand-edit it.** `scripts/build_data.py` writes it; `scripts/verify_data.py` is the
gate that stops a half-failed scrape from overwriting good data (it fails on vanished rows,
a >5% drop in total, an all-N/A column, or a custodian/frequency with no filter option).

Six sections, fixed order: `cat-domestic` 台股 · `cat-foreign` 海外 · `cat-bond` 債券 ·
`cat-leveraged` 槓桿/反向 · `cat-futures` 期貨 · `cat-leveraged-futures` 槓桿期貨.
The header's "槓桿/期貨" stat is the sum of the last three.

**Existing codes keep their section.** `build_data.py` reads the previous JSON and only
classifies codes that are new, which preserves curated calls like `00735 國泰臺韓科技`
sitting in 海外 despite MoneyDJ reporting 投資區域 = 台灣. `verify_data.py` fails if a row
changes section.

### Conventions that are not bugs

- **紅漲綠跌.** `.text-up` is red, `.text-down` is green — the Taiwan convention, the
  opposite of the US one. `returnTone()` in `app/src/lib/format.ts` owns it. Don't "fix" it.
- **Returns are 市價 (market price), not NAV**, and are cumulative, not annualised.
  `N/A` means the fund is younger than the period.
- **殖利率 `N/A` is ambiguous at source**: either the fund makes no distribution, or it pays
  but hasn't distributed yet. The 配息 column (`—` vs a frequency) is what tells them apart;
  don't try to infer one from the other.

## Updating the data

Use the `update-etf-list` skill. In CI it is `.github/workflows/update-data.yml`, weekdays
at 19:00 Taiwan time (11:00 UTC — the cron is in UTC, so Taiwan time minus 8 hours). It
scrapes, rebuilds both front ends, runs every verifier, and only then commits and calls the
deploy workflow.

A commit pushed with `GITHUB_TOKEN` does **not** trigger `push` workflows, which is why
`update-data.yml` calls `deploy.yml` via `workflow_call` instead of relying on the push.

**Newly listed ETFs are picked up automatically.** `fetch_universe.py` re-queries TWSE,
TPEx and the FinMind sweep on every run rather than reading a stored list, so a fund that
listed yesterday appears without anyone editing anything. `build_data.py` classifies codes
it has not seen before with the rule in `etfdata.section()`; `scripts/diff_listings.py`
names them in the daily commit message so `git log` answers "when did this show up?".
Delistings are the asymmetric case: `verify_data.py` **fails** on a row that vanished,
because that is far more often a broken scrape than a real delisting.

`scripts/etfdata.py` holds all the judgment: bank-name normalisation (`CUST_NORM`), section
rules, payout labels, return periods. A new payout label needs `FREQ_CLASS`/`FREQ_ORDER`
there, `PILL` in `app/src/lib/format.ts`, a `.pill-*` rule in `app/src/styles.css`, and
`FreqLabel` in `app/src/types.ts` — `build_data.py` refuses to write rather than emit an
unstyled pill.

## The React app

No state management library: filter state lives in the URL (TanStack Router search params,
hash history because GitHub Pages has no SPA fallback), data lives in one context, and
favourites live in `localStorage`.

- `src/api/etfs.ts` is the **only** place that knows where data comes from. Phase 2 (a real
  backend) replaces that one module; components don't change.
- `src/lib/` is pure and has no React imports, so `tests/` runs the real functions under
  `node --test`. Those modules use explicit `.ts` extensions in their relative imports —
  Vite doesn't need it but Node's ESM does.
- Desktop renders `EtfTable`, phones render `EtfCards`; `useIsMobile()` picks one so 359 rows
  aren't in the DOM twice. Both read `NUMERIC_COLUMNS` from `components/columns.ts`, so a new
  numeric column appears in both.
- Sorting flattens the sections (`flat={Boolean(sort)}`) — otherwise it looks like it only
  sorted within one category.

### Verifying mobile

```bash
python tools/serve.py . 8785 &
node tools/shot.mjs http://127.0.0.1:8785/… out.png 390x844 --dsf=2 --js=probe.js
```

`tools/shot.mjs` drives Edge/Chrome over the DevTools Protocol, reports horizontal overflow,
surfaces page exceptions, and can run a script in the page (`--js`) to assert on layout or
interaction. Two traps it exists to avoid:

- **Don't use Chrome's `--screenshot` with `--window-size` on Windows.** The minimum window
  width is ~492px, so `--window-size=390` lays out at 492px and crops the canvas to 390px.
  The result looks exactly like a blown-out layout but isn't.
- **Don't serve with `python -m http.server`.** It reads MIME types from the Windows registry,
  where `.js` is often `text/plain`; browsers then refuse the module script and the page
  renders blank with no obvious error. `tools/serve.py` sets the types explicitly.

## The legacy single-file page

`taiwan_etf_list.html` is ~4400 lines of inline HTML/CSS/JS with no build step. Everything is
driven by data attributes on `<tr>`; there is no JS data model. Keep it that way — it is in
maintenance mode, not a place to add features.

**Row shape — 10 cells**: 代號 / 名稱 / 保管銀行 / 配息 / 殖利率 / 近3月 / 近6月 / 近1年 /
近3年 / 詳情. Section `<h2>` counts and the `.stats` boxes are static and written by
`build_page.py`; they deliberately do **not** update while filtering.

**Filtering** — `filterRows()` ANDs three row predicates (substring match against the first
three cells only — it used to match the whole `tr.innerText`, which made every digit typed
hit stray percentages; exact `data-custodian`; exact `data-frequency`) and then a fourth,
section-level one: a `<section>` shows only if it still has visible rows **and** matches
`#sectionFilter`. That filter's options are built at load time by `initSectionFilter()` from
the `section[id^="cat-"]` elements, so they can't drift from the tables.

**Sorting** — `sortTable(th)` is delegated off `th.sortable`; each section table sorts
independently (desc → asc → original 代號 order), `N/A` always sinks, ties are stable.
A column that loses the class goes silently dead, so `verify_page.py` counts them (5 per
table, 6 tables).

**Mobile** — a `@media (max-width: 768px)` block turns each `<tr>` into a 5-column grid card
and positions cells with **`nth-child`**, because most `<td>`s carry no class. That couples
the layout to column order: inserting a column means renumbering that block or the cards
silently scramble. `thead` is not hidden; it becomes a row of sort chips so `sortTable()`
keeps working. `.filter-bar` drops `position: sticky` on phones, and its labels are a fixed
`7em` so the four controls line up.

Don't write literal `<tr>` / `<td>` in its CSS comments — `verify_page.py` counts tags with
`<tr[ >]` and will report the page as unbalanced.

## Conventions

- All user-facing text is Traditional Chinese; `<html lang="zh-Hant-TW">`.
- Comments explain **why**, in the language the surrounding file already uses.
- Keep existing ids, class names and function names — the verifiers and AGENTS.md depend on them.
