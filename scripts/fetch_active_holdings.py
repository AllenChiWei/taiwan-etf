# -*- coding: utf-8 -*-
u"""主動式 ETF 的每日持股與換股紀錄，逐日累積。

    python scripts/fetch_active_holdings.py [--backfill 30]

寫到 app/public/data/active_holdings.json，**進版控**（最新持股＋近 60 個交易日的變動）。

## 為什麼只有主動式、為什麼是這幾檔

主動式 ETF 依規定每個交易日都要公告完整持股，而且經理人真的會天天調整 —— 被動式
一季才換一次成分股，每天比沒有意義。清單＝站主指定的幾檔（PICKED）＋**每天重算的
市值前十大主動式 ETF（排除債券）**（站主要求，2026-09-23）。市值用證交所
t187ap47_L 的發行單位數 × STOCK_DAY_ALL 的收盤價，兩個請求。排名變了清單就跟著變；
掉出前十的已有資料照樣保留、繼續更新。

## 來源：各投信自己的網站

證交所的 `ETF/productContent` 會給每檔 ETF 的 PCF 網址，但持股本身只放在各家投信
的網站，而且三家三種寫法。都先查過 robots.txt：

    統一  ezmoney.com.tw      沒有 robots.txt；第一次請求會先發 cookie 再轉址回原網址，
                              接受 cookie 之後就是一般的 JSON API（POST GetPCF）
    復華  fhtrust.com.tw      robots.txt 只擋 GPTBot；GET /api/assets?fundID=&qDate=
    中信  ctbcinvestments     robots.txt `Allow: /`；網頁載入時先向 home/AuthToken 領一個
                              工作階段 token（每個訪客都會拿到），再 POST etf/Buyback
    群益  capitalfund.com.tw  robots.txt `Allow: /`；API 在 /CFWeb（assets/conf/app.json 寫的），
                              POST api/etf/buyback {fundId, date}；空 body 的 POST 會回 411，要送 null
    元大  yuantaetfs.com      robots.txt `Allow: /`；etfapi.yuantaetfs.com/ectranslation/api/bridge
                              ?FuncId=PCF/Daily&ticker=（就是證券代號）
    凱基  kgifund.com.tw      robots.txt 沒有限制；POST /Fund/RedemptionVC fundID=J024，回 HTML 片段

各家網站內部的基金代碼（統一 49YTW、復華 ETF23、中信 E0038、群益 399、凱基 J024）
不寫死，每次從各家的基金清單查（resolve_ids）—— 市值前十會換人，寫死就跟不上。查到的
存進 meta.ids，某家清單那天被擋（中信的 Incapsula 會）就沿用上次的，不會把一檔明明
接得上的 ETF 誤標成「還沒接上」（第一版就這樣漏更新了 00406A）。

**做不到的：國泰 00400A。** cathaysite.com.tw 對表明身分的 User-Agent 連 robots.txt 都
回 403。要拿只能假裝成瀏覽器，這個專案不做（與 CNN、奇摩、富邦同一條線）。產出裡
記在 meta.blocked，畫面會照實說少了哪一檔、為什麼。

## 持股日期

三家「這份持股是哪一天的」寫在不同地方，統一記成 asof ＝ 持股對應的交易日（收盤後）：

    統一  TranDate（/Date(毫秒)/，要轉成台北時間）
    復華  回應裡的 dDate；查詢日沒有資料時它會回空的
    中信  「每受益權單位淨資產價值DATE」—— 公告日是隔天，不能拿公告日
    群益  pcf.date2（date1 是公告日）；查詢參數 date 也是公告日

兩天的 asof 相同代表那天沒有新資料（假日或還沒公告），不當成「沒有換股」記一筆。

## 產出

    {"meta": {...},
     "etfs": {"00981A": {"name", "issuer", "asof",
                         "holdings": [[代號, 名稱, 股數, 權重%], ...],     依權重排序
                         "changes": [{"d": asof, "p": 前一次 asof, "f": 資金進出比例,
                                      "items": [[代號, 名稱, 前股數, 股數, 權重%], ...]}]}}}

changes 只記有變動的標的：前股數 0 是新增、股數 0 是剔除。期貨也算（口數）。
「有變動」是扣掉當天資金進出之後才算的，見 diff()。
"""
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import http.cookiejar
import html as htmllib
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'active_holdings.json')

TPE = timezone(timedelta(hours=8))
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; +https://allenchiwei.github.io/taiwan-etf/) '
      'active ETF holdings')
DELAY = 2.0
TIMEOUT = 40
# 換股紀錄留幾次（約三個月的交易日）
KEEP_CHANGES = 60
# 扣掉資金進出之後，股數偏離小於這個比例視為沒變（見 diff）
MIN_CHANGE = 0.005

# 站主指定的幾檔（2026-09-23）。市值前五另外每天算，兩者合起來、依代號排序。
PICKED = ['00981A', '00988A', '00409A', '00411A', '00406A', '00991A', '00400A', '00992A']
TOP_N = 10

ISSUER_NAME = {'ezmoney': u'統一投信', 'fhtrust': u'復華投信', 'ctbc': u'中國信託投信',
               'capital': u'群益投信', 'yuanta': u'元大投信', 'kgi': u'凱基投信'}
# 已知的網站內部代碼，最底層的備援（各家清單都查不到、也沒有上次的紀錄時用）
KNOWN_IDS = {
    '00981A': ('ezmoney', '49YTW'), '00988A': ('ezmoney', '61YTW'), '00411A': ('ezmoney', '64YTW'),
    '00403A': ('ezmoney', '63YTW'), '00991A': ('fhtrust', 'ETF23'), '00409A': ('fhtrust', 'ETF26'),
    '00406A': ('ctbc', 'E0038'), '00982A': ('capital', '399'), '00407A': ('kgi', 'J024'),
}
# 從 ETF 簡稱（「主動統一台股增長」）認投信
ISSUER_BY_NAME = [(u'統一', 'ezmoney'), (u'復華', 'fhtrust'), (u'中信', 'ctbc'), (u'群益', 'capital'),
                  (u'元大', 'yuanta'), (u'凱基', 'kgi')]
# 做不到的投信與原因。其他沒接的投信會標「還沒接」
REFUSED = {
    u'國泰': u'國泰投信網站對表明身分的程式回 403（連 robots.txt 也是），不假裝成瀏覽器去抓',
    u'富邦': u'富邦投信持股頁所在的網站 robots.txt 是 Disallow: /',
}

ERRORS = []


def log(m):
    print(m, flush=True)


def note(m):
    log(u'  ⚠ %s' % m)
    ERRORS.append(m)


def num(s):
    s = str(s if s is not None else '').replace(',', '').replace('%', '').strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


# 一般請求本來就會帶的標頭。中信前面有 Incapsula，urllib 預設幾乎不帶標頭的請求會被
# 當成機器人回 403（同一個 UA 用 curl 就正常）—— 補上 Accept 不是偽裝，UA 照樣表明身分
HEADERS = {'User-Agent': UA, 'Accept': 'application/json, text/html;q=0.9, */*;q=0.8',
           'Accept-Language': 'zh-TW,zh;q=0.9'}


class Http(object):
    u"""帶 cookie 的連線。統一的網站要先接受它發的 cookie。"""

    def __init__(self, cookies=True):
        # 中信要用 cookies=False：它前面的 Incapsula 會在回應裡發 cookie，帶著那組
        # 「還沒跑過它 JS 驗證」的 cookie 再來反而被擋 403；不帶就正常
        handlers = [urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())] if cookies else []
        self.op = urllib.request.build_opener(*handlers)

    def get(self, url):
        req = urllib.request.Request(url, headers=HEADERS)
        raw = self.op.open(req, timeout=TIMEOUT).read()
        time.sleep(DELAY)
        return raw

    def post_form(self, url, form):
        req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode('utf-8'),
                                     headers=dict(HEADERS, **{
                                         'Content-Type': 'application/x-www-form-urlencoded'}))
        raw = self.op.open(req, timeout=TIMEOUT).read()
        time.sleep(DELAY)
        return raw.decode('utf-8', 'replace')

    def post_json(self, url, body):
        req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers=dict(
            HEADERS, **{'Content-Type': 'application/json; charset=utf-8'}))
        raw = self.op.open(req, timeout=TIMEOUT).read()
        time.sleep(DELAY)
        return json.loads(raw.decode('utf-8'))


def row(code, name, shares, weight):
    # 名稱後面的「*」是來源的註記符號（國巨*），不是名稱的一部分
    return [str(code).strip(), str(name).strip().rstrip('*').strip(),
            int(round(shares)), round(weight, 2)]


# ── 統一 ─────────────────────────────────────────────────────

class Ezmoney(object):
    BASE = 'https://www.ezmoney.com.tw/ETF/Transaction/'

    def __init__(self, http):
        self.http = http
        self.ready = False

    def fetch(self, fid, day):
        if not self.ready:
            self.http.get(self.BASE + 'PCF')        # 拿 cookie
            self.ready = True
        # 統一的日期參數是「公告日」，公告的是前一個交易日收盤後的持股 —— 要某一天的持股
        # 得查下一個交易日（週五的持股在週一公告）
        post = day + timedelta(days=3 if day.weekday() == 4 else 1)
        roc = '%d/%02d/%02d' % (post.year - 1911, post.month, post.day)
        # 公告日還在未來（今天收盤後剛公告的那份）時，指定日期模式查不到，
        # 要用網頁預設的「最新」模式（specificDate=false）
        latest = post > datetime.now(TPE).date()
        d = self.http.post_json(self.BASE + 'GetPCF',
                                {'fundCode': fid, 'date': roc, 'specificDate': not latest})
        pcf = d.get('pcf') or []
        if not pcf:
            return None, []
        asof = self.tran_date(pcf[0].get('TranDate'))
        rows = []
        for a in d.get('asset') or []:
            if a.get('AssetCode') not in ('ST', 'GD'):
                continue
            for x in a.get('Details') or []:
                code = str(x.get('DetailCode') or '').strip()
                # 期貨換月時同時持有兩個月份的 TX，只用代號當鍵會互相蓋掉
                if a.get('AssetCode') == 'GD' and (x.get('MTH') or '').strip():
                    code = '%s %s' % (code, x['MTH'].strip())
                rows.append(row(code, x.get('DetailName'),
                                num(x.get('Share')), num(x.get('NavRate'))))
        return asof, rows

    @staticmethod
    def tran_date(v):
        u"""'/Date(1790006400000)/' 或 '2026-09-23T00:00:00' -> '2026-09-23'（台北日期）。"""
        v = str(v or '')
        m = re.match(r'/Date\((\d+)\)/', v)
        if m:
            return datetime.fromtimestamp(int(m.group(1)) / 1000.0, TPE).date().isoformat()
        return v[:10] if re.match(r'\d{4}-\d{2}-\d{2}', v) else None


# ── 復華 ─────────────────────────────────────────────────────

class Fhtrust(object):
    URL = 'https://www.fhtrust.com.tw/api/assets?'

    def __init__(self, http):
        self.http = http

    def fetch(self, fid, day):
        q = urllib.parse.urlencode({'fundID': fid, 'qDate': day.strftime('%Y/%m/%d')})
        d = json.loads(self.http.get(self.URL + q).decode('utf-8'))
        r = (d.get('result') or [None])[0]
        if not r or not r.get('detail'):
            return None, []
        asof = str(r.get('dDate') or '').replace('/', '-')[:10] or day.isoformat()
        rows = []
        for x in r['detail']:
            if x.get('ftype') not in (u'股票', u'期貨'):
                continue
            rows.append(row(x.get('stockid'), x.get('stockname'),
                            num(x.get('qshare')), num(x.get('prate_addaccint'))))
        return asof, rows


# ── 中信 ─────────────────────────────────────────────────────

class Ctbc(object):
    BASE = 'https://www.ctbcinvestments.com.tw/API/'

    def __init__(self, http):
        self.http = http
        self.token = None

    def post(self, path, data=None):
        token = self.token or 'www.ctbcinvestments.com'   # 網頁未領 token 前用的就是這個字串
        body = dict({'token': token}, **(data or {}))
        url = self.BASE + path + '?' + urllib.parse.urlencode({'token': token})
        return self.http.post_json(url, body)

    def fetch(self, fid, day):
        if not self.token:
            self.token = (self.post('home/AuthToken').get('Data') or {}).get('token')
        d = self.post('etf/Buyback', {'FID': fid, 'StartDate': day.isoformat()})
        if d.get('ResultCode') not in (0, '0'):
            raise RuntimeError(u'中信回 %s' % d.get('ResultMsg'))
        data = d.get('Data') or {}
        head = (data.get('Data') or [None])[0]
        if not head:
            return None, []
        asof = str(head.get(u'每受益權單位淨資產價值DATE') or '').replace('/', '-')[:10]
        rows = []
        for grp in data.get('Detail') or []:
            if grp.get('Code') not in ('STOCK', 'FUTURE', 'FUTURES'):
                continue
            for x in grp.get('Data') or []:
                rows.append(row(x.get('code_'), x.get('name_'),
                                num(x.get('qty_')), num(x.get('weights_'))))
        return asof or None, rows


# ── 群益 ─────────────────────────────────────────────────────

class Capital(object):
    BASE = 'https://www.capitalfund.com.tw/CFWeb/api/etf/'

    def __init__(self, http):
        self.http = http

    def fetch(self, fid, day):
        # date 是公告日（跟統一一樣），公告的是前一個交易日的持股；還在未來就送 null（最新）
        post = day + timedelta(days=3 if day.weekday() == 4 else 1)
        latest = post > datetime.now(TPE).date()
        d = self.http.post_json(self.BASE + 'buyback',
                                {'fundId': fid, 'date': None if latest else post.isoformat()})
        d = d.get('data', d) if isinstance(d, dict) else d
        if not d or not d.get('stocks'):
            return None, []
        asof = str((d.get('pcf') or {}).get('date2') or '')[:10] or None
        rows = [row(x.get('stocNo'), x.get('stocName'), num(x.get('share')), num(x.get('weight')))
                for x in d['stocks']]
        return asof, rows


# ── 元大 ─────────────────────────────────────────────────────

class Yuanta(object):
    URL = 'https://etfapi.yuantaetfs.com/ectranslation/api/bridge?'

    def __init__(self, http):
        self.http = http

    def fetch(self, code, day):
        q = urllib.parse.urlencode({
            'APIType': 'ETFAPI', 'CompanyName': 'YUANTAFUNDS', 'PageName': '/tradeInfo/pcf/' + code,
            'DeviceId': 'null', 'FuncId': 'PCF/Daily', 'AppName': 'ETF', 'Device': '3',
            'Platform': 'ETF', 'ticker': code, 'date': day.strftime('%Y%m%d')})
        d = json.loads(self.http.get(self.URL + q).decode('utf-8'))
        d = d.get('Data', d) if isinstance(d, dict) else {}
        pcf = (d or {}).get('PCF') or {}
        stocks = ((d or {}).get('FundWeights') or {}).get('StockWeights') or []
        if not pcf or not stocks:
            return None, []
        t = str(pcf.get('trandate') or '')
        asof = '%s-%s-%s' % (t[:4], t[4:6], t[6:8]) if len(t) == 8 else None
        return asof, [row(x.get('code'), x.get('name'), num(x.get('qty')), num(x.get('weights')))
                      for x in stocks]


# ── 凱基 ─────────────────────────────────────────────────────

class Kgi(object):
    URL = 'https://www.kgifund.com.tw/Fund/RedemptionVC'

    def __init__(self, http):
        self.http = http

    def fetch(self, fid, day):
        # queryDate 是公告日（跟統一一樣），還在未來就不給（最新）
        post = day + timedelta(days=3 if day.weekday() == 4 else 1)
        form = {'fundID': fid}
        if post <= datetime.now(TPE).date():
            form['queryDate'] = post.strftime('%Y/%m/%d')
        page = self.http.post_form(self.URL, form)
        # 持股日期是「(2026/09/23)每受益權單位淨資產價值」那個括號，不是公告日
        m = re.search(r'\((\d{4})/(\d{2})/(\d{2})\)\s*每受益權單位淨資產價值', text_of(page))
        rows = []
        for tr in re.findall(r'<tr.*?</tr>', page, re.S):
            c = [text_of(td) for td in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
            if len(c) == 4 and re.match(r'^[0-9A-Z]{4,6}$', c[0]):
                rows.append(row(c[0], c[1], num(c[2]), num(c[3])))
        if not m or not rows:
            return None, []
        return '%s-%s-%s' % m.groups(), rows

    def ids(self):
        u"""{基金簡稱: J024}，從申購買回清單頁的下拉選單。"""
        page = self.http.get('https://www.kgifund.com.tw/Fund/RedemptionList').decode('utf-8', 'replace')
        return dict((htmllib.unescape(n).strip(), v) for v, n in re.findall(
            r'<option class="fundSelector" value="([^"]+)"[^>]*>([^<]+)</option>', page))


def text_of(s):
    return re.sub(r'\s+', ' ', htmllib.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


# ── 追蹤清單：指定的 + 市值前十 ──────────────────────────────

def get_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    return json.loads(urllib.request.urlopen(req, timeout=60).read().decode('utf-8'))


def active_universe():
    u"""{代號: (簡稱, 市值億元)}，上市的主動式股票型 ETF（排除債券）。

    市值 = t187ap47_L 的發行單位數 × STOCK_DAY_ALL 的收盤價。主動式股票型的代號結尾是 A，
    債券型是 D（00986D、00987D），再用基金類型裡有沒有「債」多擋一層。
    """
    funds = get_json('https://openapi.twse.com.tw/v1/opendata/t187ap47_L')
    closes = dict((r.get('Code'), r.get('ClosingPrice'))
                  for r in get_json('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'))
    out = {}
    for r in funds:
        code = r.get(u'基金代號') or ''
        if not code.endswith('A') or u'債' in (r.get(u'基金類型') or ''):
            continue
        try:
            cap = float(r.get(u'發行單位數/轉換數') or 0) * float(closes.get(code) or 0) / 1e8
        except ValueError:
            cap = 0.0
        out[code] = (r.get(u'基金簡稱') or code, round(cap, 1))
    return out


def resolve_ids(http, ctbc_http, universe=None):
    u"""{證券代號: (投信鍵, 網站內部代碼)}，從各家的基金清單查。一家失敗不影響其他家。"""
    out = {}
    try:                                                # 統一：PCF 頁裡的 DataFundList
        html = http.get(Ezmoney.BASE + 'PCF').decode('utf-8', 'replace')
        m = re.search(r'id="DataFundList" data-content="([^"]+)"', html)
        for f in json.loads(htmllib.unescape(m.group(1))) if m else []:
            out[(f.get('sStockNo') or '').strip()] = ('ezmoney', f.get('sFundCode'))
    except Exception as e:                              # noqa: BLE001
        note(u'統一基金清單：%s' % str(e)[:60])
    try:                                                # 復華：fundList 的 etf002
        for f in json.loads(http.get('https://www.fhtrust.com.tw/api/fundList?ec001=3')
                            .decode('utf-8')).get('result') or []:
            if f.get('etf002'):
                out[f['etf002'].strip()] = ('fhtrust', f.get('fundID'))
    except Exception as e:                              # noqa: BLE001
        note(u'復華基金清單：%s' % str(e)[:60])
    try:                                                # 中信：ETFCNOList
        c = Ctbc(ctbc_http)
        c.token = (c.post('home/AuthToken').get('Data') or {}).get('token')
        for f in ((c.post('etf/ETFCNOList').get('Data') or {}).get('List') or []):
            out[(f.get('ETF_ID') or '').strip()] = ('ctbc', f.get('FID'))
    except Exception as e:                              # noqa: BLE001
        note(u'中信基金清單：%s' % str(e)[:60])
    try:                                                # 群益：api/etf/items，外面包一層 data
        d = http.post_json(Capital.BASE + 'items', None)
        for f in (d.get('data') if isinstance(d, dict) else d) or []:
            out[(f.get('stockNo') or '').strip()] = ('capital', f.get('fundNo'))
    except Exception as e:                              # noqa: BLE001
        note(u'群益基金清單：%s' % str(e)[:60])
    try:                                                # 凱基：下拉選單只有簡稱，用簡稱對代號
        for short, fid in Kgi(http).ids().items():
            code = next((c for c, (n, _) in (universe or {}).items() if n == short), None)
            if code:
                out[code] = ('kgi', fid)
    except Exception as e:                              # noqa: BLE001
        note(u'凱基基金清單：%s' % str(e)[:60])
    for code, (n, _) in (universe or {}).items():       # 元大：API 直接用證券代號
        if u'元大' in n and code not in out:
            out[code] = ('yuanta', code)
    return out


# ── 換股 ─────────────────────────────────────────────────────

def flow_ratio(prev, cur):
    u"""兩天都有的持股，股數比值的中位數。

    主動式 ETF 是現金申購：如果經理人把流入的資金同比例攤進每一檔，股數會一起伸縮，
    那是「資金進出」而不是「看好誰」，不該顯示成全面加碼。中位數不怕少數幾檔真的被調整。

    **目前實測它一直是 0**（2026-09 回補的六檔、一百四十幾天）：這幾檔的持股大多數日子
    股數完全不動，資金進來先放現金，再挑股票買。所以這是一道保險，不是每天都在作用 ——
    哪天有經理人改成同比例攤入，換股清單也不會突然整排變成加碼。
    """
    p = dict((r[0], r[2]) for r in prev)
    ratios = sorted(r[2] / float(p[r[0]]) for r in cur if p.get(r[0]) and r[2])
    if not ratios:
        return 1.0
    mid = len(ratios) // 2
    return ratios[mid] if len(ratios) % 2 else (ratios[mid - 1] + ratios[mid]) / 2.0


def diff(prev, cur):
    u"""兩份持股 -> (資金進出比例, 有變動的標的 [[代號, 名稱, 前股數, 股數, 權重], ...])。

    判斷「有沒有換股」要先扣掉當天的資金進出（flow_ratio）：股數跟著大家一起同比例
    伸縮的不算，偏離超過 MIN_CHANGE 才算經理人真的加碼或減碼。新增與剔除一律列出。
    """
    m = flow_ratio(prev, cur)
    p = dict((r[0], r) for r in prev)
    c = dict((r[0], r) for r in cur)
    out = []
    for code in set(p) | set(c):
        a = p[code][2] if code in p else 0
        b = c[code][2] if code in c else 0
        if a == b:
            continue
        if a and b and abs(b / (a * m) - 1) < MIN_CHANGE:
            continue
        ref = c.get(code) or p.get(code)
        out.append([code, ref[1], a, b, c[code][3] if code in c else 0])
    # 新增與剔除排前面，其餘依扣掉資金進出後的變動幅度
    out.sort(key=lambda r: (0 if (r[2] == 0 or r[3] == 0) else 1,
                            -abs(r[3] / (max(r[2], 1) * m) - 1)))
    return round(m - 1, 4), out


def trading_days_back(n):
    today = datetime.now(TPE).date()
    out = []
    d = today
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return sorted(out)


def main():
    args = sys.argv[1:]
    backfill = 0
    for i, a in enumerate(args):
        if a.startswith('--backfill'):
            backfill = int(a.split('=')[1]) if '=' in a else (
                int(args[i + 1]) if i + 1 < len(args) and args[i + 1].isdigit() else 30)

    doc = {}
    if os.path.exists(OUT):
        try:
            doc = json.load(io.open(OUT, encoding='utf-8'))
        except Exception as e:                                # noqa: BLE001
            note(u'既有的 active_holdings.json 讀不起來（%s），這次重建' % str(e)[:60])
    etfs = doc.get('etfs') or {}

    http = Http()
    ctbc_http = Http(cookies=False)
    clients = {'ezmoney': Ezmoney(http), 'fhtrust': Fhtrust(http), 'ctbc': Ctbc(ctbc_http),
               'capital': Capital(http), 'yuanta': Yuanta(http), 'kgi': Kgi(http)}
    names = load_names()

    try:
        universe = active_universe()
    except Exception as e:                                    # noqa: BLE001
        note(u'市值排名：%s' % str(e)[:60])
        universe = {}
    ranked = sorted(universe.items(), key=lambda kv: -kv[1][1])
    top = [c for c, _ in ranked[:TOP_N]]
    log(u'市值前 %d：%s' % (TOP_N, u'、'.join('%s %s（%s 億）' % (c, universe[c][0], universe[c][1])
                                           for c in top)))
    # 指定的、市值前五、以及之前追蹤過的（掉出前五也繼續更新，紀錄才不會斷）
    targets = sorted(set(PICKED) | set(top) | set(etfs))
    # 上次查到的代碼當底，這次查到的蓋上去：某家清單那天被擋也不會漏掉
    ids = dict(KNOWN_IDS)
    ids.update((k, tuple(v)) for k, v in ((doc.get('meta') or {}).get('ids') or {}).items())
    ids.update(resolve_ids(http, ctbc_http, universe))
    jobs, blocked = [], []
    for code in targets:
        name = names.get(code) or universe.get(code, (code,))[0]
        if code in ids and ids[code][0] in clients:
            jobs.append({'code': code, 'issuer': ids[code][0], 'id': ids[code][1]})
            continue
        refused = next((r for k, r in REFUSED.items() if k in name), None)
        blocked.append({'code': code, 'name': name, 'cap': universe.get(code, (None, None))[1],
                        'top': code in top,
                        'reason': refused or u'這家投信的持股還沒接上'})

    for e in jobs:
        code = e['code']
        cur = etfs.get(code) or {}
        # 沒有既有資料就回補；否則只問今天與前兩個交易日（補上晚公告的）
        days = trading_days_back(backfill or (25 if not cur else 3))
        log(u'%s（%s）：查 %d 天' % (code, ISSUER_NAME[e['issuer']], len(days)))
        snaps = []
        for day in days:
            try:
                asof, rows = clients[e['issuer']].fetch(e['id'], day)
            except Exception as ex:                           # noqa: BLE001
                note(u'%s %s：%s' % (code, day.isoformat(), str(ex)[:80]))
                continue
            if asof and rows and (not snaps or snaps[-1][0] != asof):
                snaps.append((asof, sorted(rows, key=lambda r: -r[3])))
        if not snaps:
            note(u'%s 一天都沒拿到' % code)
            if cur:
                # 持股沿用上次的，但市值與前十標記要照今天的，合計持股才算得到它
                cur['cap'] = universe.get(code, (None, None))[1]
                cur['top'] = code in top
            continue

        changes = list(cur.get('changes') or [])
        seen = set(c['d'] for c in changes)
        prev = (cur.get('asof'), cur.get('holdings')) if cur.get('holdings') else None
        for asof, rows in snaps:
            if prev and asof <= prev[0]:
                # 已經有的日子：用新的那份當比較基準，但不重記
                if asof == prev[0]:
                    prev = (asof, rows)
                continue
            if prev and asof not in seen:
                flow, items = diff(prev[1], rows)
                # f：當天資金進出讓持股整體伸縮了多少（+0.004 = 同比例多了 0.4%）
                changes.append({'d': asof, 'p': prev[0], 'f': flow, 'items': items})
                seen.add(asof)
            prev = (asof, rows)
        changes.sort(key=lambda c: c['d'])
        etfs[code] = {
            'name': names.get(code) or cur.get('name') or code,
            'issuer': ISSUER_NAME[e['issuer']],
            # 市值（億元）與是否在前五 —— 前端標「市值前五」用
            'cap': universe.get(code, (None, None))[1],
            'top': code in top,
            'asof': prev[0],
            'holdings': prev[1],
            'changes': changes[-KEEP_CHANGES:],
        }
        last = changes[-1] if changes else None
        log(u'  持股 %d 檔，最新 %s；換股紀錄 %d 天%s' % (
            len(prev[1]), prev[0], len(changes),
            u'，最近一次 %d 檔變動' % len(last['items']) if last else u''))

    payload = {
        'meta': {
            'updated': datetime.now(TPE).date().isoformat(),
            'minChange': MIN_CHANGE,
            'blocked': blocked,
            'top': top,
            # 各家網站內部的基金代碼，下次某家清單被擋時沿用
            'ids': dict((c, list(v)) for c, v in sorted(ids.items()) if c in set(targets)),
            'source': u'各投信官網每日公告之持股（統一、復華、中國信託、群益、元大、凱基）',
            'errors': ERRORS,
        },
        'etfs': dict(sorted(etfs.items())),               # 依代號排序（站主指定）
    }
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    log(u'完成：%s（%d 檔，%.0f KB）' % (OUT, len(etfs), os.path.getsize(OUT) / 1024.0))
    return 0 if etfs else 1


def load_names():
    u"""ETF 簡稱，從 etfs.json 拿（名稱跟台股頁一致）。"""
    try:
        d = json.load(io.open(os.path.join(ROOT, 'app', 'public', 'data', 'etfs.json'),
                              encoding='utf-8'))
        return dict((x['code'], x['name']) for x in d.get('etfs') or [])
    except Exception:                                         # noqa: BLE001
        return {}


if __name__ == '__main__':
    sys.exit(main())
