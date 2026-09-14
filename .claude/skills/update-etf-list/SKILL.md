---
name: update-etf-list
description: Refresh or expand taiwan_etf_list.html with current Taiwan ETF data - add newly listed ETFs, update custodian banks and payout frequencies, or rebuild the whole table. Use when asked to 更新 ETF 清單, add missing/new ETFs, refresh 保管銀行 or 配息 data, or check whether the list is still complete.
---

# Updating the Taiwan ETF list

Rebuilds the ETF data from live exchange and MoneyDJ feeds. The scripts live in
[scripts/](../../../scripts/) at the repo root (not in this skill folder) because the
GitHub Actions daily job runs the same ones.

There are **two front ends** and one run updates both:

| Output | Consumed by |
| --- | --- |
| `app/public/data/etfs.json` | the React app (`app/`), the primary site |
| `taiwan_etf_list.html` | the older single-file page, kept at its original URL |

**Never hand-type ETF rows.** Codes, names, custodian banks and payout frequencies all
come from the feeds below. If a feed is unreachable, say so and stop — a plausible-looking
invented 保管銀行 is worse than a missing row.

## Run it

```bash
WORK=<scratchpad>/etf            # anywhere outside the project
cp app/public/data/etfs.json "$WORK/previous.json"   # for the regression diff
cp taiwan_etf_list.html      "$WORK/previous.html"

python scripts/fetch_universe.py  "$WORK"                             # ~1 min -> universe.tsv
python scripts/scrape_moneydj.py  "$WORK"                             # ~8 min -> pages/*.html
python scripts/fetch_tw_returns.py "$WORK"                            # ~10 s  -> tw_returns.json
python scripts/build_data.py     "$WORK" app/public/data/etfs.json    # React 版資料
python scripts/build_page.py     "$WORK" taiwan_etf_list.html         # 舊版單頁
python scripts/verify_data.py    app/public/data/etfs.json "$WORK/previous.json"
python scripts/verify_page.py    taiwan_etf_list.html      "$WORK/previous.html"
cd app && npm test && cd ..                                           # 篩選/排序邏輯
node scripts/test_sort.js taiwan_etf_list.html                        # 舊版頁的排序
```

In CI this is `.github/workflows/update-data.yml`, on a weekday 19:00 Taiwan-time cron.
It runs the same commands and refuses to commit if any verifier fails, so a half-finished
scrape can never overwrite good data.

Both scrapers skip files already on disk, so a re-run resumes rather than refetching.

- **`rm -rf $WORK/returns`** before almost every run. Returns are a market snapshot and
  are stale the next trading day; the page stamps 報酬率／殖利率截至 from them.
- **`rm -rf $WORK/pages`** only for a genuine custodian/payout refresh. Keep it when the
  job is just "add the new listings".

Then open the page and eyeball it: `start taiwan_etf_list.html`.

## What each step does

**1. `fetch_universe.py` → `universe.tsv`** (code, short name, twse|tpex)

Three feeds, because no single one is complete:

| Feed | Gives | Trap |
| --- | --- | --- |
| TWSE `t187ap47_L` | every TWSE ETF | keeps liquidated funds forever (0054, 00677U…) |
| TWSE `STOCK_DAY_ALL` | what traded last session | short trading names — the ones the page uses |
| TPEx `tpex_securities` | TPEx ETFs (where nearly all 債券 ETF live) | it is a *day-trading eligibility* list, not a registry |
| FinMind price sweep | catches the leftovers | ~64 extra requests, keep the 0.4 s spacing |

The registry is intersected with what actually traded, which kills the dead funds but
would also drop a listed-but-zero-volume ETF. The TPEx feed silently omits some share
classes. The FinMind sweep exists to catch both — it is what found `00687C` (國泰20年美債+櫃U),
which is listed and trading but absent from `tpex_securities`. **Do not delete that step.**

**2. `scrape_moneydj.py` → `pages/<CODE>.html`**

`Basic0004.xdjhtm?etfid=<lowercased code>.tw` — the page the list already links to, and the
only checked source carrying 保管機構, 配息頻率 and 殖利率 together. Works for TWSE and
TPEx codes alike.
~1 req/sec; the script retries 3× and fails loudly rather than writing a partial dataset.

**2b. `fetch_tw_returns.py` → `tw_returns.json`** （取代了對 MoneyDJ 的第二輪抓取）

報酬率改由 FinLab 的 `etl:adj_close` 計算。那是真正含息的還原股價序列 ——
0056 的還原/原始比值已成長到 3.03，正是配息再投資的效果。期間用日曆月而非
交易日數，和 MoneyDJ 的定義一致：實測 0050／0056／00878／00679B 的近3月、
近6月、近1年三個期間與 MoneyDJ 完全相同，近3年差 0.07 以內。

這樣做的主因是**把對 MoneyDJ 的請求量砍半**（718 頁 -> 359 頁）。
保管銀行、配息頻率、殖利率在 FinLab 沒有對應資料，仍然只能從 Basic0004 來。

`scrape_returns.py` 保留作為 FinLab 不可用時的退路，但已不在每日流程中。

<details><summary>舊的 MoneyDJ 報酬率抓取（備援）</summary>

**`scrape_returns.py` → `returns/<CODE>.html`**

`Basic0008.xdjhtm` (報酬分析). One label row (一日 / 一週 / 一個月 / 三個月 / 六個月 / 一年 /
三年 / 五年 / 十年 / 成立日) then a 市價 row and a 淨值 row. The page uses **市價** — the
return an actual holder realised. `parse_returns` in `etfdata.py` locates the columns by
label rather than by position, so MoneyDJ adding a period does not silently shift the data.

`N/A` for a fund younger than the period is real data and is rendered as-is, not blanked.

</details>

**3. `build_data.py` / `build_page.py`** — parse the pages, normalise, classify.

`build_data.py` writes JSON and is the one that matters; `build_page.py` splices the
same data into the legacy HTML.

Only the generated regions are rewritten (tables, both `<select>` option lists, the
`.stats` block, the 更新日期). CSS, JS and layout are untouched, so hand edits like the
centred header survive. Idempotent: re-running on an already-built page is a no-op.

**4. `verify_page.py`** — structural checks plus a diff against the previous version.

Fails on: header counts disagreeing with row counts, stat boxes disagreeing with sections,
a custodian or payout value with no filter option, a pill class with no CSS rule, malformed
rows, links pointing at the wrong code, missing JS hooks, unbalanced tags, and **any row
that disappeared**. Renames and payout changes are printed for review, not failed on.

## Rules the scripts encode

Edit `scripts/etfdata.py` — that is where all the judgment lives.

**Sections.** `U` → 期貨; `L`/`R` → 槓桿期貨 if the name starts with 期, else 槓桿/反向;
`B` suffix or 投資標的 containing 債 → 債券 (this catches the `D`-suffix active bond ETFs too);
otherwise 投資區域 台灣 → 台股, else 海外.

**Existing rows keep their current section.** The rule only classifies codes not already on
the page. This preserves curated calls — e.g. `00735 國泰臺韓科技` stays in 海外 even though
MoneyDJ reports 投資區域 = 台灣. Don't "fix" these.

**Bank names.** MoneyDJ spells the same bank several ways (玉山銀行 / 玉山商業銀行,
永豐商業銀行信託部, 中國信託銀行…). `CUST_NORM` maps them onto the page's canonical
spellings; it was built by diffing MoneyDJ against the 204 hand-curated rows the page
started with and matches all 204 exactly. When a new spelling appears, add a mapping —
don't introduce a second spelling of a bank already in the list.

**Yield.** 殖利率 rides along on Basic0004 — no extra fetch. MoneyDJ writes it as
`7.38（09/11）`; `parse_yield` strips the quote date (stamped once in the header instead).
`N/A` covers two different things MoneyDJ does not distinguish — the fund makes no
distribution, and the fund pays but has not distributed yet (anything listed this year).
The 配息 column is what tells them apart, so don't try to infer one from the other. Two
funds (00935, 009804) report a yield while 配息頻率 is blank; that inconsistency is at
source and is passed through rather than papered over.

**Returns.** Red for gains, green for losses — the Taiwan convention, the opposite of the
US one. `return_class` in `etfdata.py` owns this; `verify_page.py` fails the build if any
cell's colour class disagrees with its sign. Row layout is 10 cells:
代號 / 名稱 / 保管銀行 / 配息 / 殖利率 / 近3月 / 近6月 / 近1年 / 近3年 / 詳情.
Adding a period means: `RETURN_PERIODS` in etfdata.py, `PERIOD_KEY` in build_data.py,
one `_SORT` header in build_page.py, `NCELLS` in verify_page.py, the mobile card's
`nth-child` block in the page CSS, and on the React side `NumericKey` + `Etf` in
types.ts, `NUMERIC_COLUMNS` in columns.ts, `NUMERIC_LABEL` in format.ts, `SORTABLE`
in useFilterState.ts and `SORT_OPTIONS` in FilterBar.tsx.

**Sorting.** The five numeric columns are click-to-sort, per section table: first click
高→低, second 低→高, third restores 代號 order. `N/A` always sinks to the bottom in both
directions, and ties keep 代號 order. The handler is delegated off `th.sortable`, so a
header that loses that class goes silently dead — `verify_page.py` counts them (5 per
table). `sortTable()` lives in the page, not in these scripts; `test_sort.js` extracts the
real function and exercises it against a stub DOM, so run it after editing the JS.

**Payout.** Blank 配息頻率 on MoneyDJ means no distribution → the page's `—`. The parser
must stop at the next label, or a blank field swallows the 經理費 value sitting after it;
that is what `NEIGHBOURS` in `etfdata.py` is for. A new label (beyond 月配/雙月配/季配/
半年配/年配) needs three things: `FREQ_CLASS`, `FREQ_ORDER`, and a `.freq-*` CSS rule in
the page. `build_page.py` refuses to write rather than emit an unstyled pill.

## Validating a change to the pipeline

The strongest check available: build into a copy and diff against the live page. Identical
output means the pipeline reproduces the current state and any difference is genuinely new
data. This caught a double-escaping bug (`S&amp;amp;P`) that every other check passed.

```bash
cp "$PAGE" "$WORK/test.html"
python scripts/build_page.py "$WORK" "$WORK/test.html"
diff "$WORK/test.html" "$PAGE"          # expect no output
```

## Notes

- TPEx serves an intermediate cert Anaconda's CA bundle lacks; `fetch_universe.py` prefers
  `certifi` and falls back to unverified TLS for that host (public read-only open data).
- FinMind works tokenless at 300 req/hr. `$FINMIND_TOKEN` raises it to 600 but is not needed.
- Keep counts in [CLAUDE.md](../../../CLAUDE.md) in sync after a run that changes totals.
- The React app reads `etfs.json` at runtime, so a data-only change needs no rebuild —
  but the deploy workflow still has to run for the new file to reach the CDN.
