# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **推送前必做（站主 2026-10-27 要求「以後都要更新」）**：瀏覽者看得到的功能新增／改進／修正，
> **同一個提交**就在 `app/src/lib/changelog.ts` 最上面加一條（寫法見下方「更新日誌」）。
> 10-08 之後連續兩週的功能都漏記過。私人頁（QT 看板等密碼頁）與每日資料更新不記。

## Project

A Traditional-Chinese market dashboard（站名「職業賭徒日誌」）：Taiwan and US ETFs,
per-stock fundamentals and chips, options positioning and 價平和, published at
<https://allenchiwei.github.io/taiwan-etf/>. Refreshed on a weekday cron and committed back.

Where each field comes from, because it is not one source:

| Field | Source |
| --- | --- |
| Taiwan ETF list | TWSE + TPEx open data (+ a FinMind sweep for stragglers) |
| Taiwan returns (3m/6m/1y/3y/5y) | computed from FinLab `etl:adj_close` — **total return** |
| Taiwan 保管銀行 / 配息頻率 | MoneyDJ `Basic0004` — **每週抓一次**，這兩個欄位幾乎不變 |
| Taiwan 殖利率 | 自己算：近 12 個月公告配息 ÷ 當日收盤價（全部官方免費端點） |
| US ETF list | Nasdaq Trader's public symbol file ∩ FinLab price matrix |
| US returns | FinLab `us_fund_price`（價格報酬）；有曲線的那些部署時改成 FinMind 含息報酬（`apply_us_total_return.py`，標 `tr`） |
| 籌碼（法人期貨／選擇權未平倉、Put/Call Ratio、大額交易人） | 期交所的 CSV 下載端點 |
| 籌碼（法人買賣超前十大） | TWSE `T86` + TPEx `insti/dailyTrade`，金額是估算 |
| 新聞 | 鉅亨網 API + 中央社 RSS（只存標題與連結） |
| 公告 | 公開資訊觀測站重大訊息（TWSE `t187ap04_L` + TPEx `mopsfin_t187ap04_O`） |
| 個股財報 | 公開資訊觀測站 OpenAPI（基本資料／月營收／損益表／資產負債表）——**累積式** |
| 個股估值（本益比河流圖） | FinMind `TaiwanStockPER`＋`TaiwanStockPrice`，**瀏覽器打開個股時才抓**，不經部署流程 |
| 低本益比篩選（全市場） | 證交所 `BWIBBU_ALL`／`STOCK_DAY_ALL`、櫃買本益比與收盤行情 ＋ `fin_history.json` 月營收（部署時產生） |
| 個股籌碼 | TWSE `T86`／`MI_MARGN`／`MI_QFIIS`、TPEx 對應端點、集保 TDCC |
| 各類股成交比重 | TWSE `BFIAMU`（只有上市，櫃買沒有對應端點） |
| 定期定額人氣榜 | TWSE OpenAPI `ETFReport/ETFRank`（**月報**，ETF 與個股各前 20 名） |
| 週選價平和 | 期交所每日選擇權行情 CSV（`dlOptDataDown`）——**累積式、進版控** |
| 融資餘額／大盤融資維持率 | FinMind `TaiwanStockTotalMarginPurchaseShortSale`（上市）；維持率用 TWSE `MI_MARGN` × 收盤價**自己算** |
| VIX、恐懼貪婪（自算） | FinMind `USStockPrice`（`^VIX` `^GSPC` SPY TLT HYG LQD）——**不是 CNN 的數字** |
| 主動式 ETF 持股與換股 | 各投信官網（統一 `GetPCF`、復華 `/api/assets`、中信 `etf/Buyback`）——**累積式、進版控** |
| 個股配息（配息試算） | 上市：TWSE `TWT49U`；上櫃：櫃買當日除息＋FinMind `TaiwanStockDividend` 分批回補（累積式、進版控） |
| ETF 前十大持股 | 投信投顧公會「基金投資明細－月前十大」IN2629.aspx（月報，進版控） |
| 還沒上市的 ETF | 鉅亨網新聞推代號與日期 ＋ 證交所 e添富新上市簡介（部署時產生） |
| 散戶多空比歷史 | 期交所三大法人（`futContractsDateDown`）＋ 期貨行情（`futDataDown`）——**累積式、進版控** |
| 創 150／200／250 日新高、漲跌幅 | 由 FinLab `etl:adj_close` 計算 —— **與試算資料共用同一次下載** |
| 台股績效曲線 | **FinMind** 日收盤 ＋ 公告配息，自己接總報酬（公開資料，不加密） |
| 美股績效曲線 | **FinMind** `USStockPrice` 的 `Adj_Close`，已含息還原（公開資料，不加密） |
| 美國總經（`/macro`） | FRED `fredgraph.csv`（**只收美國政府機關的數列**）＋ EIA 原油庫存 —— 部署時產生 |
| 台股行事曆（`/calendar`） | 證交所 `TWT48U`、櫃買 `tpex_exright_prepost`（除權息預告）、`t187ap41_L/_O`（股東會）、重大訊息 `t187ap04_L`／`mopsfin_t187ap04_O` 第 12 款（法說會，**靠上次發布的 calendar.json 逐日累積**）；財報期限與結算日依規則算 |

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
  fetch_chips.py             籌碼：期交所 + 兩家交易所 → chips.json（部署時產生）
  fetch_news.py              新聞與重大訊息 → news.json（部署時產生）
  reuse_calc.py              FinLab 失敗時，從線上抓回試算資料當備援
  fetch_stocks.py            個股財報（累積）與籌碼 → stocks/（部署時產生）
  fetch_pe.py                全市場本益比＋近 3 個月營收 → stocks/pe.json（低本益比篩選，部署時產生）
  fetch_highs.py             創 150/200/250 日新高與漲跌幅 → highs.json
  fetch_atm.py               週選價平和 → atm.json（累積式，每日更新流程提交）
  fetch_retail.py            小台／微台散戶多空比歷史 → retail.json（累積式）
  fetch_active_holdings.py   主動式 ETF 每日持股與換股 → active_holdings.json（累積式）
  fetch_stock_dividends.py   全部上市櫃個股配息 → stock_dividends.json（累積式）
  fetch_top10.py             ETF 前十大持股（公會月報）→ top10.json（進版控）
  fetch_upcoming.py          還沒上市的 ETF（新聞＋證交所簡介）→ upcoming.json（部署時產生）
  fetch_yields.py            殖利率＝配息÷收盤價 → yields.json（不碰 FinLab／MoneyDJ）
  finmind_series.py          曲線的共用機制：額度、輪替、日曆、輸出
  fetch_series_tw.py         台股績效曲線（FinMind）→ series/tw/（明文）
  fetch_series_us.py         美股績效曲線（FinMind）→ series/us/（明文）
  fetch_dividends_finmind.py 一次性：用 FinMind 回補交易所補不到的配息歷史
  fetch_macro.py             美國總經（FRED＋EIA）→ macro.json（部署時產生）
  fetch_calendar.py          台股行事曆（除權息預告、股東會）→ calendar.json（部署時產生）
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

## 主題文件（改到那一塊之前先讀）

細節不放在這份（它每次都整份載入）。主題文件在 `docs/claude/`，**改到那一塊的程式之前先讀對應的那份**；改了行為就更新那份文件（pre-push 的文件同步檢查也認這些檔）。

| 文件 | 內容 | 什麼時候讀 |
| --- | --- | --- |
| `docs/claude/stocks.md` | 個股資料（財報、籌碼、估值、低本益比、營收排行、創新高） | 改個股頁、fetch_stocks.py、fetch_pe.py、fetch_highs.py、估值／低本益比 |
| `docs/claude/chips.md` | 籌碼與新聞 | 改籌碼頁、fetch_chips.py、散戶多空比、定期定額人氣榜、新聞頁、fetch_news.py |
| `docs/claude/atm.md` | 週選價平和 | 改 fetch_atm.py、lib/atm.ts、籌碼頁價平和區塊 |
| `docs/claude/series.md` | 績效曲線（FinMind） | 改 fetch_series_*.py、finmind_series.py、績效曲線 |
| `docs/claude/sources.md` | 資料來源規則與流量（爬蟲、FinLab、MoneyDJ、殖利率） | 新增或改任何抓取來源、碰 FinLab／MoneyDJ、改殖利率算法 |
| `docs/claude/macro-calendar.md` | 美國總經與台股行事曆 | 改總經頁、行事曆頁、fetch_macro.py、fetch_calendar.py |
| `docs/claude/calculators.md` | 試算（定期定額、配息試算的個股） | 改試算頁、配息試算、stock_dividends |
| `docs/claude/futures-statement.md` | 期貨對帳單分析 | 改對帳單頁（/futures） |
| `docs/claude/etf-holdings.md` | ETF 持股（主動式換股、前十大、即將上市） | 改主動式 ETF 換股、fetch_active_holdings.py、前十大持股、即將上市 |

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

**流程分成十一個互相獨立的區塊，一塊失敗不會擋住其他塊**（step id 就是區塊名）：

| 區塊 | step id | 產出 | 需要 |
| --- | --- | --- | --- |
| 配息與殖利率 | `div` | `dividends.json`、`yields.json` | 只有交易所端點 |
| 台股清單 | `tw` | `etfs.json`、`taiwan_etf_list.html` | MoneyDJ + FinLab |
| 美股清單 | `us` | `us_etfs.json` | FinLab |
| 週選價平和 | `atm` | `atm.json` | 期交所 |
| 個股財報 | `stocks` | `fin_history.json` | 公開資訊觀測站 |
| 散戶多空比 | `retail` | `retail.json` | 期交所 ＋ FinMind 指數 |
| 主動式換股 | `hold` | `active_holdings.json` | 統一／復華／中信／群益／元大／凱基／野村投信官網＋證交所 `MI_INDEX`／櫃買 `afterTrading/otc`（估值與持股損益用的均價） |
| 前十大持股 | `top10` | `top10.json` | 投信投顧公會 |
| ETF 受益人數 | `eholders` | `etf_holders.json`（逐週累積） | 集保開放資料 1-5 |
| ETF 配息組成 | `dmix` | `div_mix.json`（每檔最近一次公告的股利／利息／平準金／資本利得／其他占比） | 集保 ETF 觀測站 `fundclear.com.tw/api/etf/dividend/query-dividend`（月領試算只把股利＋利息算進二代健保，2026-10-27） |
| 個股配息 | `sdiv` | `stock_dividends.json` | 證交所／櫃買＋FinMind |

每一塊都是 `continue-on-error: true`，各自把**驗證與吃它產出的那支測試**放在自己裡面。
跑完由「整理未完成的區塊」依 `steps.<id>.outcome` 把失敗的那組 `git checkout` 還原成
前一版，所以提交步驟只會看到成功的那幾塊。擱置的區塊會寫進 commit 訊息、job summary
與 `::error`，而且最後一步會讓 job 紅燈 —— 但 `deploy` 的條件是 `always()`，成功的那
幾塊照樣上線。前置檢查（FinLab 憑證、MoneyDJ 連線）也不再中止整次更新，只決定 `tw`／
`us` 這兩塊跑不跑。

會這樣改是因為 2026-09-22：FinLab 把 `us_fund_price` 從 10,097 檔擴到 11,981 檔，多出的
新標的大多只有幾天歷史，其中 165 檔通過流動性門檻卻算不出近 3 月報酬，`verify_us_data.py`
因此擋下 —— 然後台股、配息、價平和、個股財報那四塊明明都通過了驗證，卻一起沒進版，
網站停在五天前。（那個門檻本身也修了，見 `fetch_us_etfs.py` 的 `LIQUID_MIN_DAYS`。）

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

## 更新日誌

`/changelog`（導覽列的「更新」），內容在 `app/src/lib/changelog.ts`。**新增或改動使用者
看得到的功能時，在最上面加一條**（同一天併在同一個日期底下）；每天的資料更新不列，
純內部的重構與流程調整也不列，除非瀏覽者感受得到（例如「網站不會整個停在舊的一天」）。
文字寫給瀏覽者：講能做什麼、看到什麼，不講檔名。`to` 是站內路徑的聯集型別，打錯會被
`tsc` 擋下。導覽列的小紅點比的是 localStorage 裡上次看過的日期；第一次來的人直接記成
已看過，不亮 —— 對他每一條都是新的。

## 部署後自動更新

開著的分頁（尤其手機加到主畫面、掛在背景的）會一直跑舊程式。建置時 `buildVersion()`
（`vite-plugins.ts`）寫出 `version.json`，`__BUILD_ID__` 用 `define` 注入（CI 用 `GITHUB_SHA`）。
`useAutoUpdate` 在**切回分頁時**與**分頁開著時每 5 分鐘**比對；`decideUpdate()` 決定怎麼做：
切回分頁直接重新整理（使用者剛回來，手上沒事）、正在看就跳 10 秒倒數（可按「稍後」）、
**對帳單頁只提示不倒數**（上傳的檔案只在記憶體，重新整理會清掉）。每天的資料更新也會
重新建置，所以使用者大約一天被自動更新一次 —— 資料本來就換新了。

`index.html` 走 service worker 的 network-first，所以重新打開一定是新版；這個機制只是處理
「一直開著沒關」的情況。

## 安全相關的既定作法

- **CSP 是建置時產生的**（`app/vite-plugins.ts` 的 `cspMeta`），內嵌的主題腳本用
  **從 HTML 算出來的 sha256** 放行，不是寫死的雜湊、也不是 `unsafe-inline`。
  開發模式刻意不加 CSP —— Vite 的 HMR 會注入內嵌腳本，加了只會讓 `npm run dev`
  壞掉。`tests/csp.test.ts` 盯著「每段內嵌腳本都有被放行」。
- **未加密的價格序列不可能進到產物**：同一個外掛的 `dropPlaintextSeries` 會在
  建置最後遞迴刪掉 `dist/data/series` 底下所有 `.json`（只留 `.enc`）。
  本機的 `public/data/series` 有明文，少了這一步，在本機 build 一次就有一千多個
  付費資料檔躺在 `dist/` 裡。CI 另外有一道 `find` 檢查，兩層都要留著。
- 正式產物不出 source map；`SITE_PASSWORD` 只給需要它的那一個步驟；CI 的 pip
  鎖版本（那個 job 握著 FinLab token）。
- PBKDF2 是 60 萬次（OWASP 目前對 PBKDF2-SHA256 的建議）。改這個數字會讓既有的
  解鎖工作階段失效一次，manifest 會帶新參數所以前端不用改。

## Conventions

- All user-facing text is Traditional Chinese; `<html lang="zh-Hant-TW">`.
- Comments explain **why**, in the language the surrounding file already uses.
- Keep existing ids, class names and function names — the verifiers and AGENTS.md depend on them.
