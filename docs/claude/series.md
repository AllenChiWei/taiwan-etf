# 績效曲線（FinMind）

> 從專案根目錄的 CLAUDE.md 拆出來（2026-10-31）：CLAUDE.md 每次都整份載入，主題細節放這裡，改到這一塊時才讀。
> 什麼時候讀：改 fetch_series_*.py、finmind_series.py、績效曲線。

## 績效曲線：兩個市場都是 FinMind，都不加密

    台股  FinMind TaiwanStockPrice ＋ 公告配息（自己接）-> series/tw/*.json
    美股  FinMind USStockPrice 的 Adj_Close（已含息）   -> series/us/*.json

**兩邊原本都走 FinLab**，那是付費訂閱資料，所以整份要加密，而加密需要
`SITE_PASSWORD` secret —— 沒設定時部署會把曲線整個丟掉，收藏頁的績效比較就一片
空白。那正是使用者回報「跑不出績效曲線」的原因，不是程式壞了。兩個市場都換掉
之後，這條鍊子整個消失，上線的資料裡也不再有任何付費內容。

美股那邊還順手修掉一個更嚴重的問題：**FinLab 的 `us_fund_price` 只還原分割、
不還原配息**，所以高配息標的的曲線長期在誤導人。2019-01 至 2026-09 實測：

           含息      純價格    差
    SPY    240.3%    204.5%    36 個百分點
    QYLD   117.2%    -13.0%   130 個百分點
    SCHD   179.7%    115.1%    65 個百分點

FinMind 的 `Adj_Close` 是含息還原的，所以美股曲線不必像台股那樣自己接，也不需要
配息紀錄與分割偵測。**表格的美股報酬率**底稿仍是 FinLab 的價格報酬（三千七百檔逐檔
請求不可行），但部署時 `apply_us_total_return.py` 會用已經抓好的曲線把有曲線的那些
（流動性門檻以上＋`fetch_series_us.py` 的 `ALWAYS`，目前 QQQ、QYLG）改成含息報酬、
標 `tr`，**不多發任何請求**；曲線超過 10 天沒更新的維持價格報酬，免得拿舊日期跟別人比。
畫面上含息的列有「含息」標籤。差距可以很大：AAPU 每年 12 月配一大筆資本利得，
近三年價格 +87%、含息 +141%。

換掉之後跟著拿掉的東西（都在同一次改動裡）：

1. `scripts/fetch_series.py`（FinLab 曲線）整支刪掉。
2. deploy 的「加密受保護的資料」與「確認價格序列沒有以明文上線」兩步 —— 沒有
   東西要加密，也沒有東西要檢查。
3. `app/vite-plugins.ts` 的 `dropPlaintextSeries` —— 它會刪掉 `dist` 裡所有明文
   序列，留著等於每次 build 都把曲線刪光。

**留著但目前不動作的**：`scripts/encrypt_data.py`（`PLAINTEXT_SERIES` 現在含兩個
市場）、`app/src/lib/secure.ts`、`app/src/components/PasswordGate.tsx`、
`api/series.ts` 的 `needsUnlock` 與 `getEncrypted`。哪天又有付費資料要上線，
把那個市場從 `PLAINTEXT_SERIES` 拿掉、讓 `needsUnlock` 對它回 true，並把 deploy
的加密步驟與明文檢查接回去（git 歷史裡有原本的寫法）。

**FinMind 免費層是每小時 300 次請求，一輪跑不完。**（台股 359 檔、美股 712 檔，
兩個市場共用同一個額度池；`finmind_series.py` 是它們共用的機制。） 第一次上線就在第 293
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
