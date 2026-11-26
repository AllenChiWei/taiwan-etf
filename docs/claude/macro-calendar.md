# 美國總經與台股行事曆

> 從專案根目錄的 CLAUDE.md 拆出來（2026-10-31）：CLAUDE.md 每次都整份載入，主題細節放這裡，改到這一塊時才讀。
> 什麼時候讀：改總經頁、行事曆頁、fetch_macro.py、fetch_calendar.py。

## 美國總經與台股行事曆

`/macro` 另含台灣景氣區塊（`macro.json.taiwan`）：國發會資料集 6099「景氣指標及燈號」的綜合分數／燈號，及財政部關務署資料集 6053「海關進出口貿易統計」的月出口總值年增率。`fetch_macro.py` 先從 data.gov.tw 資料集頁取得國發會當期 ZIP 連結，以處理每月更換的檔案識別碼；關務署 CSV 使用固定下載端點。台灣兩份來源各自失敗隔離，寫入 `meta.errors`，不影響其他總經數列。出口年增率以新臺幣千元出口總值按年月對去年同月計算，含復出口；國發會月資料可能回溯修正。頁面標示國發會與財政部關務署來源，依政府資料開放授權條款第 1 版顯名。

`/calendar` 的「行事曆／ETF 除息」分頁以 `?tab=` 保存在網址；預設行事曆分頁省略參數，切換後可重新整理或分享連結還原。

`/macro`：`scripts/fetch_macro.py` → `macro.json`，換算在 `lib/macro.ts`（`tests/macro.test.ts`）。
**FRED 上不是每條都能轉載** —— S&P、ICE 美銀債券指數、Moody's 那些著作權屬於第三方。只收原始
發佈者是美國聯邦政府機關的（BLS、BEA、DOL、Fed、EIA），加數列前先看 FRED 頁面的 Source。
JSON 存原始數列，年增率、月增、利差在前端算；CPI 年增率是**同月對去年同月**，不是往前數 12 筆。
原油商業庫存（WCESTUS1）FRED 沒有，直接解析 EIA 的歷史表。
美元兌台幣匯率（`DEXTAUS`，鍵 `usdtwd`）取自聯準會 H.10 外匯統計（每週一公佈前週日資料），原始發佈者屬美國聯邦政府機關，不受著作權保護；單條抓取失敗會記入 `meta.errors` 並略過，不擋整頁顯示。

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
