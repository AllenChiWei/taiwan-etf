# ETF 持股（主動式換股、前十大、即將上市）

> 從專案根目錄的 CLAUDE.md 拆出來（2026-10-31）：CLAUDE.md 每次都整份載入，主題細節放這裡，改到這一塊時才讀。
> 什麼時候讀：改主動式 ETF 換股、fetch_active_holdings.py、前十大持股、即將上市。

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

**國泰（00400A）、富邦（00405A）做不到**，兩檔都在市值前十：cathaysite.com.tw 對表明身分的 UA 連 robots.txt 都回 403。富邦也
一樣（`Disallow: /`）。統一的 robots.txt 會轉址回自己，看起來像擋程式，實際上是 cookie 檢查。

**換股要扣掉資金進出**（`diff()` 與 `lib/active.ts`）：主動式 ETF 是現金申購，資金流入那天
經理人會把每一檔同比例加一點。先取兩天都有的持股「股數比值的中位數」當資金進出比例 `f`，
偏離它超過 0.5% 才算加碼／減碼。**實測 f 一直是 0**（這幾檔多數日子股數完全不動，資金先放現金），
所以它是保險：哪天有經理人改成同比例攤入，清單也不會整排變成加碼。

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
折溢價沒做：證交所即時淨值 `mis.twse.com.tw` 的 robots.txt 全站禁止；MoneyDJ 頁面雖有欄位，但
robots.txt 檔頭聲明禁止未經同意的資料探勘 —— 要做需站主決定來源。

**查不到的**：槓桿／反向、期貨、不動產、平衡型 —— 公會那幾個類型的查詢回空的（它們主要
持有期貨、現金或受益憑證），畫面依分區說明原因（`missingReason()`）。

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
