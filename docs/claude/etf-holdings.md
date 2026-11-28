# ETF 持股（主動式換股、被動式全部持股、前十大、即將上市）

> 從專案根目錄的 CLAUDE.md 拆出來（2026-10-31）：CLAUDE.md 每次都整份載入，主題細節放這裡，改到這一塊時才讀。
> 什麼時候讀：改主動式 ETF 換股、fetch_active_holdings.py、被動式全部持股、fetch_etf_holdings.py、前十大持股、即將上市。

## 主動式 ETF 換股

台股頁的「主動式換股」分頁（`?view=active`），`scripts/fetch_active_holdings.py` →
`active_holdings.json`（進版控：最新持股＋近 60 次換股）。清單＝站主指定的幾檔（`PICKED`）
＋**每天重算的市值前十大主動式股票型 ETF**（證交所 `t187ap47_L` 發行單位數 × `STOCK_DAY_ALL`
收盤價；代號結尾 A、類型不含「債」），依代號排序。掉出前十的繼續更新。2026-10-26 起再加上**投信接得上的
所有主動式股票型**（站主要求擴大檔數，參考籌碼小宇）；新加入的第一次回補 25 個交易日。最上面的「合計持股」
是前十大（有每日持股的那幾檔）的「權重 × 市值」加總，期貨不算（`aggregateTop()`）。

**持股只在各投信自己的網站**。證交所 `rwd/zh/ETF/productContent?id=` 會給每檔的 PCF 網址，
但持股本身一家一種寫法。網站內部的基金代碼每次從各家基金清單查（`resolve_ids`），存進
`meta.ids`，某家清單被擋時沿用上次的（還有 `KNOWN_IDS` 當最底層）：

- **統一** ezmoney：沒有 robots.txt；第一個請求先發 cookie 再轉址回原網址（接受 cookie 是
  一般瀏覽器行為，不是偽裝）。`POST /ETF/Transaction/GetPCF`，`date` 是**公告日**（民國），
  公告的是前一個交易日的持股 —— 要某天的持股得查下一個交易日；公告日在未來時要用
  `specificDate:false`（網頁預設的「最新」），指定日期模式查不到。
- **復華** fhtrust：robots 只擋 GPTBot。`GET /api/assets?fundID=ETF23&qDate=YYYY/MM/DD`。
  注意 `/api/ETFPcf` 是現金申購的 PCF，**沒有股票籃子**，別用它。
- **中信**：robots `Allow: /`。先 `POST home/AuthToken`（token 用字串 `www.ctbcinvestments.com`，
  網頁自己也是這樣領），拿到的工作階段 token 再打 `etf/Buyback`（`FID` 是 E0038 這種內部碼）。
  持股日期看「每受益權單位淨資產價值DATE」，**不是公告日**。前面有 Incapsula：urllib 要補
  `Accept` 標頭、而且**不能帶它發的 cookie**；同一個 IP 請求太密（例如回補）之後會被擋一陣子，
  這時保留舊資料、隔天再補，不要想辦法繞。
- **群益**：robots `Allow: /`。API 在 `/CFWeb`（`assets/conf/app.json` 寫的）。`POST api/etf/items`
  要送 `null` body（空 body 回 411），回應外面包一層 `data`；`api/etf/buyback {fundId, date}`，
  date 是公告日、持股日期是 `pcf.date2`。
- **元大**：robots `Allow: /`。`etfapi.yuantaetfs.com/ectranslation/api/bridge?FuncId=PCF/Daily&ticker=代號`。
- **野村**（2026-10-26）：沒有 robots.txt（`/robots.txt` 回首頁 HTML）。Angular 前端，`apiUrl` 是
  `/API/ETFAPI/api/`；`POST Fund/GetFundAssets {FundID: 證券代號, SearchDate: "YYYY-MM-DD"}`（寫成 `2026/10/22` 回 400），
  持股日期是 `FundAsset.NavDate`，`Table` 依類別分表、每表前四欄＝代號、名稱、股數、權重。
- **凱基**：robots 沒有限制。`POST /Fund/RedemptionVC fundID=J024` 回 HTML 片段，持股日期是
  「(YYYY/MM/DD)每受益權單位淨資產價值」的括號；基金代碼從下拉選單用簡稱對。

- **台新**（2026-11-21）：robots.txt 只有 Googlebot／AdsBot 的規則。`GET /ETF/Home/Pcf/{代號}?FundType=ALL&DataDate=公告日`
  回整頁 HTML，持股表四欄＝代號（`2330 TT`、`GOOGL US`）、名稱、股數、權重；期貨表是名稱、契約年月、口數、權重。
  持股日期是「YYYY/MM/DD每基數實際申購總價金」那個日期（公告日的前一個交易日；全球型 00986A 再晚一天）。
  網址直接用證券代號，不用查內部碼。

**2026-11-21 逐家查過、還沒接的**（依市值）：安聯 00984A／00993A／00412A／00402A **做不到** —— 資料在
`allianzetf.webtech888.com/webapi/Fund/GetFundAssets`（robots 對一般程式 Allow、`Content-Signal: use=reference`），
但 Cloudflare 對非瀏覽器一律 403，不偽裝。兆豐 00996A（megafunds 沒有 robots.txt）、摩根 00401A／00989A
（jpmrich 沒有 robots.txt）、聯博 00404A（abfunds 只擋系統目錄）、第一金 00994A／00408A（fsitc 沒有 robots.txt）、
施羅德 00419A：robots 都沒擋，**還沒拆 API**，下一個接時從這裡開始。永豐 00410A、玉山 00413A 的網域還沒找到
（sinopacfunds.com.tw、esunam.com.tw 查不到 DNS）。查法腳本：`D:/ai/_tmp/scripts_iso/active_robots.py`、`active_uncovered.py`（暫存，可能被清掉）。

**國泰（00400A）、富邦（00405A）做不到**，兩檔都在市值前十：cathaysite.com.tw 對表明身分的 UA 連 robots.txt 都回 403。富邦也
一樣（`Disallow: /`）。統一的 robots.txt 會轉址回自己，看起來像擋程式，實際上是 cookie 檢查。

**換股要扣掉資金進出**（`diff()` 與 `lib/active.ts`）：主動式 ETF 是現金申購，資金流入那天
經理人會把每一檔同比例加一點。先取兩天都有的持股「股數比值的中位數」當資金進出比例 `f`，
偏離它超過 0.5% 才算加碼／減碼。**實測 f 一直是 0**（這幾檔多數日子股數完全不動，資金先放現金），
所以它是保險：哪天有經理人改成同比例攤入，清單也不會整排變成加碼。
例外是**新上市的建倉期**：新 ETF 第一次出現時往回查 25 天，會抓到上市前分批建倉（2026-11-11 上市的 00418A：11-02 f＝+63.6%、11-05 +54%）。
`tests/active.test.ts` 的「單日 |f| ≥ 50% 代表比錯日子」原本一律擋，這筆一進累積資料，**每天的「主動式換股」都會被擱置**（11-11 第一次發生）；
caf5f72 改成每檔前 10 筆只擋大量流出（f ≤ −50%），流入不設上限。本機重現：`PYTHONIOENCODING=utf-8 python scripts/fetch_active_holdings.py`
→ `cd app && node --test tests/active.test.ts`，跑完 `git checkout -- app/public/data/active_holdings.json`（腳本會改寫這個檔）。

**估值、換股成效、持股損益**（2026-10-26 站主要求，參考籌碼小宇；`prices_and_books()` 與 `lib/active.ts`）：
- 價格＝證交所 `MI_INDEX`／櫃買 `afterTrading/otc` 的每日行情（`fetch_chips.py` 同一組），均價＝成交金額 ÷ 成交股數。
  存在 `active_holdings.json` 的 `px`（只留換股日、持股日、帳本要用的日子，代號只留出現過的），`last` 是各代號最近收盤。
  第一次補 60 次換股的日子約 45 天 × 2 請求，`PX_DELAY` 3 秒（證交所查太快回 307）。
- 換股紀錄 items 第 6 欄＝當日均價、`v`＝[買進, 賣出] 估值（元）＝股數變化 × 均價，跟籌碼小宇的「持股淨買賣」
  同算法（00981A 10/22 都是 +3.66 億）；只算列出的變動與台股，張數變化可能含申贖 —— 畫面標「估值」。
- 換股成效（`scorecard`）：近 60 次每筆換股從當天均價到最新收盤的漲跌，金額加權，買進與賣出分開。
- 持股損益（`book`）：移動平均成本帳本，**從第一次有價格的那份持股起算（成本＝當天收盤）**，之後每份新持股
  用當天均價補差額；起算前沒有完整的每日持股（換股紀錄只記 >0.5% 的變動），不往前回推。海外股票、期貨不記。
- **經理人排行**（`lib/holders.ts` 的 `managerBoard`，主動式換股頁最上面）：選股力＝買進之後 − 賣出之後（`scorecard` 的兩個數），
  換股不到 10 筆的不排名。**股票反查 ETF**（`holdersOf`，個股頁「持有這檔的 ETF」）：主動式用每日完整持股、其他 ETF 用公會月報前十大
  （十名以外查不到，畫面有寫），同一檔以每日持股為準；近 60 次換股內剛剔除的也列出（權重 0）。

## 被動式 ETF 全部持股（申購買回清單＋公會季報 1% 以上，2026-11-28）

`scripts/fetch_etf_holdings.py` → `app/public/data/etf_holdings.json`（**只放最新一天、不累積、進版控**，
刻意與 `active_holdings.json` 分檔，避免主動式換股頁混入被動式資料）。CI 驗證由
`scripts/verify_etf_holdings.py` 與 `scripts/test_fetch_etf_holdings.py` 負責，在 `update-data.yml`
的 `phold` 區塊緊接在 `hold`（主動式換股）後面執行。

### 來源與各家欄位細節（誠實 UA）

共用 `fetch_active_holdings.py` 既有 8 家投信連線與節流設定，涵蓋 `etfs.json` 的台股被動式
（`cat-domestic`，8 家共 33 檔）及海外被動式（`cat-foreign`，依最久未更新順序用剩餘額度輪替，近 5 天內已抓過不重抓）；
單輪請求上限預設 58 次：

- **群益**（4 台股＋5 海外）：`POST /CFWeb/api/etf/items`（body `null`）查 `fundNo` → `POST /buyback {fundId, date:null}`；
  持股在 `data.stocks`（`stocNo, stocName, share, weight`），日期在 `pcf.date2`，`basis='weight'`。
- **復華**（2 台股＋5 海外）：`GET /api/fundList?ec001=3` 查 `fundID` → `GET /api/assets?fundID=&qDate=YYYY/MM/DD`；
  持股在 `result[0].detail`（只收 `ftype` 含「股票」者；`stockid, stockname, qshare, prate_addaccint`），`basis='weight'`。
- **元大**（10 台股＋12 海外）：同 `bridge?FuncId=PCF/Daily&ticker=代號&date=YYYYMMDD`，**回應頂層沒有 `Data` 包裝**
  （直接是 `PCF, InKind, Cash, FundWeights, Memo`）。被動式的 `FundWeights.StockWeights` 為空，成分在
  `InKind.FundComposition`（`stkcd, name, qty, cashinlieu`，只有每申購基數股數、無權重）。
  - 權重換算：`qty × 收盤價 ÷ 分母`。收盤價直接共用 `fetch_active_holdings.day_prices()` 寫在 `.cache/day_prices/<day>.json` 的證交所 `MI_INDEX`／櫃買 `afterTrading/otc` 行情，排程緊接在 `hold` 後跑時 0 額外請求。
  - 分母優先從 `PCF`（`(totalav / osunit) * baseunit`、`nav * baseunit`、`stock_val + Cash`、`totalav`）驗證股票佔比落在 75%～105%（`denom='nav'`）；換算不到時退回股票部位合計為 100%（`denom='stock'`），前端註明口徑。至少 85% 成分找得到台股收盤價才採信，海外元大 ETF 若僅有 `InKind` 會自動略過。
- **統一**（1 台股＋2 海外）：`GetPCF`（`specificDate:false`），只收 `AssetCode == 'ST'`。
- **凱基**（4 台股＋1 海外）：`RedemptionList` 下拉選單名稱與 `etfs.json` 簡稱不同（例 `00915 凱基優選高股息30` vs `凱基台灣優選高股息30 ETF基金`、`00938`、`00952`、`009816`），`match_kgi_code()` 合併 `etfs.json`＋`top10.json` 別名比對，再 `POST /Fund/RedemptionVC`。
- **中信**（6 台股＋14 海外）：不帶 cookie、間隔拉長到 3.5 秒、每輪最多 7 檔，遇 302／403／429 或 Incapsula HTML 回應立即熔斷並保留前版。
- **野村**（2 台股＋6 海外）：`POST Fund/GetFundAssets` 直接用證券代號，排除期貨／債券／現金表。
- **台新**（4 台股＋6 海外）：`GET /ETF/Home/Pcf/{代號}?FundType=ALL` 直接用證券代號，台股去 ` TT`、排除期貨表。
- **國泰、富邦（官網擋程式，不偽裝）**：改查投信投顧公會「季報持股 1% 以上」`IN2630.aspx?pid=IN22601_05`
  （ASP.NET 先 GET 取 `__VIEWSTATE` 與動態選單再 POST，寫法同 `fetch_top10.py`）。季別沒變只發 1 個 GET；
  輸出至同一個 `etf_holdings.json`，`basis='quarterly1pct'`、`asof='YYYYQ#'`、`src='投信投顧公會季報'`，且絕不覆蓋已有每日 PCF 的 ETF。

### 前端優先順序與重跑方式

`app/src/lib/overlap.ts` 的 `holdingsOf()` 採用四層優先序（持股健檢、配息試算展開明細、兩檔持股比對、收藏重疊、股票反查 ETF 共用）：
1. 主動式每日持股（`active_holdings.json`，`kind='daily'`）
2. 被動式每日全部持股（`etf_holdings.json` 投信 PCF，`kind='pcf'`）
3. 公會季報持股 1% 以上（`etf_holdings.json`，`kind='quarterly'`，**只在涵蓋權重高於月報前十大時採用**）
4. 公會月報前十大（`top10.json`，`kind='monthly'`）

「前十大是已知下限」只在實際使用第 4 層月報時顯示；配息試算展開面板在非月報時標題改「持股明細」並以固定高度可捲動容器顯示全部成分股。缺檔時回 `null`、行為完全退回舊版。

本機重跑與驗證：
```bash
python scripts/test_fetch_etf_holdings.py
PYTHONIOENCODING=utf-8 python scripts/fetch_etf_holdings.py
python scripts/verify_etf_holdings.py app/public/data/etf_holdings.json
cd app && node --test tests/compare.test.ts tests/portfolioXray.test.ts
```

## 海外 ISIN →「代號 交易所」對照（isin_ticker.json，2026-11-28）

`scripts/gen_isin_ticker.py` → `app/public/data/isin_ticker.json`（進版控，結構 `{"meta":{"updated","count"},"map":{ISIN:"代號 交易所"},"miss":{ISIN:"最後查詢日"}}`）。
在 `update-data.yml` 的 `isinmap` 區塊緊接在 `phold`（被動式持股）之後執行（`--max 300`，`continue-on-error: true`，失敗保留前一版）。

- **收集來源與非股票排除**：合併掃描 `top10.json`＋`etf_holdings.json`（排除債券／槓反／期貨 ETF），並於成分層過濾非股票項目：債券／票券／基金／ETF／REIT 類型與名稱字樣、`XS`／`US912`（含 `US9128`）／`TW` 開頭、利率＋到期日格式債券名稱（如 `T 4 3/4 05/15/55`）及台股代號。
- **增量、冷卻與節流**：首次尚無 `isin_ticker.json` 時先以既有 `app/src/lib/isinTicker.ts`（396 筆）作種子；平常只查新 ISIN，單次上限 `--max 300`；查無對應者記在 `miss`、30 天內不重查；OpenFIGI v3 無 key 上限每分鐘 25 次，維持每批 10 筆、節流 2.6 秒與誠實 UA。網路或 API 失敗時不中斷腳本，保留已完成進度或既有檔案，且不把失敗批次誤記進 `miss`。
- **前端按需載入與後備**：保留 `app/src/lib/isinTicker.ts` 當靜態後備；只在持股健檢（`PortfolioXray`）與配息試算持股展開面板（`EtfHoldingsTable`）需要時透過 `fetchIsinTicker()` 載入 `isin_ticker.json`，由 `lib/isinTickerData.ts` 的 `mergeIsinTickerMap()` 合併（同 ISIN 以資料檔優先，缺檔照舊退回內建表）。

本機重跑與驗證：
```bash
python scripts/test_gen_isin_ticker.py
PYTHONIOENCODING=utf-8 python scripts/gen_isin_ticker.py --max 300
cd app && node --test tests/portfolioXray.test.ts
```

## 前十大持股

台股清單點 ETF 名稱跳出的視窗（`Top10Modal`、`lib/top10.ts`）。`scripts/fetch_top10.py` →
`top10.json`（進版控）。來源是投信投顧公會「基金投資明細－月前十大」
（`IN2629.aspx?pid=IN22601_04`，ASP.NET 表單：先 GET 拿 `__VIEWSTATE` 再 POST），依基金類型
查（AH 開頭是指數股票型、AL 是主動式），**所有投信都有**，包括自己網站擋程式的國泰、富邦。
代價是**月報**（上個月底，約每月 10 號後更新）；站上追蹤的六檔主動式 ETF 前端改用每日持股。

前十大表格只有基金全名，代號對照用公會 `etf_info2.aspx?txtYM=`（上市上櫃都有），再用證交所
`t187ap47_L` 補當月才成立的新基金。比對前要去掉名稱後面的法定警語（「(本基金之配息來源
可能為收益平準金…)」「(本基金採匯率避險)」）—— 第一版沒去掉，340 檔有 162 檔對不到；
傘型基金只比「之」後面的子基金名。雙幣別代號（00625K、00687C）前端退回本尊。

同一個視窗上方是**受益人數**（2026-10-27）：`scripts/fetch_etf_holders.py` → `etf_holders.json`
（進版控，`lib/etfHolders.ts`）。集保「集保戶股權分散表」（`opendata.tdcc.com.tw/getOD.ashx?id=1-5`，
政府開放資料、無 robots.txt）持股分級 17＝合計：人數＝受益人數、股數÷1000＝流通張數（週變化＝淨申贖）。
**集保只給最新一週**，所以逐週累積（同週重跑覆蓋同一筆），週／4 週變化要等資料累積才會出現。
2026-11-26 於台股頁新增**資金流向榜**（`?view=flow`，`components/EtfFlow.tsx`），將 `etf_holders.json` 與
`etfs.json`、`yields.json` 交叉排行全市場 1 週／4 週受益人與淨申贖張數／估算金額（Δ張數 × 最新收盤價 × 1,000，
標明為估算），支援分類篩選與搜尋；不逐檔抓取部署時才產生的 `calc/tw/*.json`，改在 `detectSplit()` 以相鄰有效週的
「流通張數比 × 人均張數比」偵測分割／反分割（如 00662 1 拆 5），標示徽章並排除於申贖金額排行與合計（受益人數照常計算）。
折溢價沒做：證交所即時淨值 `mis.twse.com.tw` 的 robots.txt 全站禁止；MoneyDJ 頁面雖有欄位，但
robots.txt 檔頭聲明禁止未經同意的資料探勘 —— 要做需站主決定來源。

**查不到的**：槓桿／反向、期貨、不動產、平衡型 —— 公會那幾個類型的查詢回空的（它們主要
持有期貨、現金或受益憑證），畫面依分區說明原因（`missingReason()`）。

### 兩檔持股比對（`#/compare?a=&b=`，2026-11-19）

站主：任選兩檔 ETF 比共同持股與比例。`routes/ComparePage.tsx` 只呈現，算法在 `lib/overlap.ts` 的
`holdingsOf()`／`compareHoldings()`（`tests/compare.test.ts`）。每檔挑最完整的來源：主動式（`active_holdings.json`
有的）用投信每日持股（不只前十大，各檔約 30～75 檔），其他用公會月報前十大；**期貨不算持股**（`active.ts` 的
`isStock`，和「合計持股」同一條）。重疊度＝Σ 共同持股 min(甲, 乙)，只算看得到的部分，是下限；兩邊來源不同時畫面
提示日期不同。代號比對（同一檔股票各家名稱不同，名稱取短的）。收藏頁的「持股重疊」（`OverlapSection`）在 2026-11-26 同步改用同一組
`holdingsOf()`／`compareHoldings()`，主動式一樣吃每日完整持股，每列附「到比對頁看完整差異」直達 `/compare?a=&b=`。

## 即將上市（其實是「還沒上市」）

台股頁的「即將上市」分頁，`scripts/fetch_upcoming.py` → `upcoming.json`（部署時產生）。
**已上市的一律不列**（站主指定）；前端 `stillUpcoming()` 再依上市日濾一次，因為資料一天
才更新一次。

**官方沒有「募集中」的結構化清單**（查過證交所 OpenAPI `company/applylistingLocal`／
`newlisting` 只有公司股票、集保 `api/etf/product` 只有已上市、集保 `api/onshore/announce/
info-new` 只有沒代號的「基金成立」事件、投信投顧公會是 ASP.NET postback）。所以：

1. 代號從鉅亨網 ETF／台股分類近 75 天的新聞標題抓（`00\d{3,4}[A-Z]?`），標題有「募集／
   開募／新秀／掛牌」的連內文一起掃，扣掉 etfs.json 裡已上市的。
2. 每個代號用鉅亨網關鍵字搜尋（`ess.api.cnyes.com/ess/api/v1/news/keyword`），讀標題、摘要與
   內文推名稱、投信、開募日、上市日 —— **只看代號附近到下一個代號為止的那一段**，免得多檔
   合寫的文章把別檔的日期算進來；投信只看代號前 40 字。**內文與摘要只在執行時用，不存。**
3. 上市前一天證交所 e添富發布「新上市ETF 相關簡介」（`newsCategory=ff8080818b7e232e018b8336a1b90021`）
   後，改用簡介的官方規格。

推不出來的欄位就留空，畫面標明「從新聞推得，以投信公告為準」。鉅亨網新聞頁將近 200 KB、
常常讀到一半斷線（`IncompleteRead`），所以 `article_text()` 會重試三次。
