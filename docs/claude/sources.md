# 資料來源規則與流量（爬蟲、FinLab、MoneyDJ、殖利率）

> 從專案根目錄的 CLAUDE.md 拆出來（2026-10-31）：CLAUDE.md 每次都整份載入，主題細節放這裡，改到這一塊時才讀。
> 什麼時候讀：新增或改任何抓取來源、碰 FinLab／MoneyDJ、改殖利率算法。

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
| FRED | `*` 只擋圖片與搜尋頁，`Crawl-delay: 1` | `/graph/fredgraph.csv` ✅（每次間隔 1.5 秒） |
| EIA | `*` 是 `Allow: /`，`/dnav/` 不在禁止清單 | `dnav/pet/hist/LeafHandler.ashx` ✅ |
| 公開資訊觀測站舊版 mopsov | `*` 是 `Disallow: /`（只開放 bingbot） | **不抓**；只當使用者點的外連 |
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

**官方數字有變就更新**（2026-09-24 起，站主要求）：`fetch_dividends.py` 的 `upsert()` 與
`fetch_stock_dividends.py` 的 `merge()` 在新抓到的是精確值、而既有的不精確或金額不同時換掉，
log 印「更正 代號 日期：舊 -> 新」。不精確的（「權息」合併計價）仍然不蓋掉精確的 —— 那筆
可能已經用宣告的現金股利修正過。上線當天兩支實跑都是「更正 0 筆」，沒有來回翻的情形。

## 殖利率怎麼算

`scripts/fetch_yields.py` → `app/public/data/yields.json`（進版控）。

    殖利率 = 最近一次除息金額 × 每年配息次數 ÷ 當日收盤價

配息來自 `dividends.json`（交易所公告，累積式），收盤價來自證交所 `MI_INDEX` 與
櫃買 `afterTrading/otc`。`build_data.py` 優先用這份，算不出來的才退回 MoneyDJ。

**視窗兩端都要卡。** 交易所會提前公告除息，`dividends.json` 因此含有還沒到的日期；
只設下界的話那筆錢還沒發、股價也還沒除息，分母是含權的，兩頭都偏。2026-09-22 有六檔
中鏢，00930 因此顯示 7.23% 而不是 3.95%。

**一律年化，不分配息史長短**（2026-09-23，站主指定）。原本用實際近 12 個月合計，
對今年才上市的標的會低到失真 —— 00400A（月配、7 月才第一次配）顯示 2.32%，實際水準
是 9.30%；00406A 只配過兩次，顯示 2.70% 而不是 16.83%。全站 36 檔是這種情況，幾乎全
是今年上市的主動式 ETF，在主動那一區看起來整片都錯。

**代價寫在這裡，不要當成 bug 再改回去**：年化是推估，假設接下來一年配得跟最近一次
一樣多。某一次加發會被乘上次數（00888：實際近一年 10.54%，年化 19.39%），減配也會
立刻反映。所以每一列都留著 `y12`（近 12 個月實際換算）、`sum`、`n`、`last`、`fpy`，
要回頭對帳或改回去都拿得到數字。

每年配息次數優先從**實際除息日的間隔**推（中位數 30 天 → 12 次），推不出來（只配過
一次）才退回 `etfs.json` 既有的頻率標籤；兩邊都沒有就退回近 12 個月實際。

**最近一次除息在一年以前的輸出 null 而不是 0%**（「沒配」與「配了 0」不是同一件事，
也不該拿一年多前的金額去年化；這與台股頁對 N/A 的既有處理一致）。

## MoneyDJ 改成每週

`scrape_moneydj.py` 本來就會跳過已經存在的頁面，所以減量是用快取的鑰匙做的：
`moneydj-pages-<ISO 年-週>`。新的一週抓不到快取就重抓完整的 359 頁，同一週內只抓
快取裡沒有的（新上市那幾檔）。每日請求量少約 85%。

**某一檔沒有頁面時沿用上一版**（`etfdata.load_rows`）：MoneyDJ 下架某一檔（2026-09-28 起 00793B
回「查無此ETF」，交易所那邊還在交易）或偶發逾時，不再讓整份台股清單擱置；`scrape_moneydj.py`
只在失敗超過 5% 時中止。上一版也沒有的新代號仍然會擋下建置。

代價是保管銀行與配息頻率最多會舊一週 —— 這兩個欄位本來就幾乎不變。每天在變的殖利率
已經改成自己算，所以畫面上每天更新的部分沒有變舊。

## FinLab 的每日流量

**FinLab 是按下載量計費的，每天 5 GB，而 `etl:adj_close` 這種矩陣一抓就是
數百 MB。** 這個限制曾經把一整天的部署全部打掉，所以流程是照它設計的：

- **一般的程式碼推送不重抓 FinLab。** `deploy.yml` 先用 `actions/cache` 取回上次
  產生的 `calc/` 與 `highs.json`，有就直接用。績效曲線有自己的快取（`series-`），
  因為它跟 FinLab 無關、而且每次部署都可能補幾檔 —— 共用的話那些補到的會留不住
  （踩過：線上檔數在 293 與 273 之間跳）。
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
    （`fetch_us_etfs.py` 的 `period_return`）。少抓的那一份比改抓的那一份大。
  - 殖利率由配息÷股價自己算（`fetch_yields.py`），不碰 FinLab 也不碰 MoneyDJ。

**腳本結尾一律是 `if __name__ == '__main__':`。** 少了它，光是 `import` 進來想測一個
純函式就會整支跑起來、真的打一次 FinLab —— 這在補 `period_return` 的測試時發生過。

**在本機跑 FinLab 腳本會吃掉當天 CI 的額度。**`fetch_calc.py` 跑一次就是好幾 GB。
非不得已要跑，先確認今天的 CI 不需要它，跑完也要知道當天的部署可能因此失敗。
