# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A single self-contained static page, [taiwan_etf_list.html](taiwan_etf_list.html) (~2800 lines): a searchable Traditional-Chinese directory of 359 Taiwan ETFs with custodian-bank and dividend-frequency filters, linking out to MoneyDJ. There is no build step, no package manager, no test suite, and no git repository here — the whole project is that one file plus [AGENTS.md](AGENTS.md).

Do not introduce frameworks, bundlers, package managers, or split the data into separate files unless the user explicitly asks. Keep HTML, CSS, and JS inline in the one file.

## Verify changes

Open the file in a browser (`start taiwan_etf_list.html`) and check: page renders, search + both selects + 清除 filter rows correctly, section counts and header stats match reality, MoneyDJ links resolve.

## Architecture

Everything is driven by data attributes on the table rows; there is no JS data model.

**Sections** — six `<section>` elements, each `<h2>` + one `<table>`, in this order and with these hardcoded counts that must be kept in sync with the rows:

| Section id | Heading | Rows |
| --- | --- | --- |
| `cat-domestic` | 台股ETF | 87 |
| `cat-foreign` | 海外ETF | 113 |
| `cat-bond` | 債券ETF | 112 |
| `cat-leveraged` | 槓桿/反向ETF | 33 |
| `cat-futures` | 期貨ETF | 6 |
| `cat-leveraged-futures` | 槓桿期貨ETF | 8 |

**Header stats** (`.stat-box`) show 359 total plus four anchor links: 87 → `#cat-domestic`, 113 → `#cat-foreign`, 112 → `#cat-bond`, and 47 → `#cat-leveraged`, where 47 is the sum of the last three sections (33+6+8). Editing rows means updating both the `<h2><span class="count">` and these stat boxes.

**Row shape** — nine cells: 代號 / 名稱 / 保管銀行 / 配息 / 殖利率 / 近3月 / 近6月 / 近1年 / 詳情.

```html
<tr data-custodian="中國信託商業銀行" data-frequency="月配">
  <td class="code"><a href="https://www.moneydj.com/ETF/X/Basic/Basic0004.xdjhtm?etfid=00400a.tw" target="_blank">00400A</a></td>
  <td>主動國泰動能高息</td>
  <td>中國信託商業銀行</td>
  <td><span class="freq freq-monthly">月配</span></td>
  <td class="num yld">9.73</td>
  <td class="num ret-up">9.51</td>
  <td class="num ret-na">N/A</td>
  <td class="num ret-na">N/A</td>
  <td><a href="..." target="_blank" class="link-btn">MoneyDJ</a></td>
</tr>
```

**殖利率** comes from `Basic0004` (same page as 保管銀行/配息) and is styled `.yld`;
`N/A` means either no distribution or none yet — read the 配息 column to tell which.

**Returns** are 市價 (market price) returns from MoneyDJ `Basic0008`, not NAV. `N/A` means the
fund is younger than the period. Colour follows the Taiwan convention — `.ret-up` red,
`.ret-down` green, `.ret-na` grey — the opposite of the US one; don't "fix" it. Because these
are a market snapshot they carry their own stamp in the header (`報酬率／殖利率截至：MM/DD`) separate
from 更新日期.

The MoneyDJ URL is always `https://www.moneydj.com/ETF/X/Basic/Basic0004.xdjhtm?etfid=<code lowercased>.tw`, and the same URL appears twice per row (code cell and 詳情 button).

**Filtering** — `filterRows()` (called from `oninput`/`onchange`) ANDs three predicates: substring match against the first three cells only (代號/名稱/保管銀行 — it used to be the whole `tr.innerText`, which after the return columns arrived made every digit typed match stray percentages), exact match on `data-custodian`, exact match on `data-frequency`. Non-matching rows get `.hidden`; any `<section>` with no visible rows is hidden via `style.display`. `resetFilters()` clears all three controls; a scroll listener toggles `.show` on `#scrollTopBtn`. Section counts are static and deliberately do **not** update while filtering.

**Sorting** — `sortTable(th)` is wired by one delegated click/keydown listener on
`th.sortable`; each section table sorts independently (desc → asc → original 代號 order),
`N/A` always sinks, ties are stable. Adding a numeric column means adding `sortable` to its
`<th>`, or it silently won't sort. `.claude/skills/update-etf-list/scripts/test_sort.js`
runs the real function against a stub DOM — use it after editing the JS.

**Coupled values** — a new custodian or frequency must be added in three places at once: the row's `data-*` attribute, the matching `<option value="...">` in `#custodianFilter` / `#frequencyFilter`, and (for frequency) a `.freq-*` pill class. The `data-frequency` value must equal the option value exactly, since the comparison is `===`.

Frequency pill classes: `freq-monthly` (月配), `freq-quarterly` (季配), `freq-semi` (半年配), `freq-annual` (年配), `freq-bimonthly` (雙月配), `freq-unknown` (—). `.freq-none` is defined in CSS but unused — dead, not a gap.

## Updating the data

Do not hand-edit ETF rows. The `update-etf-list` skill (`.claude/skills/update-etf-list/`) rebuilds the tables from TWSE/TPEx open data plus MoneyDJ, and verifies the result against the previous version. Its `scripts/etfdata.py` holds the bank-name normalisation and section rules.

## Conventions

- All user-facing text is Traditional Chinese; `<html lang="zh-Hant-TW">`.
- Keep existing ids, class names, function names, and the overall visual layout — the filter logic and the AGENTS.md contract depend on them.
- The header line carries a data source and update date (`資料來源：FinLab / MoneyDJ　更新日期：...`); refresh the date when the ETF data changes.

## 部署

GitHub Pages，repo `AllenChiWei/taiwan-etf`，來源為 `main` 分支根目錄，
線上網址 https://allenchiwei.github.io/taiwan-etf/
（`index.html` 只是轉址到 `taiwan_etf_list.html`，改動資料時不必動它）。

更新完 ETF 資料後 `git add -A && git commit && git push`，Pages 約一分鐘後自動重新部署。
憑證由 Windows Git Credential Manager 保管，不要把 token 寫進檔案或 `.env`。

## 響應式（手機版面）

A `@media (max-width: 768px)` block at the end of the `<style>` turns each `<tr>` into a
card: `table`/`tbody` go `display: block`, `tbody tr` becomes a 4-column grid, and the
cells are positioned with **`nth-child`** because most `<td>`s carry no class.

**This couples the mobile layout to column order.** The nine cells are
代號 / 名稱 / 保管銀行 / 配息 / 殖利率 / 近3月 / 近6月 / 近1年 / 詳情, and the CSS addresses
them as `td:nth-child(1)` … `td:nth-child(9)`, with `nth-child(5)`–`nth-child(8)` carrying
the column name via `::before`. Reordering or inserting a column means updating that block
too, or the cards silently scramble.

`thead` is **not** hidden on mobile — it becomes a row of sort chips, so `sortTable()` keeps
working untouched. `.filter-bar` drops its `position: sticky` on phones (four stacked rows
would eat half the screen). `tbody tr.hidden` still beats the card `display: grid` on
specificity, so `filterRows()` needs no change.

Don't write literal `<tr>` / `<td>` in CSS comments — `verify_page.py` counts tags with
`<tr[ >]` and will report the page as unbalanced.

### 驗證手機版

`node tools/shot.mjs <url> <out.png> 390x844 --dsf=2 [--js=probe.js]` screenshots through the
DevTools Protocol and reports horizontal overflow. Use it rather than Edge's `--screenshot`:
on Windows the minimum window width is ~492px, so `--window-size=390` renders at 492px and
crops the canvas to 390px, which looks exactly like a blown-out layout but is not one.
