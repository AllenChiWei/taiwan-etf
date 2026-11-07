# 籌碼與新聞

> 從專案根目錄的 CLAUDE.md 拆出來（2026-10-31）：CLAUDE.md 每次都整份載入，主題細節放這裡，改到這一塊時才讀。
> 什麼時候讀：改籌碼頁、fetch_chips.py、散戶多空比、定期定額人氣榜、新聞頁、fetch_news.py。

## 籌碼資料

`scripts/fetch_chips.py` → `app/public/data/chips.json`（**不進版控**，跟 `calc/` 一樣
部署時產生；它不需要 FinLab 憑證，來源全是免費的公開端點）。

期交所每個統計頁底下都有一個 CSV 下載端點，欄位固定、參數就是日期區間，比解析網頁穩：

| 端點 | 內容 |
| --- | --- |
| `futContractsDateDown` | 三大法人各期貨契約未平倉（含契約金額，近 120 天） |
| `callsAndPutsDateDown` | 三大法人臺指選擇權買賣權分計（未平倉與當日交易，買方／賣方／淨額） |
| `pcRatioDown` | Put/Call Ratio（成交量比、未平倉量比）；另用 `callsAndPutsDateDown` 的投信買權賣方算「扣投信賣出買權」版（`pc.oiAdj`／`volAdj`／`itcOi`，掩護性買權 ETF 把原始比率壓在 100 以下，籌碼頁預設顯示扣掉後的） |
| `largeTraderFutDown` / `largeTraderOptDown` | 大額交易人前五大／前十大 |
| `futDataDown` | 期貨每日行情；只拿小台／微台的全市場未沖銷量，用來推算散戶未平倉 |

**散戶多空比準不準**（`retail.json`、`fetch_retail.py`、`lib/retail.ts`）：期交所的
三大法人資料**只保留約三年**（2026-09 實測 2023-09-22 以前查不到，區間只要有一天超出
整段就回 HTML），所以逐日累積進版控。三大法人端點用 `commodityId` 只查單一契約，
小台要寫 **`MXF`**（不是行情檔的 `MTX`）。畫面依多空比切五等分、看之後 5／20 個交易日
的指數漲跌 —— 一定要跟「全部日子」的基準比（這三年指數大漲，每一組平均都是正的），
而且相鄰日子的前瞻報酬大部分重疊，實際獨立樣本比天數少很多。

**散戶未平倉是推算的**（期交所不公佈）：散戶多單＝全市場未沖銷 − 三大法人多方，
空單同理，淨額恆等於 −（三大法人淨額）。全市場量取一般時段、含週契約、**排除價差列**
（月份欄帶 `/`）—— 價差列加進去會把總量灌大。`retailLatest()`／`retailRatioSeries()`
在 `lib/chips.ts`，畫面上標「推算」並說明「散戶」是三大法人以外的所有人。

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

### 追繳與擔保維持率（2026-11-04 使用者要求）

`margin.credit`：證交所「信用交易儀表板」（`/dashboard/zh/credit/margin.html`）背後的
`rwd/zh/marginTrading/BFIJ3U_TREND?days=60`，每天一列（欄位順序見 `lib/chips.ts` 的 `CREDIT`）。

- **只有 2026-08-05 起、滾動近 60 個交易日**（帶 `date` 查更早一律「沒有符合條件的資料」，2026-11-04 實測）。
  所以 `credit_risk()` 每次跟**線上那份 chips.json** 的 `margin.credit` 合併，留 750 天 —— 線上讀不到那次就只有 60 天。
- **公布時間**：融資餘額（MI_MARGN、櫃買融資）、這個儀表板最晚約 21:30 才有當天的（站主 2026-11-04 告知），
  19:00 的每日更新常抓不到，所以晚上再部署兩次補當天：本機工作排程「TaiwanETF晚間部署觸發」21:45 與 23:55（`run_trigger.bat evening`），
  `deploy.yml` 的 GitHub 排程 21:50、23:55 是備援（2026-11-07 加 23:55：11-06 證交所比 21:45 還晚公布）。
- 「追繳戶數」照儀表板取 `belowAccNum`（截至當日整戶擔保維持率 < 130% 的戶數）；`callAccNum` 是當天發出追繳通知的戶數。
- **擔保維持率是融資＋融券合併算的**，跟自算的「大盤融資維持率」（只有融資、只有上市）不是同一個數字，畫面上寫了。

### 大盤維持率一致化（證交所口徑，2026-11-07 站主要求）

`margin.keepHist`：[日期, %, 1＝官方／0＝換算]、`margin.keepCal`（a、b、重疊天數、誤差）。`keep_history()` 每次部署算：
有 `margin.credit` 的官方「全市場擔保維持率」（08-05 起）就用官方，之前用自算 `maintHist` 換算 官方 ≈ a + b × 自算（重疊日子最小平方重估；
11-07：63 天 a 23.55、b 0.885，誤差標準差 0.55、最大 1.78；加券資比或融資變化都沒有更準，`D:\ai\_tmp\scripts_iso\maint_calib2.py`）。
前端**所有大盤維持率都用 `maintSeries(m)`**（頁首警示、每日摘要、融資融券、歷史、分區統計、斷頭時段），門檻 `MAINT_T`＝165／156／152／147／139
（自算的 160／150／145／140／130 換算）。自算 `maintHist` 仍每天累積（換算要用、私人頁維持率空方策略也用自算），畫面上只在融資融券那格當參考。

### 不限用途款項借貸（2026-11-06 站主要求）

`margin.anyLoan`：證交所「臺股儀表板 → 融通餘額及擔保維持率」（`/dashboard/zh/credit/general.html`）背後的
`rwd/zh/marginTrading/BFIJ4U_TREND?days=60`，每天一列（欄位順序見 `lib/chips.ts` 的 `ANYLOAN`：餘額、擔保維持率、追繳戶數、
當日通知、追繳金額、處分戶數與金額、擔保品價值）。`marketValue` 是上市市值（儀表板拿來算占市值比），沒存。

- **2026-08-03 起才有**；跟 BFIJ3U 不同，**帶 `date` 可以查更早**（一次最多 60 個交易日），所以種子
  `scripts/data/anyloan_seed.json` 是分段回補的（`D:\ai\_tmp\scripts_iso\anyloan_seed.py`），之後 `any_loan()` 同追繳那份累積（HIST_KEYS 有 `anyLoan`）。
- 擔保維持率＝擔保品價值 ÷ 借貸餘額（全市場平均），和融資維持率、信用交易擔保維持率都不同；個人整戶 < 130% 追繳、補到 166% 才解除。
- 畫面：融資融券區塊 `#anyloan`（四張共用日期軸的圖）＋每日摘要的「不限用途餘額」「不限用途維持率」兩格。

### 大盤融資維持率歷史（上市＋上櫃，2026-11-04 使用者要求：判斷斷頭賣壓）

`margin.maintHist`：[日期, %]，2009-01-05 起。

- **種子** `scripts/data/margin_maint_seed.json`（進版控）：`D:\ai\DashBoard_AI\research_margin_maint.py`
  用 FinLab `margin_transactions:融資今日餘額` × `price:收盤價` ÷ `margin_balance:融資券總餘額` 的上市＋上櫃融資金額算。
  **只用合計**：FinLab 的 `security_categories` 沒有 ETF 的市場別，拆上市／上櫃時近年上市只分得到七成張數；
  合計的張數跟公佈的總張數每天 100% 對得上。2026-10-28～11-03 用官方來源補（FinLab 快取到 10-27）。
- **每天接著算**：`maint_history()`＝證交所 MI_MARGN（`maintenance()` 已有的上市市值與融資金額）
  ＋櫃買 `POST /www/zh-tw/margin/balance`（每檔資餘額、合計列「融資金(仟元)」）× 櫃買當日收盤，
  兩邊都拿到才加當天；跟線上 chips.json 的 `maintHist` 合併累積。2026-10-27 兩條路對帳一致（174.2%）。
- 前端 `maintEpisodes()`（跌破 140%、相隔 10 個交易日內併成一波）、`dropToReach()`（粗估：維持率跟市值成正比）。
  歷史最低：2025-04-09 130.0%、2011-12-19 131.9%、2020-03-19 134.8%、2015-08-24 135.8%。

### 累積歷史防遺失（2026-11-04）

`maintHist`、`shortHist`、`credit` 三份都用 `_seed_and_live()` 三層合併：版控種子 → Actions 快取
`.cache/chips_hist.json`（deploy.yml 取回／存下）→ 線上 chips.json，後蓋前。只靠線上那份的話，某次部署讀不到，
產出就只剩種子＋今天、還會蓋掉線上那份（追繳證交所只給 60 天，等於永久遺失）。快取和線上都讀不到時寫進 meta.errors。
追繳的種子 `scripts/data/credit_seed.json` 是 2026-11-04 當時線上的 61 天。

### 借券賣出、臺指 VIX、正逆價差、漲跌家數（2026-11-04 使用者：還欠缺什麼可參考的數據）

流程照 `.claude/skills/data-block`。全部是種子＋快取＋線上三層累積，今天的值在 `fetch_chips.py` 的 `sbl_history()`、`tw_mood()`。

| 資料 | 位置 | 種子 | 每天 | 對帳／坑 |
|---|---|---|---|---|
| 借券賣出餘額（張） | `margin.sblHist` | `sbl_seed.json`，FinLab `security_lending_sell:借券賣出餘額`，2009 起 | 證交所 TWT93U＋櫃買 `margin/sbl` 第 12 欄（股） | **只算個股**（四碼、不以 0 開頭）：官方合計六成是 ETF 造市避險、FinLab 只收部分 ETF；個股 2026-11-03 逐檔一致（1,441 萬張）。FinLab 缺部分個股的 9 天已剔除 |
| 臺指 VIX | `tw.vix` | `vix_seed.json`，期交所月檔，2026-08 起 | 期交所 `Dailydownload/vix/log2data/YYYYMMnew.txt`（只放近 3 個月，更舊 302） | 取 13:45 那列 |
| 台指期近月收盤 | `tw.basis` [日期, 期貨, 指數] | `basis_seed.json`，futDataDown TX，2021-10 起 | futDataDown 近 28 天，指數借 `shortHist` 的 | 排除週契約（W）與價差（/）；**期貨 13:45 收、指數 13:30 收**，單日價差 −240～+336 來回跳，前端畫 5 日平均 |
| 上市漲跌家數 | `tw.breadth` [日期, 上漲, 下跌] | `breadth_seed.json`，FinLab 收盤價對前一日（上市普通股），2009 起 | MI_INDEX（type=ALL）「漲跌證券數合計」股票欄 | 跟官方每天差 0～4 家 |
| 上市漲停／跌停家數（2026-11-05） | `tw.limits` [日期, 漲停, 跌停] | `limit_seed.json`，FinLab 收盤價對漲跌停價回推（10%，2015-06-01 以前 7%，升降單位取整），2009 起；抽查 8 天的證交所精確值覆蓋 | 同一張表括號內的數字（「438(20)」＝上漲 438、漲停 20），`breadth_today` 一起解析 | 抽查：近年差 0～5 家、2015 少約一成（已下市的不在 FinLab 公司資料）。產生腳本 `D:\ai\_tmp\scripts_iso\limit_seed.py`＋`limit_seed_write.py` |
| 上櫃漲停／跌停家數（2026-11-05） | `tw.limitsOtc` [日期, 漲停, 跌停] | `limit_otc_seed.json`，同上回推（上櫃普通股：4 碼、非 00 開頭），抽查 8 天的櫃買精確值覆蓋 | 櫃買沒有家數統計：`tpex_limits(day, prev)`＝今天 afterTrading/otc 的收盤 vs **前一個交易日**表上的「次日漲停價／次日跌停價」（前一日＝`limits` 裡今天之前最近一天）；要兩天的表都拿到 | 抽查：近兩年差 0～20 家（11-04 完全相同 29／2）、2015 少約一成。前端 `combineLimits` 按日期和上市相加，上櫃缺的那天只有上市。產生腳本 `limit_seed.py otc`＋`limit_otc_seed_write.py`、核對 `tpex_limit_check.py` |

研究腳本：`D:\ai\DashBoard_AI\research_chips_extra.py`（借券、漲跌家數）；VIX、正逆價差種子用 fetch_chips 本身的函式產生。

**前端按日期對齊**（2026-11-05 使用者：各圖要按日期對齊才看得懂）：`ChipsPage` 的 `AlignedCharts` 用 `chips.ts` 的 `alignByDate()`
把四條數列放到同一條日期軸（還沒資料的那段是空白，VIX 只在 2026-08 之後有線），共用刻度、點一下四張圖同步標同一天。
加權指數合併 `margin.shortHist`（2009 起）與 `tw.basis`（2021-10 起），才能跟騰落線全程對照。要加新的情緒數列就加進 `charts`，不要再用各自撐滿寬度的 `TrendChart`。
漲跌停家數（`LimitBlock`，錨點 `#sec-limits`）在台股情緒下方，跟著同一個 1／5 年／全部：柱子＋20 日平均線（`AlignedChart` 的 `kind: 'bar'` 加 `rows2` 會畫一條線），
**`agg: 'max'`** 讓抽樣（最多 500 點）取那段最大值，不然 5 年／全部時 2025-04-07 那種 937 家的單日尖峰會被跳過；`tone` 固定柱子顏色（漲停紅、跌停綠）。

### 維持率分區與警示（2026-11-05 使用者：維持率低於多少下跌會加速？結論放網站、快到門檻要警示）

研究 `D:\ai\_tmp\scripts_iso\maint_accel.py`（報告 `D:\ai\_tmp\maint_accel\report.txt`）。前端 `chips.ts` 的 `maintStats()` 用同一套定義每天重算，
`maintLevel()`：0 正常、1 接近加速區（再跌 ≤ 5% 到 150）、2 加速區 140～150、3 斷頭區 < 140。`ChipsPage` 的 `MaintAlert`（level ≥ 1 才出現在頁首）、`MaintZones`（維持率區塊內的分區表＋結論）。
2026-11 的數字：下跌日平均跌 ≥160 −0.7%、140～150 −1.4%、<140 −2%；前 5 天已跌 > 3% 時之後 10 天內最大跌幅中位 140～150 −3.2%（其他 −1%）；
第一次跌破 145%（10 次）之後 10 天內再跌中位 −5.4%；跌破 140%（9 次）之後 20 天平均 +4.9%。樣本只有十幾波，是傾向不是保證。

### 融資 vs 大盤（2026-11-05 使用者：融資增幅 ≤ 大盤漲幅可接受，超過太多會洗／殺融資）

`margin.moneyHist` [日期, 億]（上市＋上櫃融資金額）：種子 `scripts/data/margin_money_seed.json`（margin_maint_seed 的 moneyYi＋11-04 官方，
產生腳本 `D:\ai\_tmp\scripts_iso\margin_money_seed.py`，2026-11-03 跟證交所＋櫃買對帳 7,963 億一致），每天在 `maint_history()` 用維持率同一份
`twse['money'] + otc['money']` 接著記，HIST_KEYS 有它（快取防遺失）。前端 `marginVsIndex()`、`MARGIN_GAP_HOT = 10`、`MarginVsIndex` 元件。
驗證 `D:\ai\_tmp\scripts_iso\margin_vs_index.py`：20 天差距 ≥ +10 之後 20 天下跌 47%、最大跌幅中位 −3.3%（60 天 ≥ +10：38%、−2.7%），
0～+10 反而多半續漲 → 只在 +10 以上標過熱。頁首維持率警示 2026-11-05 改成 < 160% 就出現（`maintLevel`）。
融資餘額、每日增減兩張圖改用 `AlignedCharts`（加了 `kind: 'bar'`、`rows2` 第二條線；`alignByDate` 半年內每月一個刻度）。

### 融券與軋空（2026-11-04 使用者要求：追繳後容易軋空嗎）

`margin.shortHist`：[日期, 融券張數, 融資張數, 加權指數]，上市＋上櫃合計，2009-01-05 起。

- **種子** `scripts/data/margin_short_seed.json`：`D:\ai\DashBoard_AI\research_margin_short.py` 用 FinLab
  `margin_balance:融資券總餘額`（張數跟證交所、櫃買公佈的合計一致）＋ `taiex_total_index:收盤指數`。
  FinLab 的指數 2026-10-16 之後沒更新（被 ffill），10-19～11-03 用證交所 MI_INDEX 補。
- **每天接著算**：跟維持率同一個 `maint_history()`，用 MI_MARGN 合計列「融資／融券(交易單位)」、櫃買 summary「合計(張)」的資餘額／券餘額、
  證交所收盤行情（type=ALL）指數表的「發行量加權股價指數」。
- 前端只畫融券餘額折線（跟維持率同一個 1 年／5 年／全部範圍）。**站主 11-04 要的是看趨勢的折線圖、不要一堆數字**：
  第一版的統計格、券資比圖、時段表的融券／指數三欄都拿掉了。指數與融資張數留在資料裡備用。
- 研究結論（2026-11-04）：10 波裡 20 日後指數全部上漲（平均約 +9%），但融券 9 波**增加**（中位數 +19.6%）——
  斷頭後的反彈是賣壓出清，不是空單回補。融券有季節性（股東會、除權息停券強制回補，約 4～8 月），2020-03 有限空令，判讀要扣掉。

### 定期定額人氣榜

`chips.json` 的 `dca`。它跟這一頁其他東西**不同步**：其他是每日收盤，這份是證交所
的月報，所以刻意分開放、畫面上也標明是月報。

它是這個網站唯一一份「散戶在買什麼」的官方數字 —— 三大法人那幾張表講的是機構部位，
這張講的是有多少帳戶設定了每月扣款。0050 一檔就 128 萬戶，佔榜上前二十名合計的 42%。

兩個容易誤讀的地方，畫面上都寫了：**戶數不是金額**（便宜的 ETF 容易衝高戶數），
以及端點沒有期別欄位，只能拿 HTTP 的 `Last-Modified` 當資料時間。

近一年報酬是從 `etfs.json` 接上去的（`joinDca`），個股榜接不到就留 null ——
不要當成 0，那會讓「查不到」跟「沒漲」看起來一樣。

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

**CNN 恐懼貪婪指數不抓**（2026-09-23 查過）：`production.dataviz.cnn.io` 對表明身分的
UA 回 **HTTP 418「I'm a teapot. You're a bot.」**，cnn.com 的 robots.txt 點名 ClaudeBot、
anthropic-ai 等代理 `Disallow: /`、對所有人擋 `/api/`；FinMind 的 `CnnFearGreedIndex` 要付費。
所以籌碼頁的是**照 CNN 公開方法自算的近似值**（`lib/sentiment.ts`），七項各自換成一年
百分位後平均：S&P 500 相對 125 日均線、S&P 500 離 52 週高點（代理新高新低家數）、RSP÷SPY
相對 50 日均線（代理漲跌量能）、CBOE 全市場 Put/Call 5 日平均、VIX 相對 50 日均線、20 日
股債報酬差、20 日高收益債與投資級債報酬差。畫面上必須寫明「自算，非 CNN」。原料一律用
含息還原價 —— 債券 ETF 月配息，純價格會每月誤判一次。

**2026-11-03 從四項補成七項**：四項版 11/2 算出 4、CNN 是 23，站主反映差太多。對 CNN 歷史
（GitHub `alexey-formalmethods/datasets` 的 money.cnn 資料，2011～2022-08）校正：四項版平均
差 12.4 分（2017～2022），七項版 10.0；2026 年五個已知 CNN 值（5/15 64、7/2 37、7/21 40、
8/3 46、11/2 23）平均差 19.5 → 9.9。窗口 504 天、z 分數排名都試過，沒有比較好。
finhacker.cz 的 CNN 歷史是 Gumroad 付費商品，不用。
**CBOE Put/Call**：`cdn.cboe.com/data/us/options/market_statistics/daily/{日期}_daily_options`
（robots 沒禁止），一天一檔，2019-10 以前是 `totalpc.csv`（停更）。歷史放種子檔＋Actions 快取，
每次只補缺的日子（`fetch_chips.py` 的 `cboe_putcall`）。**站主電腦的 Python 驗證 CBOE 憑證
會失敗**（本機憑證庫問題，curl 正常），本機測試要換成 curl。

**查過但不採用：奇摩股市**的 robots.txt 有一組點名 AI 代理的清單（anthropic-ai、
ClaudeBot、GPTBot…）全部 `Disallow: /`，對所有人也擋掉 `/api`、`/caas`、
`/_td-news`，新聞 JSON 正在那些路徑下。**Google News** 的 robots 是 `Disallow: /`
且 `/rss` 不在開放清單，抓搜尋結果頁也違反服務條款。這兩個不要再試。

重大訊息的連結用 `mopsov.twse.com.tw/mops/web/t05st01?firstin=1&co_id=…` ——
新版觀測站是 SPA、沒辦法用 GET 帶公司代號深連結，這個舊版路徑實測可以。
