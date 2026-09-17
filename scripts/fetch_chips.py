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
    largeTraderFutDown     期貨大額交易人未沖銷部位（前五大／前十大）
    largeTraderOptDown     選擇權大額交易人未沖銷部位

交易所這邊：

    TWSE  fund/T86                    上市三大法人買賣超日報（全部個股）
    TWSE  afterTrading/MI_INDEX       當日每日收盤行情（拿成交均價用）
    TPEx  insti/dailyTrade            上櫃三大法人買賣超
    TPEx  afterTrading/otc            上櫃當日收盤行情

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

**契約金額的單位是千元。** 期交所原始欄位就是千元，這裡原樣保留，換算交給前端，
免得在 JSON 裡再乘一次、之後看到數字時搞不清楚是哪一種單位。
"""
import io
import json
import re
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta

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

TAIFEX = 'https://www.taifex.com.tw/cht/3/%s'
TWSE_T86 = ('https://www.twse.com.tw/rwd/zh/fund/T86'
            '?date=%s&selectType=ALL&response=json')
TWSE_PRICE = ('https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX'
              '?date=%s&type=ALL&response=json')
TPEX_INSTI = ('https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade'
              '?type=Daily&sect=EW&date=%s&id=&response=json')
TPEX_PRICE = ('https://www.tpex.org.tw/www/zh-tw/afterTrading/otc'
              '?date=%s&type=EW&response=json')

# 追蹤這幾種契約就夠了。全市場 346 種裡絕大多數是個股期貨，籌碼面在看的是大盤。
FUT_CONTRACTS = [u'臺股期貨', u'電子期貨', u'金融期貨', u'小型臺指期貨', u'微型臺指期貨']
# 大額交易人表用代號，且名稱帶換算說明（TX = 臺股期貨(TX+MTX/4+TMF/20)）
LARGE_FUT_IDS = {'TX': u'臺股期貨', 'TE': u'電子期貨', 'TF': u'金融期貨'}
LARGE_OPT_IDS = {'TXO': u'臺指選擇權'}

# 期交所寫「外資及陸資」，畫面上一律講「外資」—— 兩邊指的是同一件事
WHO = {u'自營商': u'自營商', u'投信': u'投信', u'外資及陸資': u'外資', u'外資': u'外資'}
WHO_ORDER = [u'自營商', u'投信', u'外資']

# 大額交易人的到期月份欄位有兩個特別值
TERM_ALL = '999999'
TERM_WEEK = '666666'


def log(m):
    print(m, flush=True)


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


def fetch_csv(page, params):
    u"""期交所的下載端點。回傳已切好的資料列（不含表頭與註腳）。

    編碼兩種都出現過：多數是 UTF-8，少數頁面是 Big5，所以先試 UTF-8 再退回。
    回 HTML 代表參數被拒（例如區間太長），這時當成沒有資料而不是硬解析。
    """
    raw = fetch(TAIFEX % page, params)
    try:
        txt = raw.decode('utf-8')
    except UnicodeDecodeError:
        txt = raw.decode('big5', 'replace')
    lines = [l for l in txt.splitlines() if l.strip()]
    if not lines or lines[0].lstrip().startswith('<'):
        log(u'  %s 回傳的不是 CSV（區間太長或被拒），這段跳過' % page)
        return []
    out = []
    for line in lines[1:]:
        cells = [c.strip() for c in line.split(',')]
        # 註腳（「-表當日收盤後無週到期契約」之類）沒有日期，用開頭是不是年份來擋
        if len(cells) < 5 or not cells[0][:4].isdigit():
            continue
        out.append(cells)
    return out


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


def windows(days, step):
    u"""把 days 天切成不超過 step 天的區間，由舊到新。"""
    today = date.today()
    start = today - timedelta(days=days)
    out = []
    while start <= today:
        end = min(start + timedelta(days=step - 1), today)
        out.append((start.strftime('%Y/%m/%d'), end.strftime('%Y/%m/%d')))
        start = end + timedelta(days=1)
    return out


# ── 期交所：三大法人 ─────────────────────────────────────────

def futures(rows):
    u"""最新一日的三大法人期貨未平倉，以及每日淨未平倉口數的歷史。

    回傳 (latest, history, 日期)。latest 只留主要契約，history 只留口數 ——
    契約金額每天存一份會讓檔案大一倍，而趨勢看口數就夠。
    """
    if not rows:
        return [], {'dates': [], 'contracts': {}}, None
    last_day = rows[-1][0]
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


def options(rows):
    u"""最新一日的三大法人選擇權未平倉（買權／賣權分計，含契約金額）。"""
    if not rows:
        return []
    last_day = rows[-1][0]
    out = []
    for c in rows:
        if c[0] != last_day or c[1] != u'臺指選擇權':
            continue
        out.append({
            'cp': c[2], 'w': WHO.get(c[3], c[3]),
            'n': num(c[14]), 'a': num(c[15]),          # 未平倉買賣淨額：口數、金額(千元)
            'bn': num(c[10]), 'ba': num(c[11]),        # 買方未平倉
            'sn': num(c[12]), 'sa': num(c[13]),        # 賣方未平倉
        })
    return out


def pc_ratio(days):
    u"""Put/Call Ratio 的歷史。一次最多一個月，所以切段抓。"""
    dates, vol, oi = [], [], []
    for a, b in windows(days, WINDOW_DAYS):
        for c in fetch_csv('pcRatioDown', {'queryStartDate': a, 'queryEndDate': b}):
            day = iso(c[0])
            if day in dates:
                continue
            dates.append(day)
            vol.append(num(c[3]))
            oi.append(num(c[6]))
    order = sorted(range(len(dates)), key=lambda i: dates[i])
    return {
        'dates': [dates[i] for i in order],
        'vol': [vol[i] for i in order],
        'oi': [oi[i] for i in order],
    }


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

def twse_prices(day):
    u"""上市個股的當日成交均價 {代號: 均價}。均價 = 成交金額 ÷ 成交股數。"""
    doc = json.loads(fetch(TWSE_PRICE % day).decode('utf-8'))
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
    doc = json.loads(fetch(TPEX_PRICE % day).decode('utf-8'))
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


def twse_top(day):
    u"""上市：外資／投信／自營商各自的買賣超前十大。"""
    doc = json.loads(fetch(TWSE_T86 % day).decode('utf-8'))
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
    doc = json.loads(fetch(TPEX_INSTI % date_roc).decode('utf-8'))
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

    log(u'期交所：三大法人期貨（近 %d 天）…' % HISTORY_DAYS)
    fut_rows = []
    for a, b in windows(HISTORY_DAYS, WINDOW_DAYS):
        fut_rows += fetch_csv('futContractsDateDown', {
            'firstDate': '', 'lastDate': '', 'commodityId': '',
            'queryStartDate': a, 'queryEndDate': b})
    fut_latest, fut_hist, fut_day = futures(fut_rows)
    log(u'  %d 筆，最新 %s，契約 %d 種'
        % (len(fut_rows), fut_day, len(fut_hist['contracts'])))

    log(u'期交所：三大法人選擇權…')
    opt_rows = fetch_csv('callsAndPutsDateDown', {
        'firstDate': '', 'lastDate': '', 'commodityId': '',
        'queryStartDate': fut_day.replace('-', '/'),
        'queryEndDate': fut_day.replace('-', '/')})
    opt_latest = options(opt_rows)
    log(u'  臺指選擇權 %d 筆' % len(opt_latest))

    log(u'期交所：Put/Call Ratio（近 %d 天）…' % HISTORY_DAYS)
    pc = pc_ratio(HISTORY_DAYS)
    log(u'  %d 個交易日，最新未平倉比 %s%%'
        % (len(pc['dates']), pc['oi'][-1] if pc['oi'] else u'—'))

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
    log(u'證交所：上市三大法人買賣超（%s）…' % fut_day)
    twse = twse_top(day_compact)
    log(u'櫃買：上櫃三大法人買賣超…')
    tpex = tpex_top(day_compact)

    payload = {
        'meta': {
            'date': fut_day,
            'updated': date.today().isoformat(),
            'source': u'臺灣期貨交易所／臺灣證券交易所／證券櫃檯買賣中心',
            'note': (u'買賣超金額為估算：交易所只公佈股數，這裡以當日成交均價'
                     u'（成交金額÷成交股數）乘上買賣超股數推估。'
                     u'期貨與選擇權的契約金額單位為千元。'),
        },
        'futures': fut_latest,
        'futHistory': fut_hist,
        'options': opt_latest,
        'pc': pc,
        'large': {'fut': large_fut, 'opt': large_opt},
        'top': {'twse': twse, 'tpex': tpex},
    }
    write_json(OUT, payload)
    size = os.path.getsize(OUT) / 1024.0
    log(u'完成：%s（%.0f KB）' % (OUT, size))


if __name__ == '__main__':
    main()
