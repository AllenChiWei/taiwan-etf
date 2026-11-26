# 試算（定期定額、配息試算的個股）

> 從專案根目錄的 CLAUDE.md 拆出來（2026-10-31）：CLAUDE.md 每次都整份載入，主題細節放這裡，改到這一塊時才讀。
> 什麼時候讀：改試算頁、配息試算、stock_dividends。

## ETF 填息摘要（`calc/fill.json`，2026-11-26）

`scripts/fetch_calc.py` 使用 FinLab 原始收盤價與還原收盤價推算的配息事件，順便產生部署時的 `calc/fill.json`；只列 ETF，每檔保留最近 12 次除息。填息以除息日前一交易日的「只還原分割」收盤價為基準，顯示首次回到基準的交易日數；截至最新收盤仍未回到基準時，顯示目前價差百分比。

近三年單次配息變異以分割還原後配息的母體標準差 ÷ 平均數（CV）表示，少於兩筆不顯示數值。單檔 ETF 頁與 `/calc` 都讀此摘要；檔案缺少或資料沒有該代號時隱藏區塊，不影響既有試算。未填息不等於總報酬為負，因摘要不計期間收到的配息與再投入。`deploy.yml` 的 `finlab-data-v4` 快取包含此檔。

## 定期定額 vs 一次投入

試算頁的回測本來就同時吃「單筆投入」與「每月定期定額」兩個欄位，但沒有把它們
擺在一起比。對照組是**同樣的總投入金額**（`result.totalInvested`）全部在起始月
投進去，其餘條件（配息處理、手續費、整股）完全相同，只有在真的有定期定額時才算。

畫面上必須說清楚這是**事後才知道的比較**：當時不一定拿得出那筆錢，而且一次進場
承擔的風險不同。另外年化（IRR）的差距通常比期末總值小很多 —— 定期定額的錢平均
只待了一半的時間，實測 0050 全期間：定期定額總報酬 279%／年化 34.1%，一次投入
總報酬 641%／年化 29.9%，**總值差 95% 但年化反而是定期定額高**。只秀總值會誤導。

## 配息試算的個股

配息試算原本只有 ETF 與 `EXTRA_STOCKS`（有 FinLab 逐月序列 `calc/tw/*.json` 的）。其他上市櫃
普通股與特別股（`^[1-9]\d{3}[A-Z]?$`，例如 2887E）走 `scripts/fetch_stock_dividends.py` → `stock_dividends.json`，
前端 `seriesFromStock()` 把除息紀錄轉成同樣形狀的序列，`projectHolding` 以下完全共用。

- **上市**：`TWT49U` 一年一個請求、全市場。「權息」的權值＋息值是合併計價，最近一次用
  `t187ap45_L` 的宣告現金股利換掉，補不到的標 exact=0；純「權」不收。證交所的金額有計算
  誤差（台積電 4.5 寫成 4.50002），存檔取到小數第四位。
- **上櫃**：官方**只有當天**（`tpex_exright_daily`）與預告；`mopsfin_t187ap39_O` 停在 110 年，
  不能用。歷史用 FinMind `TaiwanStockDividend`（每股現金＋除息交易日）一檔一個請求，每次
  `FINMIND_BUDGET_STOCKS` 檔，做過的記在 `meta.backfilled`，碰到 402 就停、下次接著補。
- **名單是輸出的骨架**：某個市場的收盤行情沒抓到（2026-09-25 中秋休市時櫃買回空的），
  那個市場沿用上一版；檔數比上一版少一成以上就不寫出、讓 `sdiv` 擱置。少了這兩道，
  891 檔上櫃的配息歷史被整批丟掉過（它們在 `meta.backfilled` 裡，不會再回補，是靠 git 還原的）。
- 沒配過息、停配的也列進選單（站主要求先記著持股），選單標「尚未配息／近期未配息」，
  明細顯示「待配息」，有除息紀錄後自動算進來。所以 `stock_dividends.json` 保留 ev 為空的個股。
- 上市未滿三個月的 ETF 沒有 `calc/tw/*.json`（`fetch_calc.py` 要 60 個交易日），配息試算
  改用 `dividends.json`＋`yields.json` 的收盤價組同樣形狀的序列，頻率照 `etfs.json` 的公告。

### 多帳戶

持股多一個 `acct`（配息進哪個帳戶），帳戶名稱與順序存在 `twetf.accounts`；舊資料載入時歸到第一個
帳戶（「帳戶A」）。站主的用法是**一檔只在一個帳戶**，所以選單照舊排除已持有的代號、明細直接改帳戶。
總帳戶以 `mergeByCode` 一檔一列算，各帳戶各算各的（`lib/accounts.ts`，有測試）；配息對股數是線性的，
各帳戶相加等於總額。

### 美股 ETF

配息試算也收美股 ETF（清單是 `us_etfs.json`，持股存成 `{code, shares, m: 'us'}`）。
**FinMind 沒有美股配息的資料集**，所以配息從 `USStockPrice` 的 Close 與 Adj_Close 比值
在除息日的跳動反推（`lib/usDividend.ts`）：SCHD、QYLD、SPY、TLT 實測都對得上實際水準，
但 Adj_Close 只到小數第二位，誤差約 1 美分，畫面一律標約略值；比值跳超過 15% 的是分割，丟掉。
匯率是 FinMind `TaiwanExchangeRate` 的台銀即期買賣中價。兩者都是**瀏覽器直接抓**（跟財務
分析儀表板同一條路）：一檔一個請求、匯率一天一個並存在 localStorage，部署流程不碰。
金額在進 `projectHolding` 前就乘上匯率，下游完全不知道有美元。

## 持股穿透健檢（`/dividend?view=xray`，2026-11-26）

配息頁上方分頁切換「配息試算／持股健檢」（路由參數 `?view=xray`），計算全在 `lib/portfolioXray.ts`
（`tests/portfolioXray.test.ts`），元件在 `components/PortfolioXray.tsx`。不依賴 `calc/index.json`
（FinLab 額度用完時仍可使用）。

- **穿透展開**：讀取 `localStorage` 的 `twetf.holdings`（多帳戶先經 `mergeByCode` 合併），報價取
  `yields.json`（ETF）、`stock_dividends.json`（個股）與美股 FinMind 即時日價×匯率；展開沿用
  `lib/overlap.ts` 的 `holdingsOf()`（主動式用每日完整持股、其餘用公會月報前十大＝已知下限，
  月報同時保留資產類型 `type` 以排除債券與國外掛牌 ETF）。
  - 台股普通股維持 `holdingLinkKind(code) === 'stock'`（排除主動式 `TX`／`WTX` 期貨部位）。
  - 海外股票（海外 ETF 與跨市場主動式 ETF）同樣依 `ETF 市值 × 該股佔淨值%` 計入曝險排行，
    並單獨彙總「海外個股曝險」：公會月報的 ISIN 透過靜態對照表 `app/src/lib/isinTicker.ts` 轉為
    「代號 交易所」並做交易所別名正規化（如 `UW→US`、`JT→JP`、`KP→KS`、`GY→GR`、`C1/C2→CH`），
    與主動式 ETF 的海外持股合併為同一列；查無對照的 ISIN 仍保留呈現。名稱優先取中文（含括號內中文），
    其次做輕度英文標點整理。
  - 債券 ETF（`cat-bond`）、美股掛牌 ETF（`m === 'us'`，站內無成分資料）、槓桿／反向與期貨 ETF、
    以及無可展開股票成分之 ETF 歸為無法穿透，仍計入總市值分母。
- **ISIN 對照表更新**：`python scripts/gen_isin_ticker.py` 讀取 `app/public/data/top10.json`
  非台股股票 ISIN，呼叫 OpenFIGI v3 mapping API（免 API key；每批 10 筆、節流 2.6 秒、遇 429/5xx
  自動重試），壓低美國場外粉紅單（`Foreign Sh.`／OTC）並優先選各國主要交易所綜合代碼，輸出至
  `app/src/lib/isinTicker.ts`。預設保留既有對照、僅補查新 ISIN；加 `--refresh` 才全量重查。
- **四項交叉健檢**（**僅針對台股標的**，`market === 'tw'` 嚴格隔離避免 `6857 JP` 等海外代號誤配；
  皆容許部署時 JSON 缺檔，缺檔各自降級顯示）：
  1. `margin_state.json`（`api/market.ts`）：低於 130%／150% 維持率警戒（XQ 公式估算值）。
  2. `cb.json`：排除交換債（`exch: true`），標示強制贖回、近月餘額減少、負溢價與價內轉換賣壓。
  3. `calendar.json`：未來 14 天除權息、法說會、股東會（同時含直接持有 ETF 除息與穿透台股成分股）。
  4. `news.json`：公開資訊觀測站近期重大訊息（僅標題與外連）。
