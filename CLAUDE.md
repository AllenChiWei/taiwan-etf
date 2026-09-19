# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
| US returns | computed from FinLab `us_fund_price` — **price return only**, see below |
| 籌碼（法人期貨／選擇權未平倉、Put/Call Ratio、大額交易人） | 期交所的 CSV 下載端點 |
| 籌碼（法人買賣超前十大） | TWSE `T86` + TPEx `insti/dailyTrade`，金額是估算 |
| 新聞 | 鉅亨網 API + 中央社 RSS（只存標題與連結） |
| 公告 | 公開資訊觀測站重大訊息（TWSE `t187ap04_L` + TPEx `mopsfin_t187ap04_O`） |
| 個股財報 | 公開資訊觀測站 OpenAPI（基本資料／月營收／損益表／資產負債表）——**累積式** |
| 個股籌碼 | TWSE `T86`／`MI_MARGN`／`MI_QFIIS`、TPEx 對應端點、集保 TDCC |
| 各類股成交比重 | TWSE `BFIAMU`（只有上市，櫃買沒有對應端點） |
| 週選價平和 | 期交所每日選擇權行情 CSV（`dlOptDataDown`）——**累積式、進版控** |
| 創 150／200／250 日新高、漲跌幅 | 由 FinLab `etl:adj_close` 計算 —— **與試算資料共用同一次下載** |
| 台股績效曲線 | **FinMind** 日收盤 ＋ 公告配息，自己接總報酬（公開資料，不加密） |
| 美股績效曲線 | FinLab `us_fund_price:adj_close`（付費資料，加密上線） |

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
  fetch_highs.py             創 150/200/250 日新高與漲跌幅 → highs.json
  fetch_atm.py               週選價平和 → atm.json（累積式，每日更新流程提交）
  fetch_yields.py            殖利率＝配息÷收盤價 → yields.json（不碰 FinLab／MoneyDJ）
  fetch_series_tw.py         台股績效曲線（FinMind）→ series/tw/（明文）
  fetch_dividends_finmind.py 一次性：用 FinMind 回補交易所補不到的配息歷史
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

## 籌碼資料

`scripts/fetch_chips.py` → `app/public/data/chips.json`（**不進版控**，跟 `calc/` 一樣
部署時產生；它不需要 FinLab 憑證，來源全是免費的公開端點）。

期交所每個統計頁底下都有一個 CSV 下載端點，欄位固定、參數就是日期區間，比解析網頁穩：

| 端點 | 內容 |
| --- | --- |
| `futContractsDateDown` | 三大法人各期貨契約未平倉（含契約金額，近 120 天） |
| `callsAndPutsDateDown` | 三大法人臺指選擇權買賣權分計（未平倉與當日交易，買方／賣方／淨額） |
| `pcRatioDown` | Put/Call Ratio（成交量比、未平倉量比） |
| `largeTraderFutDown` / `largeTraderOptDown` | 大額交易人前五大／前十大 |

三個踩過的坑，改動前先讀 `fetch_chips.py` 的 docstring：

- **PC ratio 一次最多查一個月**，查兩個月會回一頁 HTML（不是錯誤訊息），所以歷史是切段抓的。
- **大額交易人只抓最新一日**：那份表涵蓋全市場 346 種契約，查三個月會變成 89000 行。
- **買賣超金額是估算**。交易所公佈的法人買賣超只有**股數**；這裡用當日成交均價
  （成交金額÷成交股數）推估金額，畫面上必須標明。不要把它講成實際成交金額。

選擇權那一區對應期交所 `callsAndPutsDate` 那一頁：未平倉與當日交易兩側，各有買方、
賣方與淨額的口數與契約金額。**買方與賣方一律是正數**（各自的部位，不是同一筆的兩端），
只有淨額帶正負號 —— 第一版給三欄都加了正號，讀起來像三個方向。

契約金額的淨額允許 1 千元誤差：期交所把買方、賣方、淨額三欄各自四捨五入到千元，
所以「買 − 賣」與它公佈的淨額可以差 1（實測六列裡有兩列差 1）。口數沒有這個問題。

櫃買的法人買賣超表格裡，七個身份別的欄位名稱全都叫「買進／賣出／買賣超股數」，
`fields.index()` 永遠回第一組，只能靠位置取。所以 `tpex_top()` 每次都用
「三家相加 = 公佈的三大法人合計」驗一次 —— 櫃買改版挪動欄位時會先叫出來，
而不是默默給出錯的排行。證交所那邊同理，且外資要把外資自營商加回來才對得上合計。

籌碼頁 `app/src/routes/ChipsPage.tsx` 只負責呈現，計算都在 `app/src/lib/chips.ts`
（純函式、有測試）。單位換算特別容易錯，JSON 一律保留原始單位（契約金額千元、
買賣超股數與估算金額元），換算只在畫面上做。

## 新聞資料

`scripts/fetch_news.py` → `app/public/data/news.json`（不進版控，部署時產生）。

**只存標題、時間、來源與連結，不存內文。** 這是規矩，不是實作細節：新聞內文有
著作權，這一頁做的是索引與導流。`tests/news.test.ts` 有一條測試就在盯這件事
（斷言沒有 `content`／`summary` 欄位、標題長度不像內文）。

來源與為什麼是這三個：

- **鉅亨網** `api.cnyes.com` — robots.txt 對所有人 `Allow: /`，而且每則新聞有掛
  個股代號，可以標出「跟清單裡哪一檔有關」。
- **中央社 RSS** — 官方提供的 RSS，content-signal 是 `ai-train=no, search=yes`；
  我們不訓練任何東西，只放標題與外連。
- **公開資訊觀測站** — 上市與上櫃的重大訊息 OpenAPI，官方原始公告。

**查過但不採用：奇摩股市**的 robots.txt 有一組點名 AI 代理的清單（anthropic-ai、
ClaudeBot、GPTBot…）全部 `Disallow: /`，對所有人也擋掉 `/api`、`/caas`、
`/_td-news`，新聞 JSON 正在那些路徑下。**Google News** 的 robots 是 `Disallow: /`
且 `/rss` 不在開放清單，抓搜尋結果頁也違反服務條款。這兩個不要再試。

重大訊息的連結用 `mopsov.twse.com.tw/mops/web/t05st01?firstin=1&co_id=…` ——
新版觀測站是 SPA、沒辦法用 GET 帶公司代號深連結，這個舊版路徑實測可以。

## 個股資料

`scripts/fetch_stocks.py`，來源全是官方免費端點，**不動用 FinLab 額度**。產出三份：

| 檔案 | 進版控？ | 誰產生 |
| --- | --- | --- |
| `app/public/data/fin_history.json` | **是** | 每日更新流程（`--no-chips`），它才會 commit |
| `.cache/stock_chips.json` | 否 | 部署流程，用 Actions 快取保存 |
| `app/public/data/stocks/*.json` | 否 | 部署流程，前端實際讀的（每檔約 600 bytes） |

三個一定要知道的資料性質：

- **財報端點只回當期**（本季、本月），沒有任何歷史參數。所以季度趨勢是逐期累積的，
  `fin_history.json` 進版控、每次執行合併、已有的期別不覆蓋。要一次補回幾年份只有
  用 FinLab 抓一次（吃額度）或對每家公司逐季查觀測站（兩萬多次請求，不做）。
- **季報是累計數**：季別 2 是上半年、季別 3 是前三季。台積電 2026Q2 營收 2.40 兆，
  而 1～8 月累計月營收 3.39 兆 —— 當成單季會差一倍。`singleQuarter()` 在有連續兩期
  時還原單季，畫面一律標「累計」。資產負債表是時點數，不受影響。
- **單位**：財報是千元（1 億元 = 100,000 千元、1 兆元 = 1,000,000,000 千元），
  買賣超是股，融資融券是張。`lib/stock.ts` 收斂換算，`tests/stock.test.ts` 用台積電
  的真實數字釘住 —— 這兩個常數寫錯十倍時畫面看起來仍然正常。

融資融券那兩張表把「前日餘額」排在「今日餘額」前面（上市 5/6、上櫃 2/6），
取錯一格會整頁顯示昨天的數字而且毫無異狀；第一版就取錯過，靠比對原始列才發現。

集保股權分散表一次 9 MB、68000 列，只留三個數字：400 張以上（分級 12–15）、
千張以上（分級 15）、股東人數（分級 17）。它每週更新，日期與買賣超不同天。

### 營收排行、創新高、類股成交比重

- **營收排行**（`stocks/ranking.json`）：全市場最新一個月，兩千檔一份，前端才排得動。
  **門檻同時套在本期與基期**：建設公司依完工比例認列，去年同月可能只有幾十萬，
  今年 8.9 億就是 +2,630,241%，會把整張榜洗掉。只擋本期營收沒有用 —— 它們的本期
  營收很大。`impliedBase()` 從成長率反推基期，兩期都要過門檻。
- **創新高與漲跌幅**（`highs.json`）：`fetch_highs.py` 用的兩份資料集正是 `fetch_calc.py`
  抓過的，同一次執行共用 `.cache/finlab_db`，所以**不會多花流量** —— 但單獨跑它會
  真的下載一次。高低點用**還原股價**算，不然 00631L 那類做過分割的會顯示「距高點
  -93%」；畫面顯示的股價則是原始收盤價。三個窗口（150／200／250 日）各存一組，
  漲跌幅是一週／一月／一季／半年（以交易日計，5／20／60／120 日），同樣用還原股價。
  期間不足的存 null 而不是 0 —— 新股上市首月常常大漲，混進半年榜會是誤導。
- **類股成交比重**（`chips.json` 的 `sectors`）：證交所的分類指數有階層，「電子」與
  「化學生技醫療」是彙總類，等於底下幾個細類的總和（實測到小數點後四位一樣）。
  算比重時分母要扣掉彙總類，否則電子被算兩次、半導體會從 36% 被稀釋成 19%。

## 週選價平和

`scripts/fetch_atm.py` → `app/public/data/atm.json`（**進版控**，每天四列、一年約 150 KB）。
畫面在籌碼頁的「週選價平和」區塊，統計在 `app/src/lib/atm.ts`（純函式、有測試）。

    價平履約價 = 同一到期合約中 |Call 收盤 − Put 收盤| 最小者
    價平和     = 該履約價的 Call + Put

取**一般交易時段**（日盤）收盤價，無成交時退回結算價。所以每一列的意思是「該交易日
收盤的價平和」，也就是**隔一個交易日開盤前**看到的數字。期交所 CSV 裡的「盤後」是
前一交易日 15:00 起的夜盤，比同一份檔案的日盤還舊，流動性也低到 |C−P| 的判定會偏掉，
所以不用它。

四件在資料上踩過、寫成註解與測試的事：

- **系列要看合約代號，不要看到期日的星期。** W 系列是週三到期、F 系列是週五到期，
  但遇連假會移位 —— `202609F4` 的到期日是 2026-09-29（星期二），因為 09-25 是中秋。
- **月選算進週三系列。** 月選到期那一週沒有 W 合約（九月只有 W1、W2、W4、W5），
  那一週的「週三到期合約」就是月選本身。
- **每天每系列記兩口**（`r=0` 最近到期、`r=1` 換倉後那一口）。只記一口的話，
  「排除到期當日」之後週四早上的週三系列會變成沒有樣本 —— 因為週三收盤時最近的
  那口正好當天到期。前端的 `pickRow()` 取「符合條件中最近到期的那口」，
  所以排除之後自然退到第二口，那才是那天早上真正在看的數字。
- **到期當日的價平和趨近 0**（實測週三系列在週三平均 15，換倉後 1350）。
  把它混進平均，那一格講的就不是同一件事，所以預設排除，但保留選項。

「週三的價平和」有兩種問法，畫面用 `basis` 切換：`preopen`（當天早上看到的，
＝前一交易日收盤，預設）與 `data`（當天收盤本身）。

## 績效曲線：兩個市場、兩種保護方式

    台股　FinMind（公開資料）   -> series/tw/*.json      明文，任何人都看得到
    美股　FinLab（付費訂閱）    -> series/us/*.json.enc  加密，要先解鎖

台股原本也走 FinLab，所以整份都要加密，而加密需要 `SITE_PASSWORD` secret ——
**沒設定時部署會把曲線整個丟掉**，收藏頁的績效比較就一片空白。那正是使用者回報
「跑不出績效曲線」的原因，不是程式壞了。改用 FinMind 之後，台股這半不再有這條鍊子。

改動牽涉四個地方，少改一個就會壞：

1. `scripts/fetch_series_tw.py` 產生台股（FinMind），`fetch_series.py` 只剩美股。
2. `encrypt_data.py` 的 `PLAINTEXT_SERIES` 把 `tw` 排除在加密之外。
3. deploy 的「確認價格序列沒有以明文上線」只掃 `series/us`，否則台股的明文會讓
   部署失敗。
4. `app/vite-plugins.ts` 的 `dropPlaintextSeries` 也只掃 `series/us`，否則它會在
   建置時把正常的台股曲線整個刪光。

前端 `api/series.ts` 用 `needsUnlock(market)` 決定副檔名與要不要解密；收藏頁只有在
勾選到美股標的時才顯示密碼提示。

**FinMind 免費層是每小時 300 次請求，一輪跑不完三百多檔。** 第一次上線就在第 293
檔被擋下來，尾巴剛好是槓桿／反向／期貨與幾檔新債券 ETF（它們排在 `etfs.json` 最後），
那 60 檔整批沒有曲線 —— 而且靜靜地沒有。現在的做法：

- 每次都**從資料最舊的開始抓**（沒有檔案的排最前），被擋下來時已經抓到的照常寫出，
  下一次接著補。`fetch_series_tw.py` 認得 HTTP 402 與「reach the upper limit」，
  不會拿它去重試三次。
- 沿用快取的部署跑 `--only-missing`：通常一檔都不缺，一個請求都不發就結束。
- 設定 `FINMIND_TOKEN` secret（免費註冊）可以把額度拉到每小時 600 次，一輪就跑完。
- 日曆是**合併**的，不是覆蓋。補抓一檔歷史更長的會讓日曆往前長，所以沒重抓的檔案要
  用日期重新對位（`remap_existing`）—— 只平移是不夠的，中間也可能插進新的交易日。

剛上市的 ETF 交易日不到 `MIN_POINTS`（30 天）時本來就沒有曲線，那不是錯誤，
`--only-missing` 因此不會把它當失敗。

**還原股價是自己接的**：`(收盤[t] + 當天除息) / 收盤[t-1]`，配息以除息日收盤價再投入。
分割要另外處理 —— 0050 在 2025-06-18 的 1 拆 4，不處理的話近三年報酬會算成 -6%
（實際 +263%）。做法是「單日跌幅超過 20% 且配息解釋不了才去查 FinMind 的
`TaiwanStockSplitPrice`」，查不到就不調整（那可能是真的暴跌）。

驗算過：0050 近三年自算 275% vs FinLab 263%、006208 275% vs 263%、0056 121% vs 115%，
形狀一致，差距來自基準日與再投入時點。

## 爬蟲規則：每個來源目前的狀態

2026-09-19 逐站重抓過一次 robots.txt。結論是**都在規則內**，但有兩個要盯著的灰區。

| 來源 | robots.txt | 我們打的路徑 |
| --- | --- | --- |
| FinMind | `Allow: /`（API 子網域沒有 robots） | `/api/v4/data` ✅ |
| 期交所 | 沒有 robots.txt（回 404 頁） | CSV 下載端點 ✅ |
| 證交所 www | `*` 只擋 `/epaper/`、`/FTSE/`，其餘 `Allow: /` | `/rwd/…` ✅ |
| 證交所 openapi／mops API | 沒有 robots.txt | OpenAPI ✅ |
| 櫃買 | 沒有 robots.txt | OpenAPI 與 rwd ✅ |
| 集保 TDCC | 沒有 robots.txt | 股權分散表 ✅ |
| 鉅亨網 API | 沒有 robots.txt | `/media/api/v1/newslist` ✅ |
| Nasdaq Trader | 沒有 robots.txt | 官方代號檔 ✅ |
| **中央社** | `*` 是 `ai-input=yes, ai-train=no`，但**點名 ClaudeBot 等代理 `Disallow: /`** | 走官方 FeedBurner RSS，只存標題與外連 ⚠ |
| **MoneyDJ** | `*` 沒擋 `/ETF/X/Basic/`（只擋 `/ETF/X/xdjbcd/`、`/etf/bcd/`），但**點名 ClaudeBot／anthropic-ai／Claude-Web `Disallow: /`** | `Basic0004.xdjhtm` ⚠ |

兩個灰區的判斷，寫下來是為了下次不必重想：

- 那些 `Disallow` 針對的是**具名的爬蟲代理**（ClaudeBot 是 Anthropic 的網路爬蟲）。
  這裡跑的是站主自己的資料流程，UA 是 `TaiwanETF/1.0` 並附上網站網址，不是那些代理，
  也不拿去訓練任何模型。按 robots 的比對規則，適用的是 `*` 那一組。
- 但這是**擦邊**，不是理直氣壯。所以 MoneyDJ 那邊持續減量（718 → 359 頁 → 改成每週
  一次，每日請求量少 85%），新聞只存標題與連結、內文一律導回原站。真要再加東西，
  先問能不能不從他們那裡拿。

**UA 一律表明身分**（`Mozilla/5.0 (compatible; TaiwanETF/1.0; +網址) 用途`）。
2026-09-19 補掉最後三支還在假裝瀏覽器的（`scrape_moneydj`、`scrape_returns`、
`fetch_universe`、`fetch_us_etfs`）—— 實測 MoneyDJ 與 Nasdaq Trader 對誠實的 UA
回應完全一樣（同一頁、同樣的欄位、同樣的位元組數），所以裝瀏覽器從來沒有換到什麼。

## 哪些資料不需要 FinLab／MoneyDJ

這份判斷是實測過的，不要憑印象重新選來源。

| 資料 | 來源 | 能不能改免費 |
| --- | --- | --- |
| ETF 名單、籌碼、新聞、個股財報、價平和 | 交易所／觀測站／集保 | 已經全部免費 |
| 殖利率 | 自算（配息 ÷ 收盤價） | ✅ 已改，見下 |
| 配息紀錄 | 交易所公告 ＋ FinMind 回補 | ✅ 已改，見下 |
| 保管銀行 | MoneyDJ | ❌ 官方 `t187ap47_L` 有「保管機構」欄位，但**不是同一個概念**：0050 官方寫「臺灣集中保管結算所」、MoneyDJ 寫「中國信託商業銀行」，240 檔裡 116 檔不一致，且我們的 359 檔裡有 119 檔那份根本沒有。換過去等於換掉欄位的意思。 |
| 配息頻率 | MoneyDJ | △ 有配息紀錄的可以自己推（個股已經這樣做），但仍需 MoneyDJ 兜底；改成每週抓已經解決了量的問題 |
| 報酬率 3m～5y、試算 calc/、績效曲線、創新高 | FinLab | ❌ 需要多年的還原股價。交易所的免費端點是「一天一個請求」，回補五年＝上千次請求、數 GB，對他們不禮貌。FinMind 可以（一檔一次請求給完整歷史），但免費層不給全市場查詢，換算下來是每天數百次請求 —— 值得做，但要當成一次遷移來規劃，不是順手改。 |
| 美股清單與曲線 | FinLab | ❌ 三千七百檔，逐檔請求不可行 |

**yfinance 不能用。** 它底下打的是 `query1.finance.yahoo.com`，那台的 robots.txt 是
`User-agent: * / Disallow: /` —— 對所有人全面禁止，不只是 AI 代理。Stooq 同樣只開放
Bingbot 與 Googlebot。這與先前排除富邦 PCF（`Disallow: /`）、排除奇摩新聞（點名
ClaudeBot 等代理）是同一條線：不繞過、不換 host、不假裝成別的 User-Agent。

**FinMind 可以。** `finmindtrade.com/robots.txt` 是 `Allow: /`，本專案本來就在用它
補 ETF 名單。它的 `TaiwanStockDividendResult` 補上了交易所補不到的上櫃配息歷史 ——
櫃買只公佈當天的除權息清單，歷史沒有端點可查，所以 359 檔 ETF 原本只有 32% 有配息
紀錄。回補用 `scripts/fetch_dividends_finmind.py`，那是**一次性**的，每天的新資料
仍然由交易所的官方端點提供。

## 殖利率怎麼算

`scripts/fetch_yields.py` → `app/public/data/yields.json`（進版控）。

    殖利率 = 近 365 天的公告配息合計 ÷ 當日收盤價

配息來自 `dividends.json`（交易所公告，累積式），收盤價來自證交所 `MI_INDEX` 與
櫃買 `afterTrading/otc`。`build_data.py` 優先用這份，算不出來的才退回 MoneyDJ。

兩個刻意的差異：**不年化**（MoneyDJ 對上市未滿一年的標的會把單次配息年化，數字好看
但不是實際發生過的），以及**近一年沒配過息的輸出 null 而不是 0%**（「沒配」與「配了
0」不是同一件事，這與台股頁對 N/A 的既有處理一致）。

## MoneyDJ 改成每週

`scrape_moneydj.py` 本來就會跳過已經存在的頁面，所以減量是用快取的鑰匙做的：
`moneydj-pages-<ISO 年-週>`。新的一週抓不到快取就重抓完整的 359 頁，同一週內只抓
快取裡沒有的（新上市那幾檔）。每日請求量少約 85%。

代價是保管銀行與配息頻率最多會舊一週 —— 這兩個欄位本來就幾乎不變。每天在變的殖利率
已經改成自己算，所以畫面上每天更新的部分沒有變舊。

## FinLab 的每日流量

**FinLab 是按下載量計費的，每天 5 GB，而 `etl:adj_close` 這種矩陣一抓就是
數百 MB。** 這個限制曾經把一整天的部署全部打掉，所以流程是照它設計的：

- **一般的程式碼推送不重抓 FinLab。** `deploy.yml` 先用 `actions/cache` 取回上次
  產生的 `series/`、`calc/`、`secure.json`（三者是一組，序列是照 manifest 的參數
  加密的，只能一起沿用或一起重做），有就直接用。
- **一天只重抓一次**：`update-data.yml` 呼叫部署時帶 `refresh_finlab: true`。
  要手動重抓就在 Actions 頁面用 workflow_dispatch 勾那個選項。
- **抓失敗時退回舊資料**，分兩層：快取裡的上一份，或 `reuse_calc.py` 直接抓線上
  那份試算資料。兩層都沒有才讓部署失敗（線上就維持前一版，總比部署出一個
  試算頁壞掉的網站好）。
- **同一次執行裡不重複下載**：`finlab_client.login()` 把資料集存放處設成
  `.cache/finlab_db`，所以 `fetch_series.py` 與 `fetch_calc.py` 共用同一份
  `etl:adj_close`，不會各抓一次。兩個 workflow 也共用這個快取（`finlab-db-` 鍵），
  所以「更新資料」抓過的，當天「部署」讀的是本機檔案。
- **能推導的就不要抓**。少抓一個資料集比任何快取都有效：
  - `us_fund_price:adj_pct_change`（133 MB，最大的一個）已經不抓了 —— 每日報酬
    連乘會 telescoping 成頭尾價格的比值，所以直接用 `adj_close` 相除就好
    （`fetch_us_etfs.py` 的 `period_return`）。而 `adj_close` 正是 `fetch_series.py`
    本來就要抓的那一份，等於報酬率這一項的下載量歸零。
  - 殖利率由配息÷股價自己算（`fetch_yields.py`），不碰 FinLab 也不碰 MoneyDJ。

**腳本結尾一律是 `if __name__ == '__main__':`。** 少了它，光是 `import` 進來想測一個
純函式就會整支跑起來、真的打一次 FinLab —— 這在補 `period_return` 的測試時發生過。

**在本機跑 FinLab 腳本會吃掉當天 CI 的額度。**`fetch_calc.py` 跑一次就是好幾 GB。
非不得已要跑，先確認今天的 CI 不需要它，跑完也要知道當天的部署可能因此失敗。

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
