---
name: update-etf-list
description: Refresh or expand taiwan_etf_list.html with current Taiwan ETF data - add newly listed ETFs, update custodian banks and payout frequencies, or rebuild the whole table. Use when asked to 更新 ETF 清單, add missing/new ETFs, refresh 保管銀行 or 配息 data, or check whether the list is still complete.
---

# Updating the Taiwan ETF list

Rebuilds the tables in [taiwan_etf_list.html](../../../taiwan_etf_list.html) from live exchange
and MoneyDJ data. Five scripts in `scripts/`, run in order. Everything lands in a
scratch work directory; only the last step touches the real page.

**Never hand-type ETF rows.** Codes, names, custodian banks and payout frequencies all
come from the feeds below. If a feed is unreachable, say so and stop — a plausible-looking
invented 保管銀行 is worse than a missing row.

## Run it

```bash
WORK=<scratchpad>/etf            # anywhere outside the project
PAGE=D:/ai/TaiwanETF/taiwan_etf_list.html
cp "$PAGE" "$WORK/previous.html"          # keep for the regression diff

python scripts/fetch_universe.py  "$WORK"            # ~1 min  -> universe.tsv
python scripts/scrape_moneydj.py  "$WORK"            # ~8 min  -> pages/*.html
python scripts/scrape_returns.py  "$WORK"            # ~8 min  -> returns/*.html
python scripts/build_page.py      "$WORK" "$PAGE"    # rewrites the page
python scripts/verify_page.py     "$PAGE" "$WORK/previous.html"
node   scripts/test_sort.js       "$PAGE"          # only if you touched sortTable()
```

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

**2b. `scrape_returns.py` → `returns/<CODE>.html`**

`Basic0008.xdjhtm` (報酬分析). One label row (一日 / 一週 / 一個月 / 三個月 / 六個月 / 一年 /
三年 / 五年 / 十年 / 成立日) then a 市價 row and a 淨值 row. The page uses **市價** — the
return an actual holder realised. `parse_returns` in `etfdata.py` locates the columns by
label rather than by position, so MoneyDJ adding a period does not silently shift the data.

`N/A` for a fund younger than the period is real data and is rendered as-is, not blanked.
A missing or unparsable returns page degrades to N/A cells and a warning — it does not
block the build, because the basic table is the page's backbone and returns are an extra.

**3. `build_page.py`** — parses the pages, normalises, classifies, splices.

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
cell's colour class disagrees with its sign. Row layout is 9 cells:
代號 / 名稱 / 保管銀行 / 配息 / 殖利率 / 近3月 / 近6月 / 近1年 / 詳情.

**Sorting.** The four numeric columns are click-to-sort, per section table: first click
高→低, second 低→高, third restores 代號 order. `N/A` always sinks to the bottom in both
directions, and ties keep 代號 order. The handler is delegated off `th.sortable`, so a
header that loses that class goes silently dead — `verify_page.py` counts them (4 per
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
