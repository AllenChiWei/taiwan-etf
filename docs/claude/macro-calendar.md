# 美國總經與台股行事曆

> 從專案根目錄的 CLAUDE.md 拆出來（2026-10-31）：CLAUDE.md 每次都整份載入，主題細節放這裡，改到這一塊時才讀。
> 什麼時候讀：改總經頁、行事曆頁、fetch_macro.py、fetch_calendar.py。

## 美國總經與台股行事曆

`/macro`：`scripts/fetch_macro.py` → `macro.json`，換算在 `lib/macro.ts`（`tests/macro.test.ts`）。
**FRED 上不是每條都能轉載** —— S&P、ICE 美銀債券指數、Moody's 那些著作權屬於第三方。只收原始
發佈者是美國聯邦政府機關的（BLS、BEA、DOL、Fed、EIA），加數列前先看 FRED 頁面的 Source。
JSON 存原始數列，年增率、月增、利差在前端算；CPI 年增率是**同月對去年同月**，不是往前數 12 筆。
原油商業庫存（WCESTUS1）FRED 沒有，直接解析 EIA 的歷史表。

`/calendar`：`scripts/fetch_calendar.py` → `calendar.json`（除權息預告＋股東會），財報與月營收的
法定期限（證交法 36 條：3/31、5/15、8/14、11/14；月營收每月 10 日）與台指期月結算（第三個星期三，
遇假日順延）由 `lib/calendar.ts` 依規則算，畫面標「規則」。**法說會刻意沒有**：官方一覽表只在
mopsov，那裡的 robots 是 `Disallow: /`，新版觀測站也是轉呼叫它（2026-09-27 查過）。

**ETF 的金額比交易所早**：預告表對 ETF 常寫「待公告實際收益分配金額」。投信的收益分配公告轉載在
e添富 `ETFortune/announcementList?type=distribution`（一頁最多 10 則、不能用代號篩選，只能從最新往回翻），
內文固定有「每受益權單位配發金額」（實際）或「預估配發金額」（評價結果公告）、除息交易日、發放日。
解析結果存 `.cache/etf_notices.json`（deploy 用 actions/cache 保留），只抓新的。畫面上預估的標「預估」。
發放日從 e添富 `dividendList` 一次取得。集保 fundclear 的配息 API 只給 SITCA 上的 PDF 連結（DocuWorks
圖檔），不用。
