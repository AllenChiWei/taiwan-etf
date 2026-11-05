# -*- coding: utf-8 -*-
u"""籌碼面資料：期交所的三大法人與大額交易人、交易所的法人買賣超前十大。

    python scripts/fetch_chips.py [outfile]

預設寫到 app/public/data/chips.json。

## 來源全部是官方的下載端點

期交所每個統計頁底下都有一個 CSV 下載端點（`cht/3/*Down`），欄位固定、參數就是
日期區間。解析網頁 HTML 是下策 —— 版面一改就壞，而且要多打一次首頁。

    futContractsDateDown   三大法人-區分各期貨契約（含契約金額）
    callsAndPutsDateDown   三大法人-選擇權買賣權分計（含契約金額）
    pcRatioDown            Put/Call Ratio（成交量與未平倉量）
                           另用 callsAndPutsDateDown 的投信買權賣方，算扣掉掩護性買權 ETF 的版本
    largeTraderFutDown     期貨大額交易人未沖銷部位（前五大／前十大）
    largeTraderOptDown     選擇權大額交易人未沖銷部位
    futDataDown            期貨每日交易行情（拿小台／微台的全市場未沖銷量）

交易所這邊：

    TWSE  fund/T86                    上市三大法人買賣超日報（全部個股）
    TWSE  afterTrading/MI_INDEX       當日每日收盤行情（拿成交均價用）
    TPEx  insti/dailyTrade            上櫃三大法人買賣超
    TPEx  afterTrading/otc            上櫃當日收盤行情
    TWSE  marginTrading/MI_MARGN      融資融券彙總（算大盤融資維持率）
    TWSE  marginTrading/BFIJ3U_TREND  信用交易儀表板：全市場擔保維持率、追繳／處分戶數與金額（近 60 天，合併線上累積）

FinMind（一個請求給一段完整歷史，免費層）：

    TaiwanStockTotalMarginPurchaseShortSale   上市融資融券餘額
    USStockPrice ^VIX ^GSPC SPY TLT HYG LQD RSP   VIX 與自算恐懼貪婪指數的原料

CBOE（cdn.cboe.com 每日選擇權統計 JSON，robots 沒有禁止）：

    {日期}_daily_options   全市場 Put/Call（TOTAL PUT/CALL RATIO），恐懼貪婪的一項

期交所沒有 robots.txt（回 404），證交所與櫃買的都沒有禁止這些路徑。即使如此還是
照本專案一貫的做法：User-Agent 標明用途與網址、每次請求之間留間隔、只抓需要的。

## 幾個踩過的坑

**PC ratio 一次最多查一個月。** 查兩個月會回一頁 HTML（不是錯誤訊息，是首頁），
很容易誤判成參數寫錯。所以歷史是切成數段抓的，段與段之間照樣留間隔。

**大額交易人只抓最新一日。** 那份表涵蓋全市場 346 種契約，一天就 1390 行；查三個月
會變成 89000 行、數 MB，而我們只要臺股期貨與臺指選擇權。需要趨勢的是 PC ratio 與
三大法人未平倉，那兩份很小，抓 120 天也才數十 KB。

**買賣超金額是估算值。** 交易所公佈的法人買賣超只有**股數**，沒有金額；市場上看到的
「買超金額」都是推估的。這裡用當日成交均價（成交金額 ÷ 成交股數）乘上買賣超股數，
比用收盤價接近實際成交，但仍然不是法人的真實成交均價 —— 前端必須標明是估算。

**查詢區間的結束日不能是「還沒有資料的今天」。** 期交所對這種查詢回一頁 HTML
而不是空的 CSV：收盤後查當天可以，開盤前查當天就被拒。因為整份資料的日期是從
回傳內容推的，被拒的那一段會靜靜地少掉最近幾天，畫面上看起來像「資料到上週為止」。
所以先用 PC ratio 逐日往回問出「最新有資料的一天」，再以它為結束日組出所有區間。

**一個來源掛掉不該讓整份沒有。** 期交所與交易所偶爾會拒絕來自雲端主機的請求
（GitHub Actions 就是雲端），而這支腳本原本任何一個 urlopen 拋錯就整份不產生。
現在每個來源各自 try/except，取到多少寫多少，取不到的寫進 meta.errors ——
CI 的日誌不是每個人都讀得到，但產出的 JSON 本身會說哪一段缺了、為什麼。

**散戶未平倉是推算的，不是期交所公佈的。** 期交所只公佈三大法人的部位與全市場
未沖銷量，市場上講的「小台散戶多空比」都是這樣推：每一口未平倉同時有一個多方與
一個空方，所以

    散戶多單 = 全市場未沖銷 − 三大法人多方未平倉
    散戶空單 = 全市場未沖銷 − 三大法人空方未平倉
    散戶淨額 = 散戶多單 − 散戶空單 = −（三大法人淨額）

「散戶」其實是「三大法人以外的所有人」，包含一般法人與期貨商的非自營部位。
全市場未沖銷量取 futDataDown 的**一般時段**（盤後那列是 '-'），而且要排除價差
委託的列（到期月份欄是「202610/202611」這種）—— 那是組合單的報價，不是另一份部位。
週契約（202609W4）要算進去：三大法人那份統計涵蓋所有月份，全市場也要一樣。

**大盤融資維持率是自己算的。** FinMind 有現成的但要付費。算法是市場通用的那一個：

    維持率 = Σ（各股融資今日餘額張數 × 1000 × 收盤價）÷ 融資金額

只有上市（證交所 MI_MARGN 一個請求就有 1,300 檔的餘額與融資金額合計）。
MI_MARGN 那張表把「前日餘額」排在「今日餘額」前面，取錯一格會整份變昨天 ——
fetch_stocks.py 踩過，所以這裡照欄位名稱找第一組「今日餘額」。

**恐懼貪婪是自算的近似值，不是 CNN 的。** CNN 的資料端點對表明身分的程式回
HTTP 418（「I'm a teapot. You're a bot.」），cnn.com 的 robots.txt 也點名擋掉 AI
代理；要拿只能假裝成瀏覽器，這個專案不做。所以照 CNN 公開的方法、用拿得到的資料
自己算七項（見 app/src/lib/sentiment.ts），原料是 FinMind 的含息還原價 ——
債券 ETF 每月配息，用純價格算報酬會讓「避險需求」每個月被配息日誤判一次。

**CBOE 的 Put/Call 一天一個檔案，歷史靠種子＋快取累積。** 每天打幾百個請求回補
一年太浪費，所以 scripts/seed/cboe_putcall.json 存了 2023-06 起的歷史（2026-11-03
回補），每次執行只補種子與快取（.cache/cboe_putcall.json）之後缺的日子，最多
PC_MAX_FETCH 天。休市日 CBOE 回 404，記成 null 不再重問；但最近三天的 404 可能只是
還沒公佈，不記。

**契約金額的單位是千元。** 期交所原始欄位就是千元，這裡原樣保留，換算交給前端，
免得在 JSON 裡再乘一次、之後看到數字時搞不清楚是哪一種單位。
"""
import io
import json
import re
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'chips.json')

args = [a for a in sys.argv[1:] if not a.startswith('--')]
if args:
    OUT = args[0]

UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) chips data')

DELAY = 1.5
TIMEOUT = 60
# 走勢圖要看得出趨勢又不要讓 JSON 變大：120 個日曆天約 80 個交易日
HISTORY_DAYS = 120
# 期交所單次查詢的上限（實測 PC ratio 超過一個月就回 HTML）
WINDOW_DAYS = 28

TPE = timezone(timedelta(hours=8))

TAIFEX = 'https://www.taifex.com.tw/cht/3/%s'
TWSE_T86 = ('https://www.twse.com.tw/rwd/zh/fund/T86'
            '?date=%s&selectType=ALL&response=json')
TWSE_PRICE = ('https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX'
              '?date=%s&type=ALL&response=json')
TPEX_INSTI = ('https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade'
              '?type=Daily&sect=EW&date=%s&id=&response=json')
TPEX_PRICE = ('https://www.tpex.org.tw/www/zh-tw/afterTrading/otc'
              '?date=%s&type=EW&response=json')
# 各類股成交比重。只有上市有這份，櫃買沒有對應端點，所以畫面要標明是上市。
TWSE_SECTORS = ('https://www.twse.com.tw/rwd/zh/afterTrading/BFIAMU'
                '?date=%s&response=json')

# 追蹤這幾種契約就夠了。全市場 346 種裡絕大多數是個股期貨，籌碼面在看的是大盤。
FUT_CONTRACTS = [u'臺股期貨', u'電子期貨', u'金融期貨', u'小型臺指期貨', u'微型臺指期貨']
# 大額交易人表用代號，且名稱帶換算說明（TX = 臺股期貨(TX+MTX/4+TMF/20)）
LARGE_FUT_IDS = {'TX': u'臺股期貨', 'TE': u'電子期貨', 'TF': u'金融期貨'}
LARGE_OPT_IDS = {'TXO': u'臺指選擇權'}
# 推算散戶未平倉要全市場未沖銷量。散戶多空比大家看的是小台與微台，大台以法人為主。
RETAIL_IDS = {'MTX': u'小型臺指期貨', 'TMF': u'微型臺指期貨'}

TWSE_MARGIN = ('https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN'
               '?date=%s&selectType=ALL&response=json')
# 證交所「信用交易儀表板」（/dashboard/zh/credit/margin.html）背後的端點：全市場擔保維持率、
# 追繳／處分戶數與金額、信用交易戶數。只給近 60 個交易日，所以每次跟上次發布的 chips.json 合併累積。
TWSE_CREDIT = 'https://www.twse.com.tw/rwd/zh/marginTrading/BFIJ3U_TREND?response=json&days=60'
# 上櫃融資餘額（每檔張數＋合計列的「融資金(仟元)」），櫃買融資融券頁背後的端點，POST date=YYYY/MM/DD
TPEX_MARGIN = 'https://www.tpex.org.tw/www/zh-tw/margin/balance'
# 大盤融資維持率（上市＋上櫃）的歷史：FinLab 回補的種子（2009 起）＋每天累積在線上 chips.json
MAINT_SEED = os.path.join(ROOT, 'scripts', 'data', 'margin_maint_seed.json')
MAINT_KEEP = 6000
# 融券（上市＋上櫃）的歷史 [日期, 融券張數, 融資張數, 加權指數]：同樣是 FinLab 種子＋每天累積。
# 2026-11-04 站主要看「追繳之後容易軋空嗎」，所以跟維持率放一起、帶著指數
SHORT_SEED = os.path.join(ROOT, 'scripts', 'data', 'margin_short_seed.json')
# 融資金額（上市＋上櫃，億元）[日期, 億]：2026-11-05 站主要比「融資累積增幅 vs 大盤累積漲幅」。
# 種子＝margin_maint_seed 的 moneyYi（FinLab，2026-11-03 跟證交所＋櫃買對帳 7,963 億一致）＋11-04 官方，之後每天用維持率同一份資料
MONEY_SEED = os.path.join(ROOT, 'scripts', 'data', 'margin_money_seed.json')
# 追繳（信用交易儀表板）沒有回補來源，種子是 2026-11-04 當時線上累積的那幾十天，之後靠快取＋線上
CREDIT_SEED = os.path.join(ROOT, 'scripts', 'data', 'credit_seed.json')
# 三份累積歷史的 Actions 快取（deploy.yml 取回／存下），防「某次讀不到線上那份就整段遺失」
HIST_CACHE = os.path.join(ROOT, '.cache', 'chips_hist.json')
HIST_KEYS = ('maintHist', 'shortHist', 'moneyHist', 'credit', 'sblHist', 'vix', 'basis', 'breadth', 'limits', 'limitsOtc')
# 2026-11-04 台股情緒與借券（站主要「還欠缺什麼可參考的數據」）：
# 借券賣出餘額（個股，上市＋上櫃；ETF 的是造市避險，不算）——FinLab 回補，2026-11-03 跟官方逐檔一致
SBL_SEED = os.path.join(ROOT, 'scripts', 'data', 'sbl_seed.json')
TWSE_SBL = 'https://www.twse.com.tw/rwd/zh/marginTrading/TWT93U?date=%s&response=json'
TPEX_SBL = 'https://www.tpex.org.tw/www/zh-tw/margin/sbl'
# 上市股票漲跌家數（騰落線）——FinLab 收盤價回補，跟 MI_INDEX「漲跌證券數合計」每天差 0～4 家
BREADTH_SEED = os.path.join(ROOT, 'scripts', 'data', 'breadth_seed.json')
# 上市股票漲停／跌停家數（2026-11-05 站主）——FinLab 收盤價對漲跌停價回推（10%，2015-06 以前 7%，升降單位取整），
# 跟 MI_INDEX 括號內的數字抽查 8 天：近年差 0～5 家、2015 年少約一成（已下市的不在 FinLab 公司資料裡）；之後每天用證交所的
LIMIT_SEED = os.path.join(ROOT, 'scripts', 'data', 'limit_seed.json')
# 上櫃股票漲停／跌停家數（2026-11-05 站主：要上市＋上櫃）——同樣 FinLab 回推；櫃買沒有家數統計，
# 每天用收盤行情「前一個交易日的次日漲停價／次日跌停價」對今天收盤（抽查 8 天：近兩年差 0～20 家、2015 少約一成）
LIMIT_OTC_SEED = os.path.join(ROOT, 'scripts', 'data', 'limit_otc_seed.json')
# 台指期近月收盤（正逆價差）——期交所 futDataDown 回補 5 年
BASIS_SEED = os.path.join(ROOT, 'scripts', 'data', 'basis_seed.json')
# 臺指選擇權波動率指數：期交所只放近 3 個月的月檔（2026-08 起），之後靠累積
TAIFEX_VIX = 'https://www.taifex.com.tw/file/taifex/Dailydownload/vix/log2data/%snew.txt'
VIX_SEED = os.path.join(ROOT, 'scripts', 'data', 'vix_seed.json')
LIVE_CHIPS = 'https://allenchiwei.github.io/taiwan-etf/data/chips.json'
CREDIT_KEEP = 750
FINMIND_API = 'https://api.finmindtrade.com/api/v4/data'
FINMIND_TOKEN = os.environ.get('FINMIND_TOKEN', '').strip()
# 自算恐懼貪婪：125 日均線 + 一年的百分位，再畫一段走勢，所以要兩年半的歷史
US_SYMBOLS = {'^GSPC': 'spx', '^VIX': 'vix', 'SPY': 'spy',
              'TLT': 'tlt', 'HYG': 'hyg', 'LQD': 'lqd', 'RSP': 'rsp'}
US_HISTORY_DAYS = 920
CBOE_DAILY = 'https://cdn.cboe.com/data/us/options/market_statistics/daily/%s_daily_options'
PC_SEED = os.path.join(ROOT, 'scripts', 'seed', 'cboe_putcall.json')
PC_CACHE = os.path.join(ROOT, '.cache', 'cboe_putcall.json')
PC_MAX_FETCH = 40

# 期交所寫「外資及陸資」，畫面上一律講「外資」—— 兩邊指的是同一件事
WHO = {u'自營商': u'自營商', u'投信': u'投信', u'外資及陸資': u'外資', u'外資': u'外資'}
WHO_ORDER = [u'自營商', u'投信', u'外資']

# 大額交易人的到期月份欄位有兩個特別值
TERM_ALL = '999999'
TERM_WEEK = '666666'


ERRORS = []


def log(m):
    print(m, flush=True)


def note(msg):
    u"""記下一段抓不到的來源。會同時印出來與寫進 meta.errors。"""
    log(u'  ⚠ %s' % msg)
    ERRORS.append(msg)


def write_json(path, obj):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')))


def fetch(url, data=None):
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers={'User-Agent': UA})
    raw = urllib.request.urlopen(req, timeout=TIMEOUT).read()
    time.sleep(DELAY)
    return raw


def fetch_csv(page, params, tries=3):
    u"""期交所的下載端點。回傳已切好的資料列（不含表頭與註腳）。

    編碼兩種都出現過：多數是 UTF-8，少數頁面是 Big5，所以先試 UTF-8 再退回。

    **會重試。** 期交所偶爾對某一個區間回一頁 HTML（不是錯誤訊息，是首頁），
    下一次同樣的請求又正常 —— 看起來是流量限制。不重試的話那一段就靜靜地少掉，
    而少掉的往往是最近幾天，畫面上看起來像「資料到上週為止」。
    """
    for attempt in range(1, tries + 1):
        try:
            raw = fetch(TAIFEX % page, params)
        except Exception as e:                                # noqa: BLE001
            if attempt == tries:
                note(u'期交所 %s：%s' % (page, str(e)[:80]))
                return []
            time.sleep(DELAY * attempt)
            continue
        try:
            txt = raw.decode('utf-8')
        except UnicodeDecodeError:
            txt = raw.decode('big5', 'replace')
        lines = [l for l in txt.splitlines() if l.strip()]
        if lines and not lines[0].lstrip().startswith('<'):
            break
        if attempt == tries:
            note(u'期交所 %s 連 %d 次都不是 CSV（%s ~ %s）'
                 % (page, tries, params.get('queryStartDate'),
                    params.get('queryEndDate')))
            return []
        log(u'  %s 回傳的不是 CSV，第 %d 次重試' % (page, attempt))
        time.sleep(DELAY * attempt)
    else:
        return []
    out = []
    for line in lines[1:]:
        cells = [c.strip() for c in line.split(',')]
        # 註腳（「-表當日收盤後無週到期契約」之類）沒有日期，用開頭是不是年份來擋
        if len(cells) < 5 or not cells[0][:4].isdigit():
            continue
        out.append(cells)
    return out


def fetch_json(url, label):
    u"""抓 JSON 端點。失敗記進 meta.errors，不讓整份資料沒有。"""
    try:
        return json.loads(fetch(url).decode('utf-8'))
    except Exception as e:                                    # noqa: BLE001
        note(u'%s：%s' % (label, str(e)[:80]))
        return None


def num(s):
    u"""'-1,069,000' -> -1069000；空值與 '-' 回 0。"""
    s = (s or '').replace(',', '').replace('%', '').strip()
    if not s or s == '-':
        return 0
    try:
        return int(s)
    except ValueError:
        try:
            return float(s)
        except ValueError:
            return 0


def iso(d):
    u"""期交所的 2026/09/16 -> 2026-09-16。格式不對就拒絕。

    這個值後面會被插進證交所與櫃買的網址。來源是期交所的 CSV，不是使用者輸入，
    但「從遠端拿到的字串直接接進網址」這件事本身值得擋一下 —— 成本是一行。
    """
    d = (d or '').strip()
    if not re.match(r'^\d{4}/\d{2}/\d{2}$', d):
        raise ValueError(u'期交所回傳了看不懂的日期：%r' % d)
    return d.replace('/', '-')


def latest_available_date(max_back=8):
    u"""期交所最新有資料的那一天（台北時間往回找）。

    用 PC ratio 試：它一天只有一列，是最便宜的探針。假日、開盤前、以及連假
    都靠同一個迴圈處理 —— 不必自己維護交易日曆。
    """
    today = datetime.now(TPE).date()
    for back in range(max_back):
        day = today - timedelta(days=back)
        probe = day.strftime('%Y/%m/%d')
        if fetch_csv('pcRatioDown',
                     {'queryStartDate': probe, 'queryEndDate': probe}, tries=1):
            if back:
                log(u'  期交所最新資料日：%s（今天還沒有）' % day.isoformat())
            return day
    note(u'期交所最近 %d 天都查不到資料' % max_back)
    return None


def windows(days, step, end=None):
    u"""把 days 天切成不超過 step 天的區間，由舊到新。

    end 是結束日（預設今天）。傳入「最新有資料的一天」可以避免最後一段被期交所
    以「結束日還沒有資料」為由拒絕。
    """
    last = end or datetime.now(TPE).date()
    start = last - timedelta(days=days)
    out = []
    while start <= last:
        stop = min(start + timedelta(days=step - 1), last)
        out.append((start.strftime('%Y/%m/%d'), stop.strftime('%Y/%m/%d')))
        start = stop + timedelta(days=1)
    return out


# ── 期交所：三大法人 ─────────────────────────────────────────

def futures(rows):
    u"""最新一日的三大法人期貨未平倉，以及每日淨未平倉口數的歷史。

    回傳 (latest, history, 日期)。latest 只留主要契約，history 只留口數 ——
    契約金額每天存一份會讓檔案大一倍，而趨勢看口數就夠。
    """
    if not rows:
        return [], {'dates': [], 'contracts': {}}, None
    # 取最大值而不是最後一列：某個區間被拒時，接起來的資料尾端會是較舊的那一段，
    # 用最後一列當「最新」就會把整頁的日期往前拉好幾天（實際踩過）。
    last_day = max(c[0] for c in rows)
    latest = []
    hist = {}
    dates = []
    for c in rows:
        day, contract, who = iso(c[0]), c[1], WHO.get(c[2], c[2])
        if contract not in FUT_CONTRACTS:
            continue
        net_lots, net_amt = num(c[13]), num(c[14])
        if day not in dates:
            dates.append(day)
        hist.setdefault(contract, {}).setdefault(who, {})[day] = net_lots
        if c[0] == last_day:
            latest.append({
                'c': contract, 'w': who,
                'n': net_lots, 'a': net_amt,           # 未平倉淨額：口數、契約金額(千元)
                'tn': num(c[7]), 'ta': num(c[8]),      # 當日交易淨額
                'bn': num(c[9]), 'sn': num(c[11]),     # 多方／空方未平倉口數
            })
    dates.sort()
    series = {}
    for contract, by_who in hist.items():
        series[contract] = dict(
            (who, [by_who[who].get(d) for d in dates]) for who in by_who)
    return latest, {'dates': dates, 'contracts': series}, iso(last_day)


def market_oi(rows):
    u"""futDataDown 的列 -> {交易日: 全市場未沖銷口數}。

    欄位：0 交易日期、2 到期月份(週別)、11 未沖銷契約數、17 交易時段。
    只取一般時段、排除價差列（月份欄帶 '/'），理由見檔頭。
    """
    out = {}
    for c in rows:
        if len(c) < 18 or c[17] != u'一般' or '/' in c[2]:
            continue
        day = iso(c[0])
        out[day] = out.get(day, 0) + num(c[11])
    return out


def options(rows):
    u"""最新一日的三大法人臺指選擇權，買權／賣權分計。

    未平倉與當日交易兩側都收，各自的買方、賣方與淨額（口數＋契約金額），
    對應期交所 callsAndPutsDate 那一頁的欄位。
    """
    if not rows:
        return []
    last_day = max(c[0] for c in rows)
    out = []
    for c in rows:
        if c[0] != last_day or c[1] != u'臺指選擇權':
            continue
        out.append({
            'cp': c[2], 'w': WHO.get(c[3], c[3]),
            # 未平倉：買方、賣方、淨額（口數與契約金額，金額單位千元）
            'bn': num(c[10]), 'ba': num(c[11]),
            'sn': num(c[12]), 'sa': num(c[13]),
            'n': num(c[14]), 'a': num(c[15]),
            # 當日交易：同樣三組。期交所那一頁（callsAndPutsDate）兩側並列，
            # 只給未平倉會少掉「今天實際買賣了多少」這一半。
            'vbn': num(c[4]), 'vba': num(c[5]),
            'vsn': num(c[6]), 'vsa': num(c[7]),
            'vn': num(c[8]), 'va': num(c[9]),
        })
    return out


def itc_calls(days, end=None):
    u"""投信的臺指買權賣方：{交易日: (未平倉口數, 當日成交口數)}。

    掩護性買權（covered call）ETF 由投信賣出買權，買權未平倉被墊高，原始 PC ratio
    長期低於 100。扣掉這一塊才看得出其他人的多空。callsAndPutsDateDown 只開放近 3 年，
    這裡只要近 HISTORY_DAYS 天，不受影響。
    """
    out = {}
    for a, b in windows(days, WINDOW_DAYS, end):
        for c in fetch_csv('callsAndPutsDateDown', {
                'firstDate': '', 'lastDate': '', 'commodityId': 'TXO',
                'queryStartDate': a, 'queryEndDate': b}):
            if len(c) >= 16 and c[2] == 'CALL' and WHO.get(c[3], c[3]) == u'投信':
                out[iso(c[0])] = (num(c[12]), num(c[6]))
    return out


def pc_ratio(days, end=None, itc=None):
    u"""Put/Call Ratio 的歷史。一次最多一個月，所以切段抓。

    itc 有給（itc_calls 的結果）就另外算扣掉投信賣出買權的版本：
        oiAdj  = 賣權未平倉 ÷ (買權未平倉 − 投信買權賣方未平倉) × 100
        volAdj = 賣權成交量 ÷ (買權成交量 − 投信買權賣方成交量) × 100
    某天沒有投信資料就是 null（不拿原始值頂替，免得看起來像修正過）。
    """
    by_day = {}
    for a, b in windows(days, WINDOW_DAYS, end):
        for c in fetch_csv('pcRatioDown', {'queryStartDate': a, 'queryEndDate': b}):
            by_day.setdefault(iso(c[0]), c)
    dates = sorted(by_day)
    out = {
        'dates': dates,
        'vol': [num(by_day[d][3]) for d in dates],
        'oi': [num(by_day[d][6]) for d in dates],
    }
    if itc:
        def adj(put, call, minus):
            return round(put / (call - minus) * 100, 2) if call - minus > 0 else None
        out['itcOi'] = [itc[d][0] if d in itc else None for d in dates]
        out['oiAdj'] = [adj(num(by_day[d][4]), num(by_day[d][5]), itc[d][0]) if d in itc else None
                        for d in dates]
        out['volAdj'] = [adj(num(by_day[d][1]), num(by_day[d][2]), itc[d][1]) if d in itc else None
                         for d in dates]
    return out


def large_traders(rows, ids, is_option):
    u"""大額交易人未沖銷部位：前五大與前十大的買方／賣方口數。

    交易人類別 0 = 全部交易人、1 = 特定法人（也就是法人裡的大戶）。兩種都留，
    因為「前十大交易人」與「前十大特定法人」在解讀上完全是兩件事。
    到期月份 999999 是所有契約合計、666666 是週契約，其餘是該月份。
    """
    out = []
    for c in rows:
        cid = c[1].strip()
        if cid not in ids:
            continue
        i = 3 if is_option else 2          # 選擇權多一欄買賣權
        term = c[i + 1].strip()
        out.append({
            'id': cid, 'name': ids[cid],
            'cp': c[3].strip() if is_option else None,
            'term': (u'所有契約' if term == TERM_ALL
                     else u'週契約' if term == TERM_WEEK else term),
            'who': u'全部交易人' if c[i + 2].strip() == '0' else u'特定法人',
            'b5': num(c[i + 3]), 's5': num(c[i + 4]),
            'b10': num(c[i + 5]), 's10': num(c[i + 6]),
            'oi': num(c[i + 7]),
        })
    return out


# ── 交易所：法人買賣超前十大 ─────────────────────────────────

_PRICE_DOCS = {}


def twse_price_doc(day):
    u"""證交所每日收盤行情。買賣超估算與融資維持率都要它，同一天只抓一次。"""
    if day not in _PRICE_DOCS:
        try:
            _PRICE_DOCS[day] = json.loads(fetch(TWSE_PRICE % day).decode('utf-8'))
        except Exception as e:                                # noqa: BLE001
            note(u'證交所收盤行情：%s' % str(e)[:80])
            _PRICE_DOCS[day] = None
    return _PRICE_DOCS[day]


def twse_closes(day):
    u"""上市個股的收盤價 {代號: 收盤價}。沒成交（'--'）的不在裡面。"""
    out = {}
    for t in (twse_price_doc(day) or {}).get('tables') or []:
        fields = t.get('fields') or []
        if u'收盤價' not in fields:
            continue
        ci = fields.index(u'收盤價')
        for r in t.get('data') or []:
            close = num(r[ci])
            if close > 0:
                out[r[0].strip()] = float(close)
    return out


def twse_prices(day):
    u"""上市個股的當日成交均價 {代號: 均價}。均價 = 成交金額 ÷ 成交股數。

    拿不到就回空的：買賣超的張數照樣有，只是金額變成 null（前端顯示破折號）。
    """
    doc = twse_price_doc(day)
    if doc is None:
        return {}
    out = {}
    for t in doc.get('tables') or []:
        fields = t.get('fields') or []
        if u'收盤價' not in fields:
            continue
        vi, ai = fields.index(u'成交股數'), fields.index(u'成交金額')
        for r in t.get('data') or []:
            shares, value = num(r[vi]), num(r[ai])
            if shares > 0:
                out[r[0].strip()] = value / float(shares)
    return out


def tpex_prices(day):
    u"""上櫃個股的當日成交均價。櫃買的欄位名稱帶空白，所以用 strip 後比對。"""
    try:
        doc = json.loads(fetch(TPEX_PRICE % day).decode('utf-8'))
    except Exception as e:                                    # noqa: BLE001
        note(u'櫃買收盤行情（估算金額用）：%s' % str(e)[:80])
        return {}
    out = {}
    for t in doc.get('tables') or []:
        fields = [f.strip() for f in (t.get('fields') or [])]
        if u'成交股數' not in fields or u'成交金額(元)' not in fields:
            continue
        vi, ai = fields.index(u'成交股數'), fields.index(u'成交金額(元)')
        for r in t.get('data') or []:
            shares, value = num(r[vi]), num(r[ai])
            if shares > 0:
                out[r[0].strip()] = value / float(shares)
    return out


# ── 融資：餘額走勢與維持率 ───────────────────────────────────

def finmind(dataset, start, data_id=None):
    u"""FinMind 的一個資料集。失敗記進 meta.errors、回空串列。"""
    params = {'dataset': dataset, 'start_date': start}
    if data_id:
        params['data_id'] = data_id
    if FINMIND_TOKEN:
        params['token'] = FINMIND_TOKEN
    doc = fetch_json(FINMIND_API + '?' + urllib.parse.urlencode(params),
                     u'FinMind %s %s' % (dataset, data_id or ''))
    if not doc:
        return []
    if doc.get('msg') != 'success':
        note(u'FinMind %s %s：%s' % (dataset, data_id or '', str(doc.get('msg'))[:60]))
        return []
    return doc.get('data') or []


def margin_history(end):
    u"""上市融資融券餘額，近 HISTORY_DAYS 天。

    money 是融資金額（元）、lots 是融資餘額（張）、short 是融券餘額（張）。
    """
    start = (end - timedelta(days=HISTORY_DAYS)).isoformat()
    by_day = {}
    names = {'MarginPurchaseMoney': 'money', 'MarginPurchase': 'lots',
             'ShortSale': 'short'}
    for r in finmind('TaiwanStockTotalMarginPurchaseShortSale', start):
        key = names.get(r.get('name'))
        if key and r.get('date'):
            by_day.setdefault(r['date'], {})[key] = num(str(r.get('TodayBalance')))
    dates = sorted(d for d, v in by_day.items() if len(v) == 3)
    return {
        'dates': dates,
        'money': [by_day[d]['money'] for d in dates],
        'lots': [by_day[d]['lots'] for d in dates],
        'short': [by_day[d]['short'] for d in dates],
    }


def maintenance(day):
    u"""上市大盤融資維持率（%）。算法見檔頭。拿不到就回 None。

    回傳 {'ratio', 'value'（融資部位市值，元）, 'money'（融資金額，元）, 'n'（算進去的檔數）,
    'lots'／'short'（合計列的融資、融券今日餘額，張）}。
    """
    doc = fetch_json(TWSE_MARGIN % day, u'證交所融資融券彙總')
    if not doc or doc.get('stat') != 'OK':
        return None
    money = None
    lots_all = short_all = None
    value = 0.0
    n = 0
    closes = twse_closes(day)
    for t in doc.get('tables') or []:
        fields = t.get('fields') or []
        rows = t.get('data') or []
        if u'項目' in fields:
            ti = fields.index(u'今日餘額')
            for r in rows:
                if r[0].startswith(u'融資金額'):
                    money = num(r[ti]) * 1000            # 仟元 -> 元
                elif r[0].startswith(u'融資(交易單位)'):
                    lots_all = num(r[ti])
                elif r[0].startswith(u'融券(交易單位)'):
                    short_all = num(r[ti])
        elif u'代號' in fields and u'今日餘額' in fields:
            # 第一組「今日餘額」是融資（第二組是融券）
            bi = fields.index(u'今日餘額')
            for r in rows:
                close = closes.get(r[0].strip())
                lots = num(r[bi])
                if close and lots > 0:
                    value += lots * 1000 * close
                    n += 1
    if not money or not n:
        note(u'融資維持率：%s' % (u'沒有收盤價' if money else u'找不到融資金額'))
        return None
    return {'ratio': round(value / money * 100, 2), 'value': int(value),
            'money': int(money), 'n': n, 'lots': lots_all, 'short': short_all}


def tpex_maintenance(day):
    u"""上櫃那一半：{'value'（融資部位市值，元）, 'money'（融資金額，元）, 'n', 'lots'／'short'（合計列，張）}。day 是 YYYYMMDD。

    融資餘額與融資金額來自櫃買融資融券頁的 API（合計列「融資金(仟元)」的今日餘額），
    收盤價來自同一天的上櫃收盤行情。兩份都要是同一天，拿不到就回 None（那天只算得出上市）。
    """
    try:
        body = urllib.parse.urlencode({'date': '%s/%s/%s' % (day[:4], day[4:6], day[6:]), 'response': 'json'}).encode()
        req = urllib.request.Request(TPEX_MARGIN, data=body, headers={'User-Agent': UA})
        doc = json.loads(urllib.request.urlopen(req, timeout=TIMEOUT).read().decode('utf-8'))
        time.sleep(DELAY)
    except Exception as e:                                    # noqa: BLE001
        note(u'櫃買融資餘額：%s' % str(e)[:80])
        return None
    tables = doc.get('tables') or []
    if not tables or not tables[0].get('data'):
        return None
    t = tables[0]
    fields = [f.strip() for f in t.get('fields') or []]
    bi = fields.index(u'資餘額')
    si = fields.index(u'券餘額')
    money = lots_all = short_all = None
    for r in t.get('summary') or []:
        if len(r) > bi and u'融資金' in (r[1] or ''):
            money = num(r[bi]) * 1000                        # 仟元 -> 元
        elif len(r) > si and u'合計' in (r[1] or ''):
            lots_all, short_all = num(r[bi]), num(r[si])
    roc = '%d/%s/%s' % (int(day[:4]) - 1911, day[4:6], day[6:])
    closes = {}
    try:
        pdoc = json.loads(fetch(TPEX_PRICE % roc).decode('utf-8'))
        for pt in pdoc.get('tables') or []:
            pf = [f.strip() for f in pt.get('fields') or []]
            if u'收盤' not in pf:
                continue
            ci = pf.index(u'收盤')
            for r in pt.get('data') or []:
                c = num(r[ci])
                if c > 0:
                    closes[r[0].strip()] = float(c)
    except Exception as e:                                    # noqa: BLE001
        note(u'櫃買收盤行情（維持率用）：%s' % str(e)[:80])
    value, n = 0.0, 0
    for r in t['data']:
        c = closes.get(r[0].strip())
        lots = num(r[bi])
        if c and lots > 0:
            value += lots * 1000 * c
            n += 1
    if not money or not n:
        return None
    return {'value': value, 'money': money, 'n': n, 'lots': lots_all, 'short': short_all}


def twse_taiex(day):
    u"""發行量加權股價指數收盤（證交所收盤行情 type=ALL 的指數表），拿不到回 None。"""
    for t in (twse_price_doc(day) or {}).get('tables') or []:
        fields = t.get('fields') or []
        if u'收盤指數' not in fields:
            continue
        ci = fields.index(u'收盤指數')
        for r in t.get('data') or []:
            if r[0].strip() == u'發行量加權股價指數':
                return float(num(r[ci])) or None
    return None


_LIVE = []


def _live_section(section):
    u"""線上那份 chips.json 的 margin／tw 區塊（同一次執行只抓一次）；讀不到回 None。"""
    if not _LIVE:
        try:
            _LIVE.append(json.loads(fetch(LIVE_CHIPS).decode('utf-8')))
        except Exception as e:                                # noqa: BLE001
            log(u'  線上 chips.json 讀不到（%s）' % str(e)[:50])
            _LIVE.append(None)
    return None if _LIVE[0] is None else (_LIVE[0].get(section) or {})


def _hist_cache():
    try:
        return json.load(io.open(HIST_CACHE, encoding='utf-8'))
    except Exception:                                         # noqa: BLE001
        return {}


def _seed_and_live(path, key, conv, section='margin'):
    u"""{日期: 列}：版控裡的種子（conv 轉成網站的列格式，回 None 就跳過）→ Actions 快取 → 線上 chips.json 的 section[key]，
    後面的蓋前面的。key 在各 section 之間不重複（快取用 key 當鍵）。

    三層是為了**不弄丟累積的歷史**：只靠線上那份的話，某次部署讀不到它，這次產出就只剩種子＋今天，
    而且會蓋掉線上那份，之後再也補不回來（追繳那份證交所只給 60 天）。快取與線上都讀不到時記進 meta.errors。
    """
    rows = {}
    try:
        for r in json.load(io.open(path, encoding='utf-8')).get('rows') or []:
            c = conv(r)
            if c:
                rows[r[0]] = c
    except Exception:                                         # noqa: BLE001
        pass
    cached = _hist_cache().get(key) or []
    live = _live_section(section)
    for r in cached + ((live or {}).get(key) or []):
        rows[r[0]] = r
    if not cached and live is None:                           # 線上那份讀得到、只是還沒有這個鍵＝新欄位第一次部署，不算錯
        note(u'%s 的累積歷史：Actions 快取與線上 chips.json 都讀不到，只剩種子＋今天' % key)
    return rows


def save_hist_cache(*sections):
    u"""把累積歷史（HIST_KEYS）存進 .cache（deploy.yml 用 actions/cache 帶到下一次部署）。"""
    try:
        os.makedirs(os.path.dirname(HIST_CACHE), exist_ok=True)
        out = {}
        for sec in sections:
            out.update((k, sec.get(k) or []) for k in HIST_KEYS if k in sec)
        with io.open(HIST_CACHE, 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    except Exception as e:                                    # noqa: BLE001
        note(u'存累積歷史快取：%s' % str(e)[:80])


def maint_history(twse, day):
    u"""大盤融資維持率（上市＋上櫃）每天一列 [日期, %]：種子（FinLab 回補）＋線上累積＋今天。
    同時回傳融券的歷史 [日期, 融券張數, 融資張數, 加權指數]（SHORT_SEED 起頭，同一套累積）
    與融資金額 [日期, 億]（MONEY_SEED 起頭）。

    今天要上市與上櫃都算得出來才加（只有一半的話跟歷史不是同一個口徑）。
    """
    rows = _seed_and_live(MAINT_SEED, 'maintHist', lambda r: [r[0], r[3]] if r[3] is not None else None)
    shorts = _seed_and_live(SHORT_SEED, 'shortHist', lambda r: list(r))
    money = _seed_and_live(MONEY_SEED, 'moneyHist', lambda r: list(r))
    if twse and day:
        compact = day.replace('-', '')
        otc = tpex_maintenance(compact)
        if otc:
            ratio = (twse['value'] + otc['value']) / (twse['money'] + otc['money']) * 100
            rows[day] = [day, round(ratio, 1)]
            money[day] = [day, int(round((twse['money'] + otc['money']) / 1e8))]
            log(u'  大盤融資維持率（上市＋上櫃）%s：%.1f%%、融資金額 %s 億' % (day, ratio, money[day][1]))
            taiex = twse_taiex(compact)
            if None not in (twse.get('short'), twse.get('lots'), otc.get('short'), otc.get('lots'), taiex):
                shorts[day] = [day, int(twse['short'] + otc['short']), int(twse['lots'] + otc['lots']), taiex]
                log(u'  融券（上市＋上櫃）%s：%s 張，券資比 %.2f%%' % (
                    day, shorts[day][1], shorts[day][1] / float(shorts[day][2]) * 100))
    return ([rows[d] for d in sorted(rows)][-MAINT_KEEP:],
            [shorts[d] for d in sorted(shorts)][-MAINT_KEEP:],
            [money[d] for d in sorted(money)][-MAINT_KEEP:])


def credit_risk():
    u"""證交所信用交易儀表板：每天一列 [日期, 全市場擔保維持率%, 追繳戶數, 當日通知追繳戶數, 追繳金額(元),
    處分戶數, 處分金額(元), 信用交易戶數, 信用交易戶數占比%, 信用交易成交值(元)]。

    「追繳戶數」照證交所儀表板的用法取 belowAccNum（截至當日整戶擔保維持率低於 130% 的戶數），
    callAccNum 是當天證券商發出追繳通知的戶數，另外存。**擔保維持率是融資融券合併計算**，
    跟上面自算的「融資維持率」（只有融資、只有上市個股市值）不是同一個數字。

    端點只留近 60 天：跟線上那份合併，留 CREDIT_KEEP 天。線上抓不到就只有這 60 天。
    """
    rows = _seed_and_live(CREDIT_SEED, 'credit', list)
    doc = fetch_json(TWSE_CREDIT, u'證交所信用交易儀表板')
    if doc and doc.get('stat') == 'OK':
        for r in doc.get('data') or []:
            d = r.get('date') or ''
            if len(d) != 8:
                continue
            day = '%s-%s-%s' % (d[:4], d[4:6], d[6:])
            rows[day] = [day, r.get('keepRate'), r.get('belowAccNum'), r.get('callAccNum'), r.get('callAmt'),
                         r.get('exeAccNum'), r.get('exeAmt'), r.get('marginAccNum'), r.get('marginAccRate'),
                         r.get('crdAmt')]
    return [rows[d] for d in sorted(rows)][-CREDIT_KEEP:]


# ── 台股情緒與借券（2026-11-04）─────────────────────────────

def _is_stock(code):
    u"""個股：四碼數字、不以 0 開頭（排除 ETF、權證、特別股）"""
    return len(code) == 4 and code.isdigit() and not code.startswith('0')


def sbl_today(day):
    u"""借券賣出當日餘額（張），上市＋上櫃個股合計；兩邊都拿到才回傳。day 是 YYYYMMDD。

    兩張表都是「信用額度總量管制餘額表」，第 12 欄是借券賣出的當日餘額（股）。
    """
    doc = fetch_json(TWSE_SBL % day, u'證交所借券賣出餘額')
    if not doc or doc.get('stat') != 'OK':
        return None
    twse = sum(num(r[12]) for r in doc.get('data') or [] if _is_stock(r[0].strip()))
    try:
        body = urllib.parse.urlencode({'date': '%s/%s/%s' % (day[:4], day[4:6], day[6:]), 'response': 'json'}).encode()
        req = urllib.request.Request(TPEX_SBL, data=body, headers={'User-Agent': UA})
        x = json.loads(urllib.request.urlopen(req, timeout=TIMEOUT).read().decode('utf-8'))
        time.sleep(DELAY)
        rows = (x.get('tables') or [{}])[0].get('data') or []
    except Exception as e:                                    # noqa: BLE001
        note(u'櫃買借券賣出餘額：%s' % str(e)[:80])
        return None
    if not twse or not rows:
        return None
    return int(round((twse + sum(num(r[12]) for r in rows if _is_stock(r[0].strip()))) / 1000))


def breadth_today(day):
    u"""上市股票 (上漲, 下跌, 漲停, 跌停) 家數：證交所收盤行情的「漲跌證券數合計」股票欄，
    格式「438(20)」＝上漲 438 家、其中漲停 20 家。拿不到回 None。"""
    for t in (twse_price_doc(day) or {}).get('tables') or []:
        if u'漲跌' not in (t.get('title') or '') or u'股票' not in (t.get('fields') or []):
            continue
        si = t['fields'].index(u'股票')
        got = {}
        for r in t.get('data') or []:
            m = re.match(r'\s*([\d,]+)\s*(?:\(([\d,]+)\))?', str(r[si]))
            if m:
                got[r[0][:2]] = (int(num(m.group(1))), int(num(m.group(2) or '0')))
        if u'上漲' in got and u'下跌' in got:
            return got[u'上漲'][0], got[u'下跌'][0], got[u'上漲'][1], got[u'下跌'][1]
    return None


def tpex_limit_rows(day):
    u"""櫃買收盤行情的普通股（4 碼數字、非 00 開頭）{代號: (收盤, 次日漲停價, 次日跌停價)}。day 是 YYYY-MM-DD；拿不到回 {}。"""
    try:
        doc = json.loads(fetch(TPEX_PRICE % day.replace('-', '/')).decode('utf-8'))
    except Exception as e:                                    # noqa: BLE001
        note(u'櫃買收盤行情（漲跌停）：%s' % str(e)[:80])
        return {}
    for t in doc.get('tables') or []:
        f = [x.strip() for x in t.get('fields') or []]
        if u'收盤' not in f or u'次日漲停價' not in f:
            continue
        ci, ui, di = f.index(u'收盤'), f.index(u'次日漲停價'), f.index(u'次日跌停價')
        return dict((r[0].strip(), (num(r[ci]), num(r[ui]), num(r[di]))) for r in t.get('data') or []
                    if len(r[0].strip()) == 4 and r[0].strip().isdigit() and not r[0].strip().startswith('00'))
    return {}


def tpex_limits(day, prev):
    u"""上櫃股票 (漲停, 跌停) 家數：今天收盤＝前一個交易日表上的次日漲停（跌停）價。兩天都要拿得到，否則 None。"""
    if not prev:
        return None
    today, before = tpex_limit_rows(day), tpex_limit_rows(prev)
    if not today or not before:
        return None
    up = dn = 0
    for code, (c, _, _) in today.items():
        if c <= 0 or code not in before:
            continue
        up += abs(c - before[code][1]) < 1e-6
        dn += abs(c - before[code][2]) < 1e-6
    return up, dn


def sbl_history(day):
    u"""借券賣出餘額（個股，上市＋上櫃）每天一列 [日期, 張]：種子＋快取＋線上＋今天。"""
    rows = _seed_and_live(SBL_SEED, 'sblHist', list)
    if day:
        v = sbl_today(day.replace('-', ''))
        if v:
            rows[day] = [day, v]
            log(u'  借券賣出餘額（個股）%s：%s 張' % (day, v))
    return [rows[d] for d in sorted(rows)][-MAINT_KEEP:]


def tx_near_close(rows):
    u"""futDataDown（TX）的列 → {交易日: 近月一般時段收盤}。排除週契約（月份欄帶 W）與價差列（帶 /）。

    欄位：0 交易日期、2 到期月份(週別)、6 收盤價、17 交易時段。近月＝當天最小的月份（結算日當天就是結算那口）。
    """
    best = {}
    for c in rows:
        if len(c) < 18 or c[17] != u'一般' or '/' in c[2] or 'W' in c[2].upper():
            continue
        px = num(c[6])
        if px <= 0:
            continue
        day, ym = iso(c[0]), c[2].strip()
        if day not in best or ym < best[day][0]:
            best[day] = (ym, px)
    return dict((d, v[1]) for d, v in best.items())


def vix_rows(end):
    u"""臺指選擇權波動率指數每天收盤 [[日期, 指數]]：期交所月檔（只放近 3 個月），抓這個月與前三個月。"""
    out = []
    m = end.replace(day=1)
    for _ in range(4):
        try:
            text = fetch(TAIFEX_VIX % m.strftime('%Y%m')).decode('big5', 'replace')
            for line in text.splitlines():
                p = line.split()
                if len(p) >= 3 and p[0].isdigit() and len(p[0]) == 8:
                    out.append(['%s-%s-%s' % (p[0][:4], p[0][4:6], p[0][6:]), float(p[2])])
        except Exception:                                     # noqa: BLE001
            pass                                              # 太舊的月份期交所轉址（302），正常
        m = (m - timedelta(days=1)).replace(day=1)
    if not out:
        note(u'期交所臺指 VIX：一個月檔都沒拿到')
    return out


def tw_mood(day, shorts):
    u"""台股情緒：{'vix': [[日期, 指數]], 'basis': [[日期, 台指期近月, 加權指數]], 'breadth': [[日期, 上漲, 下跌]]}。
    都是種子＋快取＋線上累積，再加上今天（或近幾週）抓到的。shorts 是融券歷史（借它的加權指數）。
    """
    tw = {}
    vix = _seed_and_live(VIX_SEED, 'vix', list, 'tw')
    for r in vix_rows(datetime.strptime(day, '%Y-%m-%d').date() if day else datetime.now(TPE).date()):
        vix[r[0]] = r
    tw['vix'] = [vix[d] for d in sorted(vix)]

    basis = _seed_and_live(BASIS_SEED, 'basis', list, 'tw')
    taiex = dict((r[0], r[3]) for r in shorts)
    rows = []
    for a, b in windows(WINDOW_DAYS, WINDOW_DAYS, datetime.strptime(day, '%Y-%m-%d').date() if day else None):
        rows += fetch_csv('futDataDown', {'down_type': '1', 'commodity_id': 'TX', 'commodity_id2': '',
                                          'queryStartDate': a, 'queryEndDate': b})
    for d, px in tx_near_close(rows).items():
        if d in taiex:
            basis[d] = [d, px, taiex[d]]
    tw['basis'] = [basis[d] for d in sorted(basis)][-MAINT_KEEP:]

    breadth = _seed_and_live(BREADTH_SEED, 'breadth', list, 'tw')
    limits = _seed_and_live(LIMIT_SEED, 'limits', list, 'tw')
    limits_otc = _seed_and_live(LIMIT_OTC_SEED, 'limitsOtc', list, 'tw')
    if day:
        b = breadth_today(day.replace('-', ''))
        if b:
            breadth[day] = [day, b[0], b[1]]
            limits[day] = [day, b[2], b[3]]
        # 前一個交易日＝上市漲跌停歷史裡今天之前最近的一天（種子＋累積，含休市）
        prev = max([d for d in limits if d < day] or [None], key=lambda x: x or '')
        o = tpex_limits(day, prev)
        if o:
            limits_otc[day] = [day, o[0], o[1]]
    tw['breadth'] = [breadth[d] for d in sorted(breadth)][-MAINT_KEEP:]
    tw['limits'] = [limits[d] for d in sorted(limits)][-MAINT_KEEP:]
    tw['limitsOtc'] = [limits_otc[d] for d in sorted(limits_otc)][-MAINT_KEEP:]
    return tw


# ── 美股：VIX 與自算恐懼貪婪的原料 ───────────────────────────

def us_series(end):
    u"""{dates, spx, vix, spy, tlt, hyg, lqd, rsp, pc}，含息還原收盤（Adj_Close）＋ CBOE Put/Call。

    各檔日期對齊到聯集，缺的那天是 None（前端跳過，不當成 0）。
    """
    start = (end - timedelta(days=US_HISTORY_DAYS)).isoformat()
    cols = {}
    for sym, key in US_SYMBOLS.items():
        rows = finmind('USStockPrice', start, sym)
        cols[key] = dict((r['date'], float(r.get('Adj_Close') or r.get('Close') or 0))
                         for r in rows if r.get('date'))
    dates = sorted(set().union(*[set(v) for v in cols.values()]))
    out = {'dates': dates}
    for key, series in cols.items():
        out[key] = [series.get(d) or None for d in dates]
    # CBOE 全市場 Put/Call，對齊美股日期；沒有的那天是 None
    pc = cboe_putcall(end)
    out['pc'] = [pc.get(d) for d in dates]
    return out


def cboe_putcall(today):
    u"""{日期: CBOE 全市場 Put/Call}，種子＋快取＋補抓缺的日子（見檔頭）。抓不到回已有的。"""
    have = {}
    for path in (PC_SEED, PC_CACHE):
        try:
            with open(path, encoding='utf-8') as f:
                have.update(json.load(f))
        except (OSError, ValueError):
            pass
    last = max(have) if have else (today - timedelta(days=400)).isoformat()
    d = datetime.strptime(last, '%Y-%m-%d').date() + timedelta(days=1)
    todo = []
    while d < today:
        if d.weekday() < 5 and d.isoformat() not in have:
            todo.append(d)
        d += timedelta(days=1)
    for d in todo[-PC_MAX_FETCH:]:
        key = d.isoformat()
        try:
            doc = json.loads(fetch(CBOE_DAILY % key).decode('utf-8'))
            ratio = next((float(x['value']) for x in doc.get('ratios', [])
                          if x.get('name') == 'TOTAL PUT/CALL RATIO'), None)
            have[key] = ratio
        except urllib.error.HTTPError as e:
            if e.code in (403, 404) and (today - d).days > 3:
                have[key] = None
        except Exception as e:                                # noqa: BLE001
            note(u'CBOE Put/Call %s：%s' % (key, str(e)[:60]))
            break
    try:
        os.makedirs(os.path.dirname(PC_CACHE), exist_ok=True)
        with open(PC_CACHE, 'w', encoding='utf-8') as f:
            json.dump(have, f, separators=(',', ':'), sort_keys=True)
    except OSError:
        pass
    return have


def top_n(rows, prices, n=10):
    u"""rows = [(代號, 名稱, 買賣超股數)]，回傳買超前十與賣超前十。

    金額是估算：交易所只公佈股數。沒有當日均價的（當天沒成交）金額給 null，
    不要拿別天的價格硬湊。
    """
    def pack(r):
        price = prices.get(r[0])
        return {
            'code': r[0], 'name': r[1], 'shares': r[2],
            'amount': None if price is None else int(round(r[2] * price)),
        }
    ranked = sorted(rows, key=lambda r: r[2], reverse=True)
    buy = [pack(r) for r in ranked[:n] if r[2] > 0]
    sell = [pack(r) for r in reversed(ranked[-n:]) if r[2] < 0]
    return {'buy': buy, 'sell': sell}


# 證交所的分類指數有階層：這兩類是彙總，等於底下那幾個子類的總和（實測到小數點
# 後四位都一樣）。算比重時分母要扣掉它們，否則電子會被算兩次，每一類的比重都被
# 稀釋 —— 半導體會從 36% 變成 19%。
SECTOR_AGGREGATES = {
    u'電子': (u'半導體', u'電腦及週邊設備', u'光電', u'通信網路',
              u'電子零組件', u'電子通路', u'資訊服務', u'其他電子'),
    u'化學生技醫療': (u'化學', u'生技醫療'),
}


def sectors(day):
    u"""各類股成交比重（上市）。

    交易所只公佈各類的成交金額，沒有給比重 —— 自己除才有意義，而分母是「扣掉
    彙總類之後的合計」，見 SECTOR_AGGREGATES。彙總類本身仍然留在清單裡並標記
    agg=1，因為「電子占今天成交的幾成」正是最常被引用的那個數字。

    櫃買沒有對應端點，所以這份只有上市，畫面必須標明。
    """
    doc = fetch_json(TWSE_SECTORS % day, u'證交所類股成交比重')
    if not doc or not doc.get('data'):
        return []
    rows = []
    for r in doc['data']:
        name = r[0].strip().replace(u'類指數', '')
        value = num(r[2])
        if not name or value is None:
            continue
        rows.append({'n': name, 'v': value, 'sh': num(r[1]), 'tx': num(r[3]),
                     'agg': 1 if name in SECTOR_AGGREGATES else 0})
    base = sum(r['v'] for r in rows if not r['agg']) or 1
    for r in rows:
        r['pct'] = round(r['v'] / float(base) * 100, 2)
    rows.sort(key=lambda r: -r['v'])
    return rows


def dca_rank():
    u"""定期定額交易戶數排行（證交所月報）。

    這是**每月**的統計，不是每天 —— 端點回的是最新一期，沒有期別欄位，所以這裡
    記下 HTTP 的 Last-Modified 當作資料時間。一份回應同時包含個股與 ETF 兩份
    排行（各二十名），欄位是並排的，所以要拆成兩份。

    它是少數看得到「散戶在買什麼」的官方數字：三大法人那幾張表是機構，這張是
    真的有人每個月扣款買進。
    """
    url = 'https://openapi.twse.com.tw/v1/ETFReport/ETFRank'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        resp = urllib.request.urlopen(req, timeout=TIMEOUT)
        modified = resp.headers.get('Last-Modified') or ''
        rows = json.loads(resp.read().decode('utf-8'))
    except Exception as e:                                    # noqa: BLE001
        note(u'定期定額排行：%s' % str(e)[:60])
        return None

    def pick(code_key, name_key, n_key):
        out = []
        for r in rows:
            code = str(r.get(code_key) or '').strip()
            n = num(r.get(n_key))
            if not code or n is None:
                continue
            out.append({'code': code,
                        'name': str(r.get(name_key) or '').strip(),
                        'n': int(n)})
        out.sort(key=lambda x: -x['n'])
        return out

    etfs = pick('ETFsSecurityCode', 'ETFsName', 'ETFsNumberofTradingAccounts')
    stocks = pick('STOCKsSecurityCode', 'STOCKsName', 'STOCKsNumberofTradingAccounts')
    if not etfs and not stocks:
        note(u'定期定額排行：回應裡沒有可用的列')
        return None
    return {'etfs': etfs, 'stocks': stocks, 'modified': modified}


def twse_top(day):
    u"""上市：外資／投信／自營商各自的買賣超前十大。"""
    try:
        doc = json.loads(fetch(TWSE_T86 % day).decode('utf-8'))
    except Exception as e:                                    # noqa: BLE001
        note(u'證交所法人買賣超 T86：%s' % str(e)[:80])
        return None
    if doc.get('stat') != 'OK':
        log(u'  證交所 T86 回 %s，當天可能不是交易日' % doc.get('stat'))
        return None
    fields = doc['fields']
    # 外資要把外資自營商加回來。市場上講的「外資買賣超」是含自營的合計，
    # 證交所卻分成兩欄公佈（不含外資自營商、外資自營商），相加才對得上三大法人合計。
    fi = fields.index(u'外陸資買賣超股數(不含外資自營商)')
    fdi = fields.index(u'外資自營商買賣超股數')
    ti = fields.index(u'投信買賣超股數')
    di = fields.index(u'自營商買賣超股數')          # 自營商合計（自行買賣＋避險）
    ai = fields.index(u'三大法人買賣超股數')
    prices = twse_prices(day)

    rows = {u'外資': [], u'投信': [], u'自營商': []}
    bad = 0
    for r in doc['data']:
        code, name = r[0].strip(), r[1].strip()
        foreign, trust, dealer = num(r[fi]) + num(r[fdi]), num(r[ti]), num(r[di])
        if foreign + trust + dealer != num(r[ai]):
            bad += 1
        rows[u'外資'].append((code, name, foreign))
        rows[u'投信'].append((code, name, trust))
        rows[u'自營商'].append((code, name, dealer))
    if bad:
        log(u'  ⚠ 上市有 %d 檔三家加總對不上公佈的三大法人合計，欄位可能換位置了' % bad)
    return dict((who, top_n(v, prices)) for who, v in rows.items())


def tpex_top(day):
    u"""上櫃：櫃買的欄位名稱在七個身份別之間重複（都叫買進／賣出／買賣超股數），
    `fields.index()` 會永遠回第一組，所以只能靠位置取。

    代號、名稱之後每三欄一組，依序是：
      外資及陸資(不含外資自營商)／外資自營商／外資及陸資合計／投信／
      自營商(自行買賣)／自營商(避險)／自營商合計，最後一欄是三大法人合計。

    位置是猜不得的東西，所以每次都用「三家相加 = 公佈的合計」驗一次；
    櫃買改版把欄位挪動時，這行會先叫出來，而不是默默給出錯的排行。
    """
    date_roc = '%d/%02d/%02d' % (int(day[:4]) - 1911, int(day[4:6]), int(day[6:]))
    try:
        doc = json.loads(fetch(TPEX_INSTI % date_roc).decode('utf-8'))
    except Exception as e:                                    # noqa: BLE001
        note(u'櫃買法人買賣超：%s' % str(e)[:80])
        return None
    tables = doc.get('tables') or []
    if not tables or not tables[0].get('data'):
        log(u'  櫃買 dailyTrade 沒有資料，當天可能不是交易日')
        return None
    data = tables[0]['data']
    prices = tpex_prices(date_roc)
    FOREIGN, TRUST, DEALER, TOTAL = 10, 13, 22, 23      # 各組的「買賣超股數」欄
    rows = {u'外資': [], u'投信': [], u'自營商': []}
    bad = 0
    for r in data:
        code, name = r[0].strip(), r[1].strip()
        foreign, trust, dealer = num(r[FOREIGN]), num(r[TRUST]), num(r[DEALER])
        if foreign + trust + dealer != num(r[TOTAL]):
            bad += 1
        rows[u'外資'].append((code, name, foreign))
        rows[u'投信'].append((code, name, trust))
        rows[u'自營商'].append((code, name, dealer))
    if bad:
        log(u'  ⚠ 上櫃有 %d 檔三家加總對不上公佈的三大法人合計，欄位可能換位置了' % bad)
    return dict((who, top_n(v, prices)) for who, v in rows.items())


def main():
    log(u'輸出：%s' % OUT)

    log(u'期交所：確認最新資料日…')
    last_date = latest_available_date()

    log(u'期交所：三大法人期貨（近 %d 天）…' % HISTORY_DAYS)
    fut_rows = []
    for a, b in windows(HISTORY_DAYS, WINDOW_DAYS, last_date):
        fut_rows += fetch_csv('futContractsDateDown', {
            'firstDate': '', 'lastDate': '', 'commodityId': '',
            'queryStartDate': a, 'queryEndDate': b})
    fut_latest, fut_hist, fut_day = futures(fut_rows)
    if fut_day is None:
        # 期交所整段拿不到。日期是後面兩個交易所查詢的依據，所以退回「今天」
        # （台北時間）—— 假日或收盤前那兩邊會回空，前端顯示「今天還沒有資料」。
        note(u'期交所三大法人期貨：一筆都沒拿到')
        fut_day = (last_date or datetime.now(TPE).date()).isoformat()
    log(u'  %d 筆，最新 %s，契約 %d 種'
        % (len(fut_rows), fut_day, len(fut_hist['contracts'])))

    log(u'期交所：小台／微台全市場未沖銷量（推算散戶用）…')
    # 與法人歷史用同一組日期對位；某天沒拿到就是 null，前端不會把它當成 0
    fut_hist['oi'] = {}
    for cid, contract in sorted(RETAIL_IDS.items()):
        rows = []
        for a, b in windows(HISTORY_DAYS, WINDOW_DAYS, last_date):
            rows += fetch_csv('futDataDown', {
                'down_type': '1', 'commodity_id': cid, 'commodity_id2': '',
                'queryStartDate': a, 'queryEndDate': b})
        oi = market_oi(rows)
        if oi:
            fut_hist['oi'][contract] = [oi.get(d) for d in fut_hist['dates']]
        log(u'  %s %d 天，最新 %s 口'
            % (contract, len(oi), oi.get(fut_day, u'—')))

    log(u'期交所：三大法人選擇權…')
    opt_rows = fetch_csv('callsAndPutsDateDown', {
        'firstDate': '', 'lastDate': '', 'commodityId': '',
        'queryStartDate': fut_day.replace('-', '/'),
        'queryEndDate': fut_day.replace('-', '/')})
    opt_latest = options(opt_rows)
    log(u'  臺指選擇權 %d 筆' % len(opt_latest))

    log(u'期交所：Put/Call Ratio（近 %d 天）…' % HISTORY_DAYS)
    itc = itc_calls(HISTORY_DAYS, last_date)
    pc = pc_ratio(HISTORY_DAYS, last_date, itc)
    log(u'  %d 個交易日，最新未平倉比 %s%%，扣投信賣出買權 %s%%'
        % (len(pc['dates']), pc['oi'][-1] if pc['oi'] else u'—',
           pc['oiAdj'][-1] if pc.get('oiAdj') else u'—'))

    log(u'期交所：大額交易人（%s）…' % fut_day)
    day_slash = fut_day.replace('-', '/')
    large_fut = large_traders(
        fetch_csv('largeTraderFutDown',
                  {'queryStartDate': day_slash, 'queryEndDate': day_slash}),
        LARGE_FUT_IDS, False)
    large_opt = large_traders(
        fetch_csv('largeTraderOptDown',
                  {'queryStartDate': day_slash, 'queryEndDate': day_slash}),
        LARGE_OPT_IDS, True)
    log(u'  期貨 %d 筆、選擇權 %d 筆' % (len(large_fut), len(large_opt)))

    day_compact = fut_day.replace('-', '')
    log(u'證交所：各類股成交比重…')
    sector_rows = sectors(day_compact)
    log(u'  %d 類' % len(sector_rows))

    log(u'證交所：上市三大法人買賣超（%s）…' % fut_day)
    twse = twse_top(day_compact)
    log(u'櫃買：上櫃三大法人買賣超…')
    tpex = tpex_top(day_compact)

    log(u'融資：上市融資餘額（FinMind）與維持率（證交所）…')
    margin = margin_history(last_date or datetime.now(TPE).date())
    # 證交所的融資表比收盤行情晚發布（實測 16:10 收盤行情已有、融資表還沒有），
    # 當天的還沒出來就退回 FinMind 餘額的最後一天 —— 晚一天的維持率比沒有好，
    # 畫面上會照實標出日期
    maint_days = [fut_day] + [d for d in reversed(margin['dates'][-3:]) if d != fut_day]
    margin['maint'] = None
    for d in maint_days:
        margin['maint'] = maintenance(d.replace('-', ''))
        if margin['maint']:
            margin['maint']['date'] = d
            break
    log(u'  餘額 %d 天，維持率 %s%%' % (
        len(margin['dates']), margin['maint']['ratio'] if margin['maint'] else u'—'))
    margin['maintHist'], margin['shortHist'], margin['moneyHist'] = maint_history(
        margin['maint'], margin['maint']['date'] if margin['maint'] else None)
    log(u'  大盤融資維持率歷史 %d 天、融券歷史 %d 天' % (len(margin['maintHist']), len(margin['shortHist'])))
    margin['credit'] = credit_risk()
    log(u'  信用交易儀表板（擔保維持率、追繳）%d 天' % len(margin['credit']))
    mday = margin['maint']['date'] if margin['maint'] else None
    margin['sblHist'] = sbl_history(mday)
    log(u'  借券賣出餘額歷史 %d 天' % len(margin['sblHist']))

    log(u'台股情緒：臺指 VIX、期貨正逆價差、漲跌家數…')
    tw = tw_mood(fut_day, margin['shortHist'])
    log(u'  VIX %d 天、正逆價差 %d 天、漲跌家數 %d 天、漲跌停 上市 %d 天／上櫃 %d 天' % (len(tw['vix']), len(tw['basis']), len(tw['breadth']), len(tw['limits']), len(tw['limitsOtc'])))
    save_hist_cache(margin, tw)

    log(u'美股：VIX 與恐懼貪婪原料（FinMind）…')
    us = us_series(datetime.now(TPE).date())
    log(u'  %d 天，VIX 最新 %s' % (
        len(us['dates']), next((v for v in reversed(us['vix']) if v), u'—')))

    log(u'證交所：定期定額交易戶數排行（月報）…')
    dca = dca_rank()
    if dca:
        log(u'  ETF %d 檔、個股 %d 檔，最多的是 %s %s 戶'
            % (len(dca['etfs']), len(dca['stocks']),
               dca['etfs'][0]['name'] if dca['etfs'] else u'—',
               format(dca['etfs'][0]['n'], ',') if dca['etfs'] else u'—'))

    payload = {
        'meta': {
            'date': fut_day,
            # 台北時間。CI 跑在 UTC，用 date.today() 會在台灣凌晨標成前一天
            'updated': datetime.now(TPE).date().isoformat(),
            'source': u'臺灣期貨交易所／臺灣證券交易所／證券櫃檯買賣中心',
            'note': (u'買賣超金額為估算：交易所只公佈股數，這裡以當日成交均價'
                     u'（成交金額÷成交股數）乘上買賣超股數推估。'
                     u'期貨與選擇權的契約金額單位為千元。'),
            # 哪幾段沒抓到。CI 的日誌不見得讀得到，但這份 JSON 會說。
            'errors': ERRORS,
        },
        'futures': fut_latest,
        'futHistory': fut_hist,
        'options': opt_latest,
        'pc': pc,
        'large': {'fut': large_fut, 'opt': large_opt},
        'top': {'twse': twse, 'tpex': tpex},
        'sectors': sector_rows,
        # 每月更新的散戶行為統計，跟這一頁其他每日更新的東西不同步，刻意分開放
        'dca': dca,
        # 上市融資餘額走勢與最新一天的維持率
        'margin': margin,
        # 臺指 VIX、期貨正逆價差、上市漲跌家數（2026-11-04）
        'tw': tw,
        # VIX 與自算恐懼貪婪的原料（美股日期，不跟台股同步）
        'us': us,
    }
    # **dca 不算在這裡**。它是每月更新的附加資料，期交所整段 403 的那天它照樣
    # 抓得到 —— 把它算進來就會讓一份沒有任何當日籌碼的 chips.json 被寫出去，
    # 而前端測試對真實檔案的檢查會直接失敗（實際發生過，擋掉了一次部署）。
    # 這道保險要看的是「當天的籌碼有沒有拿到」。
    have = (bool(fut_latest) or bool(opt_latest) or bool(pc['dates'])
            or bool(large_fut) or bool(sector_rows)
            or twse is not None or tpex is not None)
    if not have:
        log(u'每一個來源都失敗了，不寫出半空的檔案 —— 籌碼頁會顯示「今天還沒有資料」')
        for e in ERRORS:
            log(u'  %s' % e)
        return 1

    write_json(OUT, payload)
    size = os.path.getsize(OUT) / 1024.0
    log(u'完成：%s（%.0f KB）%s'
        % (OUT, size, u'' if not ERRORS else u'，但有 %d 段缺漏' % len(ERRORS)))
    for e in ERRORS:
        log(u'  缺：%s' % e)
    return 0


def run_with_retry(tries=2):
    u"""整份都失敗時再跑一輪。

    CI 上遇過一次「每個來源都失敗」—— 本機同一時間正常，所以那是連線抖動而不是
    資料問題。整份重跑一次的成本是幾十秒，換掉的是「那天整頁沒有籌碼」。
    """
    for attempt in range(1, tries + 1):
        del ERRORS[:]
        code = main()
        if code == 0:
            return 0
        if attempt < tries:
            log(u'整份都沒拿到，%d 秒後重跑一次' % (DELAY * 5))
            time.sleep(DELAY * 5)
    return 1


if __name__ == '__main__':
    sys.exit(run_with_retry())
