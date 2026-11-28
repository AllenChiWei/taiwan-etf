# -*- coding: utf-8 -*-
u"""被動式 ETF 全部持股（投信每日申購買回清單＋投信投顧公會季報持股 1% 以上）。

    python scripts/fetch_etf_holdings.py [--only capital,fhtrust,yuanta] [--domestic-only] [--no-sitca]

寫到 app/public/data/etf_holdings.json，**只放最新一天、不累積、不混入 active_holdings.json**。

## 來源與策略

1. 既有 8 家投信（共用 scripts/fetch_active_holdings.py 的端點與連線設定，誠實 UA）：
   - 群益  POST /CFWeb/api/etf/items → /buyback {fundId, date:null}（weight 直接給）
   - 復華  GET /api/fundList?ec001=3 → /api/assets?fundID=&qDate=（weight = prate_addaccint）
   - 元大  GET bridge?FuncId=PCF/Daily&ticker=&date=（頂層無 Data 包裝；被動式成分在
           InKind.FundComposition 只有申購基數股數 → 乘證交所／櫃買收盤價換算權重，
           分母優先用 PCF 淨值，換算失敗時退回股票部位合計＝100% 並標 denom='stock'）
   - 統一  GET PCF（cookie＋DataFundList）→ POST GetPCF（specificDate:false）
   - 凱基  GET RedemptionList（下拉選單，搭配 etfs.json＋top10.json 全名比對）→ POST RedemptionVC
   - 中信  POST AuthToken → ETFCNOList → etf/Buyback（不帶 cookie、3.5 秒間隔、單輪上限＋403 熔斷）
   - 野村  POST Fund/GetFundAssets（直接用證券代號）
   - 台新  GET /ETF/Home/Pcf/{代號}?FundType=ALL（直接用證券代號）
   元大股數換算用的收盤價共用 fetch_active_holdings.day_prices()（.cache/day_prices/ 快取），
   排程裡緊接在主動式換股後面跑時不額外多打證交所／櫃買。

2. 投信投顧公會「季報持股 1% 以上」（IN2630.aspx?pid=IN22601_05）：
   補官網擋程式的國泰、富邦與其他尚未接 PCF 的投信。季別沒變只發 1 個 GET 就結束；
   失敗只記警告、保留前一版季報資料，不影響投信 PCF。

## 每日請求數控制

預設上限 58 次請求：先跑 resolve_ids（≤6）→ 8 家全部台股被動式 ETF（約 33 檔）→
公會季報檢查（平常 1 GET；每季更新一次約 14 次）→ 剩餘額度依最久未更新順序輪替抓海外被動式 ETF
（近 5 天內已抓過的不重抓）。每檔失敗略過並保留前一版。
"""
import argparse
import html as htmllib
import http.cookiejar
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

import fetch_active_holdings as ah  # noqa: E402
import fetch_top10 as t10  # noqa: E402

ROOT = os.path.dirname(SCRIPTS_DIR)
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'etf_holdings.json')
ETFS_PATH = os.path.join(ROOT, 'app', 'public', 'data', 'etfs.json')
TOP10_PATH = os.path.join(ROOT, 'app', 'public', 'data', 'top10.json')

TPE = timezone(timedelta(hours=8))
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; +https://allenchiwei.github.io/taiwan-etf/) '
      'passive ETF holdings')
HEADERS = {'User-Agent': UA, 'Accept': 'application/json, text/html;q=0.9, */*;q=0.8',
           'Accept-Language': 'zh-TW,zh;q=0.9'}

SITCA_QUARTERLY = 'https://www.sitca.org.tw/ROC/Industry/IN2630.aspx?pid=IN22601_05'
SITCA_SRC = u'投信投顧公會季報'

DEFAULT_MAX_REQUESTS = 58
CTBC_DELAY = 3.5
CTBC_MAX_PER_RUN = 7
FOREIGN_FRESH_DAYS = 5
MAX_STALE_TRADING_DAYS = 5
# 查詢順序：先跑「不需猜日期（最新模式）」的群益、統一、凱基、台新，藉以取得最新交易日 asof，
# 再跑需帶日期參數的復華、元大、野村、中信。
ISSUER_ORDER = ('capital', 'ezmoney', 'kgi', 'tsit', 'fhtrust', 'yuanta', 'nomura', 'ctbc')
ID_LIST_ISSUERS = ('capital', 'ezmoney', 'fhtrust', 'kgi', 'ctbc')
DIRECT_CODE_ISSUERS = ('yuanta', 'nomura', 'tsit')
# 這兩家的查詢日期參數是「公告日／交易日」（持股日期 asof 的下一個交易日），不可把回傳的 asof 再餵回去查詢
ANNOUNCEMENT_DATE_ISSUERS = ('yuanta', 'ctbc')

ERRORS = []


def _ensure_utf8_stdio():
    u"""Windows 本機預設 cp950 印不出 ⚠ 等符號，於執行時安全切換為 UTF-8（不影響 Linux CI）。"""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            try:
                stream.reconfigure(encoding='utf-8', errors='replace')
            except Exception:                                 # noqa: BLE001
                pass


def log(m, stream=None):
    out = stream or sys.stdout
    try:
        print(m, file=out, flush=True)
    except UnicodeEncodeError:
        enc = getattr(out, 'encoding', None) or 'ascii'
        print(str(m).encode(enc, 'replace').decode(enc, 'replace'), file=out, flush=True)


def note(m):
    log(u'  ⚠ %s' % m)
    ERRORS.append(m)


class BudgetExceeded(Exception):
    pass


class CtbcBlocked(Exception):
    pass


class BudgetHttp(ah.Http):
    u"""沿用 fetch_active_holdings.Http，加上總請求數上限、自訂節流與 UA。"""

    def __init__(self, counter, cookies=True, delay=ah.DELAY, headers=None):
        super(BudgetHttp, self).__init__(cookies=cookies)
        self.counter = counter
        self.delay = delay
        self.headers = dict(headers or HEADERS)

    def _consume(self):
        if self.counter['count'] >= self.counter['limit']:
            raise BudgetExceeded(u'已達單輪請求上限 %d' % self.counter['limit'])
        self.counter['count'] += 1

    def get(self, url):
        self._consume()
        req = urllib.request.Request(url, headers=self.headers)
        raw = self.op.open(req, timeout=ah.TIMEOUT).read()
        time.sleep(self.delay)
        return raw

    def post_form(self, url, form):
        self._consume()
        req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode('utf-8'),
                                     headers=dict(self.headers, **{
                                         'Content-Type': 'application/x-www-form-urlencoded'}))
        raw = self.op.open(req, timeout=ah.TIMEOUT).read()
        time.sleep(self.delay)
        return raw.decode('utf-8', 'replace')

    def post_json(self, url, body):
        self._consume()
        req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers=dict(
            self.headers, **{'Content-Type': 'application/json; charset=utf-8'}))
        raw = self.op.open(req, timeout=ah.TIMEOUT).read()
        time.sleep(self.delay)
        text = raw.decode('utf-8', 'replace')
        try:
            return json.loads(text)
        except ValueError as e:
            snippet = re.sub(r'\s+', ' ', text).strip()[:80]
            raise ValueError(u'%s（回應開頭：%s）' % (e, snippet or u'<空白>'))


class SitcaBudgetHttp(object):
    u"""投信投顧公會表單查詢用（帶 cookie、3 秒間隔、共享請求計數）。"""

    def __init__(self, counter, delay=t10.DELAY):
        self.counter = counter
        self.delay = delay
        self.op = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def open(self, url, form=None):
        data = urllib.parse.urlencode(form).encode('utf-8') if form else None
        req = urllib.request.Request(url, data=data, headers={
            'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8',
            'Content-Type': 'application/x-www-form-urlencoded'})
        for attempt in (1, 2, 3):
            if self.counter['count'] >= self.counter['limit']:
                raise BudgetExceeded(u'已達單輪請求上限 %d' % self.counter['limit'])
            self.counter['count'] += 1
            try:
                raw = self.op.open(req, timeout=120).read()
                time.sleep(self.delay)
                return raw.decode('utf-8', 'replace')
            except Exception as e:                            # noqa: BLE001
                if attempt == 3:
                    raise
                log(u'  公會第 %d 次失敗（%s），重試' % (attempt, str(e)[:40]))
                time.sleep(self.delay * attempt)


# ── 共用列正規化 ───────────────────────────────────────────────

def make_row(code, name, shares, weight, asset_type=None):
    c = str(code or '').strip()
    n = str(name or '').strip().rstrip('*').strip()
    sh = int(round(float(shares or 0)))
    w = round(float(weight or 0.0), 3)
    r = [c, n, sh, w]
    if asset_type:
        r.append(str(asset_type).strip())
    return r


def _is_future_name(name):
    s = str(name or '')
    return (u'期貨' in s) or (u'期指' in s)


def normalize_rows(rows):
    u"""合併同代號列、排除空代號與權重 <= 0，依權重由大到小排序。"""
    merged = {}
    for r in rows or []:
        if not r or len(r) < 4:
            continue
        code = str(r[0] or '').strip()
        name = str(r[1] or '').strip().rstrip('*').strip()
        sh = int(round(float(r[2] or 0)))
        w = float(r[3] or 0.0)
        atype = str(r[4]).strip() if len(r) >= 5 and r[4] else None
        if not code or not (w > 0):
            continue
        if code in merged:
            prev = merged[code]
            better_name = prev[1] if (prev[1] and (not name or len(prev[1]) <= len(name))) else name
            prev[1] = better_name
            prev[2] += sh
            prev[3] = round(prev[3] + w, 3)
            if atype and len(prev) < 5:
                prev.append(atype)
        else:
            merged[code] = make_row(code, name, sh, w, atype)
    out = list(merged.values())
    out.sort(key=lambda x: (-x[3], x[0]))
    return out


def _norm_date(v):
    s = str(v or '').strip()
    if not s:
        return None
    m = re.match(r'^(\d{4})[/-]?(\d{2})[/-]?(\d{2})', s)
    if m:
        return '%s-%s-%s' % m.groups()
    return None


def _num_positive(d, keys):
    if not isinstance(d, dict):
        return None
    low = dict((str(k).lower(), v) for k, v in d.items())
    for k in keys:
        if k in low and low[k] not in (None, ''):
            v = ah.num(low[k])
            if v > 0:
                return v
    return None


def _num_signed(d, keys):
    if not isinstance(d, dict):
        return None
    low = dict((str(k).lower(), v) for k, v in d.items())
    for k in keys:
        if k in low and low[k] not in (None, ''):
            raw = str(low[k]).replace(',', '').replace('%', '').strip()
            try:
                return float(raw)
            except ValueError:
                continue
    return None


# ── 各投信純解析函式（可供 unittest 用固定假資料直接測試） ────

def parse_capital(d):
    u"""解析群益 POST /CFWeb/api/etf/buyback 回應。"""
    body = d.get('data', d) if isinstance(d, dict) else {}
    if not isinstance(body, dict) or not body.get('stocks'):
        return None, []
    asof = _norm_date((body.get('pcf') or {}).get('date2'))
    rows = []
    for x in body.get('stocks') or []:
        rows.append(make_row(x.get('stocNo'), x.get('stocName'),
                             ah.num(x.get('share')), ah.num(x.get('weight'))))
    return asof, normalize_rows(rows)


def parse_fhtrust(d, fallback_day=None):
    u"""解析復華 GET /api/assets?fundID=&qDate= 回應。"""
    if not isinstance(d, dict):
        return None, []
    r = (d.get('result') or [None])[0]
    if not isinstance(r, dict) or not r.get('detail'):
        return None, []
    asof = _norm_date(r.get('dDate')) or _norm_date(fallback_day)
    rows = []
    for x in r.get('detail') or []:
        ftype = str(x.get('ftype') or '')
        if u'股票' not in ftype:
            continue
        rows.append(make_row(x.get('stockid'), x.get('stockname'),
                             ah.num(x.get('qshare')), ah.num(x.get('prate_addaccint'))))
    return asof, normalize_rows(rows)


def parse_yuanta(d, price_lookup=None):
    u"""解析元大 bridge FuncId=PCF/Daily 回應（含被動式 InKind 股數換算）。

    回傳 (asof, rows, basis, denom)：
    - 若 FundWeights.StockWeights 有值：直接用投信權重，basis='weight', denom=None。
    - 否則讀 InKind.FundComposition（每申購基數股數，無權重），以 price_lookup(code)
      取得當日收盤價換算市值，至少 85% 成分有報價才採信：
        1. 分母優先依 PCF 淨值候選（(totalav/osunit)*baseunit、nav*baseunit、
           stock_val+cash、totalav）檢查股票佔比是否落在 0.75～1.05，命中則 denom='nav'。
        2. 無法換算淨值時退回股票部位合計為 100%，標 denom='stock' 供前端註明。
    """
    body = (d.get('Data') or d) if isinstance(d, dict) else {}
    if not isinstance(body, dict):
        return None, [], None, None
    pcf = body.get('PCF') or {}
    asof = (_norm_date(pcf.get('trandate'))
            or _norm_date(pcf.get('navdate'))
            or _norm_date(pcf.get('date')))

    # 模式一：投信直接給權重（主動式或現金申購型）
    stocks = ((body.get('FundWeights') or {}).get('StockWeights') or [])
    if stocks:
        rows = [make_row(x.get('code') or x.get('stkcd'), x.get('name'),
                         ah.num(x.get('qty')), ah.num(x.get('weights')))
                for x in stocks if not _is_future_name(x.get('name'))]
        rows = normalize_rows(rows)
        if asof and rows:
            return asof, rows, 'weight', None

    # 模式二：被動式實物申購買回（InKind.FundComposition 只有每基數股數）
    inkind = body.get('InKind') or {}
    comp = inkind.get('FundComposition') if isinstance(inkind, dict) else None
    if not comp or not asof or price_lookup is None:
        return None, [], None, None

    # cashinlieu（現金替代）標記只代表 AP 可改交現金，qty 仍是成分股股數，不略過
    items = []
    for x in comp:
        code = str(x.get('stkcd') or x.get('code') or '').strip()
        name = str(x.get('name') or '').strip()
        qty = ah.num(x.get('qty'))
        if code and qty > 0 and not _is_future_name(name):
            items.append((code, name, qty))
    if not items:
        return None, [], None, None

    priced = []
    for code, name, qty in items:
        px = price_lookup(code)
        if px is not None and px > 0:
            priced.append((code, name, qty, qty * float(px)))
    # 至少 85% 成分找得到台股收盤價（避免海外 ETF 只靠台股報價算出殘缺權重）
    if len(priced) / float(len(items)) < 0.85:
        return None, [], None, None
    stock_val = sum(x[3] for x in priced)
    if not (stock_val > 0):
        return None, [], None, None

    denom_val, denom = _yuanta_denominator(pcf, body.get('Cash'), stock_val)
    rows = [make_row(code, name, qty, val / denom_val * 100.0) for code, name, qty, val in priced]
    return asof, normalize_rows(rows), 'qty', denom


def _yuanta_denominator(pcf, cash, stock_val):
    u"""嘗試從 PCF／Cash 推算每申購基數淨值；合理（股票佔比 75%～105%）就用 nav，否則退回 stock。"""
    totalav = _num_positive(pcf, ('totalav', 'totalnav', 'navtotal', 'aum', 'fundnav'))
    osunit = _num_positive(pcf, ('osunit', 'outunit', 'totalunit', 'units'))
    baseunit = _num_positive(pcf, ('baseunit', 'creationunit', 'unit', 'basketunit'))
    nav = _num_positive(pcf, ('nav', 'unitnav', 'navperunit'))

    cands = []
    if totalav and osunit and baseunit:
        cands.append((totalav / osunit) * baseunit)
    if nav and baseunit:
        cands.append(nav * baseunit)
    if isinstance(cash, dict):
        cash_val = _num_signed(cash, ('estcash', 'cashdiff', 'totalcash', 'cash', 'estimatedcash'))
        if cash_val is not None and (stock_val + cash_val) > 0:
            cands.append(stock_val + cash_val)
    if totalav:
        cands.append(totalav)

    for c in cands:
        if c > 0 and 0.75 <= (stock_val / c) <= 1.05:
            return c, 'nav'
    return stock_val, 'stock'


def parse_ezmoney(d):
    u"""解析統一 POST GetPCF 回應（只收股票 AssetCode == 'ST'）。"""
    if not isinstance(d, dict):
        return None, []
    pcf = d.get('pcf') or []
    if not pcf:
        return None, []
    asof = ah.Ezmoney.tran_date(pcf[0].get('TranDate'))
    rows = []
    for a in d.get('asset') or []:
        if a.get('AssetCode') != 'ST':
            continue
        for x in a.get('Details') or []:
            rows.append(make_row(x.get('DetailCode'), x.get('DetailName'),
                                 ah.num(x.get('Share')), ah.num(x.get('NavRate'))))
    return asof, normalize_rows(rows)


def parse_ctbc(d):
    u"""解析中信 POST etf/Buyback 回應（只收股票群組）。"""
    if not isinstance(d, dict):
        return None, []
    if d.get('ResultCode') not in (0, '0'):
        raise RuntimeError(u'中信回 %s' % d.get('ResultMsg'))
    data = d.get('Data') or {}
    head = (data.get('Data') or [None])[0]
    if not isinstance(head, dict):
        return None, []
    asof = _norm_date(head.get(u'每受益權單位淨資產價值DATE'))
    rows = []
    for grp in data.get('Detail') or []:
        if str(grp.get('Code') or '').upper() not in ('STOCK', 'STK', 'EQUITY'):
            continue
        for x in grp.get('Data') or []:
            rows.append(make_row(x.get('code_'), x.get('name_'),
                                 ah.num(x.get('qty_')), ah.num(x.get('weights_'))))
    return asof, normalize_rows(rows)


def parse_nomura(d):
    u"""解析野村 POST Fund/GetFundAssets 回應（排除期貨／債券／現金表）。"""
    data = ((d or {}).get('Entries') or {}).get('Data') or {}
    asof = _norm_date((data.get('FundAsset') or {}).get('NavDate'))
    rows = []
    for t in data.get('Table') or []:
        title = str(t.get('Title') or t.get('Name') or t.get('TableName') or '')
        if any(k in title for k in (u'期貨', u'債', u'現金', u'保證金', u'附買回')):
            continue
        for r in t.get('Rows') or []:
            if len(r) >= 4 and str(r[0]).strip() and ah.num(r[2]) > 0 and not _is_future_name(r[1]):
                rows.append(make_row(r[0], r[1], ah.num(r[2]), ah.num(r[3])))
    return (asof, normalize_rows(rows)) if asof else (None, [])


def parse_kgi_html(page):
    u"""解析凱基 POST /Fund/RedemptionVC 回傳的 HTML 片段。"""
    txt = ah.text_of(page)
    m = (re.search(r'\((\d{4})/(\d{2})/(\d{2})\)\s*每受益權單位淨資產價值', txt)
         or re.search(r'(\d{4})[/-](\d{2})[/-](\d{2})\s*每受益權單位淨資產價值', txt))
    rows = []
    for tr in re.findall(r'<tr.*?</tr>', page or '', re.S):
        c = [ah.text_of(td) for td in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
        if len(c) != 4:
            continue
        code, name, sh, w = c[0], c[1], ah.num(c[2]), ah.num(c[3])
        if not (sh > 0 and 0 < w <= 100) or _is_future_name(name):
            continue
        if (re.match(r'^[0-9A-Z]{4,6}$', code)
                or re.match(r'^[A-Z0-9][A-Z0-9./-]{0,11}\s+[A-Z]{2}$', code)
                or re.match(r'^[A-Z]{1,5}(?:\.[A-Z])?$', code)):
            rows.append(make_row(code, name, sh, w))
    if not m or not rows:
        return None, []
    return '%s-%s-%s' % m.groups(), normalize_rows(rows)


def parse_tsit_html(page):
    u"""解析台新 GET /ETF/Home/Pcf/{代號} 回傳的 HTML 頁（只收股票，排除期貨）。"""
    txt = ah.text_of(page)
    m = (re.search(r'(\d{4})[/-](\d{2})[/-](\d{2})\s*每基數實際申購總價金', txt)
         or re.search(r'(\d{4})[/-](\d{2})[/-](\d{2})\s*每受益權單位淨資產價值', txt))
    rows = []
    for tr in re.findall(r'<tr.*?</tr>', page or '', re.S):
        c = [ah.text_of(td) for td in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
        if len(c) != 4 or not (ah.num(c[2]) > 0):
            continue
        if re.match(r'^\d{6}$', c[1]) or _is_future_name(c[1]) or _is_future_name(c[0]):
            continue
        mm = re.match(r'^(\S+)\s+([A-Z]{2})$', c[0])
        if mm:
            code = mm.group(1) if mm.group(2) == 'TT' else c[0]
            rows.append(make_row(code, c[1], ah.num(c[2]), ah.num(c[3])))
        elif re.match(r'^\d{4,6}[A-Z]?$', c[0]):
            rows.append(make_row(c[0], c[1], ah.num(c[2]), ah.num(c[3])))
    if not m or not rows:
        return None, []
    return '%s-%s-%s' % m.groups(), normalize_rows(rows)


# ── 凱基下拉選單名稱比對 ───────────────────────────────────────

def _norm_kgi_name(name):
    s = t10.norm(name).replace(u'證券投資信託', '').replace(u'臺', u'台').upper()
    s = re.sub(r'(?:ETF基金|ETF|基金)$', '', s)
    return s


def _relax_kgi_name(name):
    s = _norm_kgi_name(name)
    if s.startswith(u'凱基'):
        s = s[2:]
    return s.replace(u'台灣', '').replace(u'優選', '')


def match_kgi_code(option_label, aliases_by_code):
    u"""將凱基下拉選單文字對應到證券代號（結合 etfs.json 簡稱與 top10.json 全名）。"""
    label = str(option_label or '').strip()
    if not label:
        return None
    m = re.search(r'\b(00\d{2,4}[A-Z]?)\b', label)
    if m and m.group(1) in aliases_by_code:
        return m.group(1)

    target_norm = _norm_kgi_name(label)
    if not target_norm:
        return None

    # 1. 完全正規化命中
    exact = [code for code, names in aliases_by_code.items()
             if any(_norm_kgi_name(n) == target_norm for n in names)]
    if len(exact) == 1:
        return exact[0]

    # 2. 去掉「凱基／台灣／優選」後的唯一命中（00915=高股息30、00938=30、00952=AI50、009816=TOP50）
    target_relax = _relax_kgi_name(label)
    if target_relax:
        relaxed = [code for code, names in aliases_by_code.items()
                   if any(_relax_kgi_name(n) == target_relax for n in names)]
        if len(relaxed) == 1:
            return relaxed[0]

    # 3. 唯一包含比對（較長別名優先）
    contained = []
    for code, names in aliases_by_code.items():
        best = 0
        for n in names:
            nn = _norm_kgi_name(n)
            if len(nn) >= 4 and (nn in target_norm or target_norm in nn):
                best = max(best, len(nn))
        if best:
            contained.append((best, code))
    if contained:
        contained.sort(reverse=True)
        if len(contained) == 1 or contained[0][0] > contained[1][0]:
            return contained[0][1]
    return None


# ── 公會季報 1% 以上（IN2630.aspx）純解析函式 ──────────────────

def parse_quarter(value, all_values=None):
    u"""將公會季別選項轉為標準 'YYYYQ#'（如 '2026Q3'）。無法辨識回 None。"""
    s = str(value or '').strip().upper()
    if not s:
        return None
    m = re.match(r'^(\d{4})[/-]?Q([1-4])$', s)
    if m:
        return '%sQ%s' % m.groups()
    m = re.match(r'^(\d{4})Q([1-4])$', s)
    if m:
        return '%sQ%s' % m.groups()
    m = re.match(r'^(\d{4})(\d{2})$', s)
    if m:
        yr, suffix = m.group(1), m.group(2)
        all_suffixes = set()
        for v in (all_values or []):
            mm = re.match(r'^\d{4}(\d{2})$', str(v or '').strip())
            if mm:
                all_suffixes.add(mm.group(1))
        # 若選項裡有 06/09/12 代表季底月份（03→Q1）；若只有 01..04 代表季序（03→Q3）
        month_mode = bool(all_suffixes & {'06', '09', '12'}) or suffix in ('06', '09', '12')
        if month_mode:
            qmap = {'03': '1', '06': '2', '09': '3', '12': '4'}
            return ('%sQ%s' % (yr, qmap[suffix])) if suffix in qmap else None
        if suffix in ('01', '02', '03', '04'):
            return '%sQ%d' % (yr, int(suffix))
    m = re.match(r'^(\d{4})([1-4])$', s)
    if m:
        return '%sQ%s' % m.groups()
    return None


def quarter_to_ym(q_label):
    u"""'2026Q3' -> '202609'（查公會 etf_info2 名稱對照用）。"""
    m = re.match(r'^(\d{4})Q([1-4])$', str(q_label or '').strip())
    if not m:
        return None
    return '%s%02d' % (m.group(1), int(m.group(2)) * 3)


def _extract_hidden_inputs(page):
    out = {}
    for tag in re.findall(r'<input\b[^>]*>', page or '', re.I):
        if not re.search(r'type=["\']hidden["\']', tag, re.I):
            continue
        nm = re.search(r'name=["\']([^"\']+)["\']', tag, re.I)
        if not nm:
            continue
        vm = re.search(r'value=["\']([^"\']*)["\']', tag, re.I)
        out[nm.group(1)] = htmllib.unescape(vm.group(1)) if vm else ''
    return out


def _extract_selects(page):
    u"""回傳 {select_name: [option_value, ...]}。"""
    out = {}
    for m in re.finditer(r'<select\b[^>]*name=["\']([^"\']+)["\'][^>]*>(.*?)</select>', page or '', re.S | re.I):
        vals = [htmllib.unescape(v).strip()
                for v in re.findall(r'<option\b[^>]*value=["\']([^"\']*)["\']', m.group(2), re.I)]
        out[m.group(1)] = [v for v in vals if v != '']
    return out


def extract_sitca_form(page):
    u"""解析 IN2630.aspx 表單：回傳 {'hidden', 'period_fields', 'quarter', 'ym', 'class_field', 'classes', 'submit'}。"""
    hidden = _extract_hidden_inputs(page)
    selects = _extract_selects(page)

    # 1. 找基金類型選單（AH／AL 開頭，同 IN2629）
    class_field, classes = None, []
    for name, vals in selects.items():
        etf_cls = [v for v in vals if v[:2] in ('AH', 'AL')]
        if etf_cls:
            class_field, classes = name, etf_cls
            break

    # 2. 找季別選單（單一欄位如 ddlQ_YM／ddlQ_YQ，或年＋季兩欄）
    period_fields = {}
    quarter = None
    best_single = None
    for name, vals in selects.items():
        if name == class_field:
            continue
        parsed = [(parse_quarter(v, vals), v) for v in vals]
        parsed = [(q, v) for q, v in parsed if q]
        if parsed:
            parsed.sort(key=lambda x: x[0])
            best_single = (name, parsed[-1][1], parsed[-1][0])
            if any(k in name.lower() for k in ('ym', 'yq', 'season', 'quarter', 'q_')):
                break
    if best_single:
        period_fields[best_single[0]] = best_single[1]
        quarter = best_single[2]
    else:
        year_sel = next(((n, [v for v in vs if re.match(r'^20\d{2}$', v)])
                         for n, vs in selects.items() if any(re.match(r'^20\d{2}$', v) for v in vs)), None)
        q_sel = next(((n, [v for v in vs if re.match(r'^(?:Q?[1-4]|0[1-4]|03|06|09|12)$', v, re.I)])
                      for n, vs in selects.items()
                      if n != (year_sel[0] if year_sel else None)
                      and n != class_field
                      and vs and all(re.match(r'^(?:Q?[1-4]|0[1-4]|03|06|09|12)$', v, re.I) for v in vs)), None)
        if year_sel and q_sel and year_sel[1] and q_sel[1]:
            yr = sorted(year_sel[1])[-1]
            qv = q_sel[1][-1]
            q_label = parse_quarter(yr + qv.lstrip('Qq').zfill(2), [yr + x.lstrip('Qq').zfill(2) for x in q_sel[1]])
            if q_label:
                period_fields[year_sel[0]] = yr
                period_fields[q_sel[0]] = qv
                quarter = q_label

    # 3. 找查詢按鈕與依類型單選欄位
    submit_name, submit_val = t10.P + 'BtnQuery', u'查詢'
    for tag in re.findall(r'<input\b[^>]*>', page or '', re.I):
        if re.search(r'type=["\']submit["\']', tag, re.I):
            nm = re.search(r'name=["\']([^"\']+)["\']', tag, re.I)
            vm = re.search(r'value=["\']([^"\']*)["\']', tag, re.I)
            if nm and (u'查詢' in (vm.group(1) if vm else '') or 'query' in nm.group(1).lower()):
                submit_name = nm.group(1)
                submit_val = htmllib.unescape(vm.group(1)) if vm else u'查詢'
                break

    rdo_name, rdo_val = t10.P + 'rdo1', 'rbClass'
    for tag in re.findall(r'<input\b[^>]*>', page or '', re.I):
        if re.search(r'type=["\']radio["\']', tag, re.I) and 'class' in tag.lower():
            nm = re.search(r'name=["\']([^"\']+)["\']', tag, re.I)
            vm = re.search(r'value=["\']([^"\']+)["\']', tag, re.I)
            if nm and vm:
                rdo_name, rdo_val = nm.group(1), vm.group(1)
                break

    return {
        'hidden': hidden,
        'period_fields': period_fields,
        'quarter': quarter,
        'ym': quarter_to_ym(quarter) if quarter else None,
        'class_field': class_field,
        'classes': classes,
        'rdo': (rdo_name, rdo_val),
        'submit': (submit_name, submit_val),
        'selects': list(selects.keys()),
    }


def parse_sitca_quarterly_table(page):
    u"""解析 IN2630.aspx 查詢結果表格 -> {基金名稱: [[代號, 名稱, 股數, 權重%, 類別?], ...]}。"""
    tables = re.findall(r'<table.*?</table>', page or '', re.S | re.I)
    if not tables:
        return {}
    # 找含「基金名稱」的最大表格
    target = next((tb for tb in sorted(tables, key=len, reverse=True) if u'基金名稱' in tb),
                  max(tables, key=len))
    trs = [t10.cells(tr) for tr in re.findall(r'<tr.*?</tr>', target, re.S | re.I)]
    trs = [c for c in trs if c]

    # 嘗試從表頭動態辨識欄序
    header = next((c for c in trs if any(u'基金名稱' in x for x in c) and len(c) >= 5), None)
    idx = {}
    if header:
        for i, h in enumerate(header):
            hs = h.replace(' ', '')
            if 'fund' not in idx and u'基金名稱' in hs:
                idx['fund'] = i
            elif 'type' not in idx and (u'標的種類' in hs or u'投資標的類別' in hs or u'類別' in hs or u'種類' in hs):
                idx['type'] = i
            elif 'code' not in idx and (u'標的代號' in hs or u'證券代號' in hs or u'股票代號' in hs or u'代號' in hs):
                idx['code'] = i
            elif 'name' not in idx and (u'標的名稱' in hs or u'證券名稱' in hs or u'股票名稱' in hs or u'名稱' in hs):
                idx['name'] = i
            elif 'share' not in idx and (u'股數' in hs or u'單位數' in hs or u'張數' in hs):
                idx['share'] = i
            elif 'pct' not in idx and (u'佔淨值' in hs or u'占淨值' in hs or u'淨資產' in hs or u'比率' in hs or u'比例' in hs or u'權重' in hs):
                idx['pct'] = i

    out, fund = {}, None
    use_header = header is not None and all(k in idx for k in ('fund', 'code', 'name', 'pct'))
    full_len = len(header) if header else 10

    for c in trs:
        if c == header or c[0] in (u'基金名稱', u'合計', u'小計', u'總計'):
            continue
        if use_header:
            if len(c) == full_len:
                if c[idx['fund']]:
                    fund = c[idx['fund']]
                row_cells = c
            elif len(c) == full_len - 1 and fund is not None and idx['fund'] == 0:
                row_cells = [fund] + c
            else:
                continue
            if not fund:
                continue
            code = row_cells[idx['code']].strip()
            name = row_cells[idx['name']].strip().rstrip('*')
            atype = row_cells[idx['type']].strip() if 'type' in idx else None
            sh = ah.num(row_cells[idx['share']]) if 'share' in idx else 0
            pct = ah.num(row_cells[idx['pct']])
            if code and pct > 0:
                out.setdefault(fund, []).append(make_row(code, name, sh, pct, atype))
        else:
            # 退回 IN2629 同構欄位：[基金名稱, 名次, 類別, 代號, 名稱, ..., 佔淨值%]
            if len(c) == 10:
                fund, c = c[0], c[1:]
            if fund is None or len(c) != 9 or not c[0].isdigit():
                continue
            pct = ah.num(c[8])
            if c[2] and pct > 0:
                out.setdefault(fund, []).append(make_row(c[2], c[3], ah.num(c[5]), pct, c[1]))

    return dict((k, normalize_rows(v)) for k, v in out.items() if v)


# ── 清單篩選、日期探測與合併邏輯 ───────────────────────────────

def load_etfs_catalog(path=ETFS_PATH):
    doc = json.load(io.open(path, encoding='utf-8'))
    return doc.get('etfs') or []


def load_top10_names(path=TOP10_PATH):
    if not os.path.exists(path):
        return {}
    try:
        doc = json.load(io.open(path, encoding='utf-8'))
        return dict((c, (v or {}).get('name') or '') for c, v in (doc.get('etfs') or {}).items())
    except Exception:                                         # noqa: BLE001
        return {}


def issuer_of_name(name):
    s = str(name or '')
    for kw, key in ah.ISSUER_BY_NAME:
        if kw in s:
            return key
    return None


def select_targets(etfs_list, prev_etfs=None, only=None, domestic_only=False,
                   today=None, force_foreign=False):
    u"""選出要抓 PCF 的被動式 ETF 清單，回傳 (domestic_list, foreign_list)。

    - 排除主動式（act=True 或代號結尾 A）、債券／槓反／期貨、雙幣別分級（K／C 結尾）。
    - 海外清單依「從未抓過 → 最久未更新」排序，預設略過近 FOREIGN_FRESH_DAYS 天內已更新者。
    """
    only_set = set(x.strip().lower() for x in only) if only else None
    today = today or datetime.now(TPE).date()
    prev_etfs = prev_etfs or {}
    domestic, foreign = [], []

    for e in etfs_list:
        code = str(e.get('code') or '').strip()
        name = str(e.get('name') or code).strip()
        sec = e.get('sec') or ''
        if sec not in ('cat-domestic', 'cat-foreign'):
            continue
        if e.get('act') or code.endswith('A') or re.search(r'[KC]$', code):
            continue
        issuer = issuer_of_name(name)
        if not issuer:
            continue
        if only_set and (issuer not in only_set and code.lower() not in only_set):
            continue
        item = {'code': code, 'name': name, 'sec': sec, 'issuer': issuer}
        if sec == 'cat-domestic':
            domestic.append(item)
        elif not domestic_only:
            prev = prev_etfs.get(code)
            prev_asof = prev.get('asof') if (prev and prev.get('basis') != 'quarterly1pct') else None
            if not force_foreign and prev_asof and re.match(r'^\d{4}-\d{2}-\d{2}$', prev_asof):
                try:
                    age = (today - date.fromisoformat(prev_asof)).days
                    if age < FOREIGN_FRESH_DAYS:
                        continue
                except ValueError:
                    pass
            item['prev_asof'] = prev_asof or ''
            foreign.append(item)

    order_rank = dict((k, i) for i, k in enumerate(ISSUER_ORDER))
    domestic.sort(key=lambda x: (order_rank.get(x['issuer'], 99), x['code']))
    foreign.sort(key=lambda x: (x.get('prev_asof') or '', order_rank.get(x['issuer'], 99), x['code']))
    return domestic, foreign


def next_weekday(d):
    u"""回傳 d 之後的下一個週一～週五（週五 -> 下週一）。"""
    nxt = d + timedelta(days=1)
    while nxt.weekday() >= 5:
        nxt += timedelta(days=1)
    return nxt


def weekdays_between(older_iso, newer_iso):
    u"""計算 older_iso（不含）到 newer_iso（含）之間的工作日（週一～週五）數。"""
    try:
        a = date.fromisoformat(str(older_iso or ''))
        b = date.fromisoformat(str(newer_iso or ''))
    except ValueError:
        return 0
    if b <= a:
        return 0
    cnt = 0
    cur = a + timedelta(days=1)
    while cur <= b:
        if cur.weekday() < 5:
            cnt += 1
        cur += timedelta(days=1)
    return cnt


def build_probe_days(issuer, anchor, weekdays, skip_dates=None):
    u"""為單一 ETF 產生獨立的查詢日期清單（每檔皆從最近交易日重新開始，絕不受前一檔回傳的 asof 影響）。

    - 元大／中信的日期參數是「公告日／申購交易日」（對應前一交易日收盤持股），故從 next_weekday(anchor)
      起試，查不到才退回 anchor 與更前一個工作日。
    - 復華／野村的日期參數即持股交易日，直接從 anchor 往回試。
    - skip_dates 只放同一批次已實測回傳空白的查詢日（絕不放成功的日期），避免重複打無資料日。
    """
    skip = set(skip_dates or ())
    cands = []
    if issuer in ANNOUNCEMENT_DATE_ISSUERS:
        cands.append(next_weekday(anchor))
    if anchor not in cands:
        cands.append(anchor)
    for wd in weekdays:
        if wd not in cands:
            cands.append(wd)
    filtered = [d for d in cands if d not in skip]
    return (filtered or cands)[:3]


def ezmoney_payload(fid, anchor_day):
    u"""組裝統一 GetPCF 請求體（與 fetch_active_holdings.Ezmoney.fetch 一致，必帶有效民國公告日）。"""
    post = next_weekday(anchor_day)
    roc = '%d/%02d/%02d' % (post.year - 1911, post.month, post.day)
    return {'fundCode': fid, 'date': roc, 'specificDate': False}


def merge_entry(prev_entry, new_entry, ref_asof=None, max_stale_days=MAX_STALE_TRADING_DAYS):
    u"""合併單檔新舊資料：新抓失敗或過舊（早於最近交易日超過 5 個交易日）保留舊版；不用舊日期蓋新日期。"""
    if not new_entry or not new_entry.get('holdings'):
        return prev_entry
    if (ref_asof and new_entry.get('basis') != 'quarterly1pct'
            and weekdays_between(new_entry.get('asof'), ref_asof) > max_stale_days):
        return prev_entry
    if not prev_entry:
        return new_entry
    # PCF 永遠優先於季報；季報不覆蓋已有 PCF
    if prev_entry.get('basis') != 'quarterly1pct' and new_entry.get('basis') == 'quarterly1pct':
        return prev_entry
    if prev_entry.get('basis') == 'quarterly1pct' and new_entry.get('basis') != 'quarterly1pct':
        return new_entry
    if str(new_entry.get('asof') or '') < str(prev_entry.get('asof') or ''):
        return prev_entry
    return new_entry


def recent_weekdays(n=5, today=None):
    u"""從今天往回取 n 個週一～週五（由新到舊）。"""
    d = today or datetime.now(TPE).date()
    out = []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return out


# ── 各投信抓取封裝 ─────────────────────────────────────────────

def resolve_passive_ids(http, ctbc_http, needed_issuers, kgi_aliases, ctbc_client_box):
    u"""只對本輪需要查內部代碼的投信抓基金清單，節省請求數。"""
    out = {}
    if 'capital' in needed_issuers:
        try:
            d = http.post_json(ah.Capital.BASE + 'items', None)
            for f in (d.get('data') if isinstance(d, dict) else d) or []:
                c = (f.get('stockNo') or '').strip()
                if c and f.get('fundNo') is not None:
                    out[c] = ('capital', f.get('fundNo'))
        except BudgetExceeded:
            raise
        except Exception as e:                                # noqa: BLE001
            note(u'群益基金清單：%s' % str(e)[:60])

    if 'ezmoney' in needed_issuers:
        try:
            page = http.get(ah.Ezmoney.BASE + 'PCF').decode('utf-8', 'replace')
            m = re.search(r'id="DataFundList" data-content="([^"]+)"', page)
            for f in json.loads(htmllib.unescape(m.group(1))) if m else []:
                c = (f.get('sStockNo') or '').strip()
                if c and f.get('sFundCode'):
                    out[c] = ('ezmoney', f.get('sFundCode'))
        except BudgetExceeded:
            raise
        except Exception as e:                                # noqa: BLE001
            note(u'統一基金清單：%s' % str(e)[:60])

    if 'fhtrust' in needed_issuers:
        try:
            raw = http.get('https://www.fhtrust.com.tw/api/fundList?ec001=3').decode('utf-8')
            for f in json.loads(raw).get('result') or []:
                c = (f.get('etf002') or '').strip()
                if c and f.get('fundID'):
                    out[c] = ('fhtrust', f.get('fundID'))
        except BudgetExceeded:
            raise
        except Exception as e:                                # noqa: BLE001
            note(u'復華基金清單：%s' % str(e)[:60])

    if 'kgi' in needed_issuers:
        try:
            for label, fid in ah.Kgi(http).ids().items():
                code = match_kgi_code(label, kgi_aliases)
                if code:
                    out[code] = ('kgi', fid)
        except BudgetExceeded:
            raise
        except Exception as e:                                # noqa: BLE001
            note(u'凱基基金清單：%s' % str(e)[:60])

    if 'ctbc' in needed_issuers:
        try:
            c = ah.Ctbc(ctbc_http)
            c.token = (c.post('home/AuthToken').get('Data') or {}).get('token')
            ctbc_client_box['client'] = c
            for f in ((c.post('etf/ETFCNOList').get('Data') or {}).get('List') or []):
                code = (f.get('ETF_ID') or '').strip()
                if code and f.get('FID'):
                    out[code] = ('ctbc', f.get('FID'))
        except BudgetExceeded:
            raise
        except Exception as e:                                # noqa: BLE001
            note(u'中信基金清單：%s' % str(e)[:60])
            ctbc_client_box['blocked'] = True

    return out


class PriceBook(object):
    u"""快取同一交易日的上市櫃收盤價，供元大全部被動式 ETF 共用（每日最多向交易所查一次）。"""

    def __init__(self):
        self.by_day = {}

    def lookup_for(self, day):
        if day not in self.by_day:
            self.by_day[day] = ah.day_prices(day) or {}
        day_map = self.by_day[day]

        def get_px(code):
            v = day_map.get(code)
            if not v:
                return None
            return v[1] if (len(v) > 1 and v[1]) else v[0]

        return get_px

    def has_prices(self, day):
        return bool(self.by_day.get(day))


def _fetch_one_pcf(issuer, fid, code, http, ctbc_client_box, probe_days, anchor_day, price_book):
    u"""抓取單一被動式 ETF 最新 PCF，回傳 (asof, rows, basis, denom, empty_days)。"""
    empty_days = []
    if issuer == 'capital':
        d = http.post_json(ah.Capital.BASE + 'buyback', {'fundId': fid, 'date': None})
        asof, rows = parse_capital(d)
        return (asof, rows, 'weight', None, empty_days) if (asof and rows) else (None, [], None, None, empty_days)

    if issuer == 'ezmoney':
        # 統一 GetPCF 即使 specificDate=False 仍會驗證 date 格式，必帶有效民國日期（空字串會回 HTML 錯誤頁）
        d = http.post_json(ah.Ezmoney.BASE + 'GetPCF', ezmoney_payload(fid, anchor_day))
        asof, rows = parse_ezmoney(d)
        if not (asof and rows):
            roc = '%d/%02d/%02d' % (anchor_day.year - 1911, anchor_day.month, anchor_day.day)
            d = http.post_json(ah.Ezmoney.BASE + 'GetPCF',
                               {'fundCode': fid, 'date': roc, 'specificDate': True})
            asof, rows = parse_ezmoney(d)
        return (asof, rows, 'weight', None, empty_days) if (asof and rows) else (None, [], None, None, empty_days)

    if issuer == 'kgi':
        page = http.post_form(ah.Kgi.URL, {'fundID': fid})
        asof, rows = parse_kgi_html(page)
        return (asof, rows, 'weight', None, empty_days) if (asof and rows) else (None, [], None, None, empty_days)

    if issuer == 'tsit':
        page = http.get(ah.Tsit.URL + code + '?FundType=ALL').decode('utf-8', 'replace')
        asof, rows = parse_tsit_html(page)
        return (asof, rows, 'weight', None, empty_days) if (asof and rows) else (None, [], None, None, empty_days)

    if issuer == 'fhtrust':
        for day in probe_days:
            q = urllib.parse.urlencode({'fundID': fid, 'qDate': day.strftime('%Y/%m/%d')})
            d = json.loads(http.get(ah.Fhtrust.URL + q).decode('utf-8'))
            asof, rows = parse_fhtrust(d, fallback_day=day.isoformat())
            if asof and rows:
                return asof, rows, 'weight', None, empty_days
            empty_days.append(day)
        return None, [], None, None, empty_days

    if issuer == 'yuanta':
        for day in probe_days:
            q = urllib.parse.urlencode({
                'APIType': 'ETFAPI', 'CompanyName': 'YUANTAFUNDS', 'PageName': '/tradeInfo/pcf/' + code,
                'DeviceId': 'null', 'FuncId': 'PCF/Daily', 'AppName': 'ETF', 'Device': '3',
                'Platform': 'ETF', 'ticker': code, 'date': day.strftime('%Y%m%d')})
            d = json.loads(http.get(ah.Yuanta.URL + q).decode('utf-8'))
            body = (d.get('Data') or d) if isinstance(d, dict) else {}
            pcf = (body or {}).get('PCF') or {}
            cand_asof = (_norm_date(pcf.get('trandate'))
                         or _norm_date(pcf.get('navdate'))
                         or _norm_date(pcf.get('date')))
            if not cand_asof:
                empty_days.append(day)
                continue
            has_weights = bool(((body.get('FundWeights') or {}).get('StockWeights')))
            px_fn = None if has_weights else price_book.lookup_for(cand_asof)
            asof, rows, basis, denom = parse_yuanta(d, price_lookup=px_fn)
            if asof and rows:
                return asof, rows, basis, denom, empty_days
            # 有拿到該日 InKind 且台股報價已載入仍對不到（海外 ETF），不必再回頭試前一天
            if ((body.get('InKind') or {}).get('FundComposition')) and price_book.has_prices(cand_asof):
                return None, [], None, None, empty_days
            empty_days.append(day)
        return None, [], None, None, empty_days

    if issuer == 'nomura':
        for day in probe_days:
            d = http.post_json(ah.Nomura.URL, {'FundID': code, 'SearchDate': day.isoformat()})
            asof, rows = parse_nomura(d)
            if asof and rows:
                return asof, rows, 'weight', None, empty_days
            empty_days.append(day)
        return None, [], None, None, empty_days

    if issuer == 'ctbc':
        if ctbc_client_box.get('blocked'):
            raise CtbcBlocked(u'中信已熔斷')
        client = ctbc_client_box.get('client')
        if not client:
            client = ah.Ctbc(ctbc_client_box['http'])
            try:
                client.token = (client.post('home/AuthToken').get('Data') or {}).get('token')
            except Exception as e:                            # noqa: BLE001
                ctbc_client_box['blocked'] = True
                raise CtbcBlocked(str(e)[:60])
            ctbc_client_box['client'] = client
        for day in probe_days:
            try:
                d = client.post('etf/Buyback', {'FID': fid, 'StartDate': day.isoformat()})
            except urllib.error.HTTPError as e:
                if e.code in (302, 403, 429):
                    ctbc_client_box['blocked'] = True
                    raise CtbcBlocked(u'HTTP %d' % e.code)
                raise
            except ValueError as e:
                # Incapsula 回傳 HTML 驗證頁會導致 JSONDecodeError，立即熔斷不重打
                ctbc_client_box['blocked'] = True
                raise CtbcBlocked(u'非 JSON 回應（%s）' % str(e)[:40])
            asof, rows = parse_ctbc(d)
            if asof and rows:
                return asof, rows, 'weight', None, empty_days
            empty_days.append(day)
        return None, [], None, None, empty_days

    return None, [], None, None, empty_days


# ── 公會季報 1% 以上抓取 ───────────────────────────────────────

def fetch_sitca_quarterly(sitca_http, prev_meta, prev_etfs, force=False):
    u"""抓公會 IN2630 季報持股 1% 以上。

    回傳 (quarter_label, {code: entry}, updated_flag)。
    若最新季別未變且舊檔已有季報，只發 1 個 GET 就直接沿用舊資料。
    """
    first = sitca_http.open(SITCA_QUARTERLY)
    info = extract_sitca_form(first)
    q = info.get('quarter')
    if not q or not info.get('class_field') or not info.get('classes'):
        note(u'公會季報 IN2630 表單看不懂（selects=%s），略過並保留前版' % ','.join(info.get('selects') or []))
        return prev_meta.get('quarterlyAsof'), {}, False

    has_prev_q = any(v.get('basis') == 'quarterly1pct' for v in prev_etfs.values())
    if not force and prev_meta.get('quarterlyAsof') == q and has_prev_q:
        log(u'公會季報最新仍是 %s，沿用既有資料（1 GET）' % q)
        return q, {}, False

    ym = info.get('ym')
    log(u'公會季報 %s（ym=%s）：查詢 %d 個 ETF 類型' % (q, ym, len(info['classes'])))
    mapping = t10.name_to_code(sitca_http, ym) if ym else {}
    etf_names = ah.load_names()
    out = {}
    for cls in info['classes']:
        form = dict(info['hidden'])
        form.update(info['period_fields'])
        form[info['rdo'][0]] = info['rdo'][1]
        form[info['class_field']] = cls
        form[info['submit'][0]] = info['submit'][1]
        try:
            page = sitca_http.open(SITCA_QUARTERLY, form)
        except BudgetExceeded:
            note(u'公會季報查詢類型 %s 時達請求上限，保留已抓部分' % cls)
            break
        except Exception as e:                                # noqa: BLE001
            note(u'公會季報類型 %s：%s' % (cls, str(e)[:60]))
            continue
        got = parse_sitca_quarterly_table(page)
        for fund, rows in got.items():
            code = next((mapping[k] for k in t10.keys(fund) if k in mapping), None)
            if not code or not rows:
                continue
            out[code] = {
                'name': etf_names.get(code) or fund,
                'asof': q,
                'src': SITCA_SRC,
                'basis': 'quarterly1pct',
                'holdings': rows,
            }
        log(u'  公會季報 %s：%d 檔' % (cls, len(got)))
    return q, out, bool(out)


# ── 主流程 ─────────────────────────────────────────────────────

def main(argv=None):
    _ensure_utf8_stdio()
    ap = argparse.ArgumentParser(description=u'抓取被動式 ETF 全部持股（投信 PCF＋公會季報 1% 以上）')
    ap.add_argument('--out', default=OUT, help=u'輸出 JSON 路徑')
    ap.add_argument('--only', default='', help=u'只抓指定投信或代號，逗號分隔（例 capital,fhtrust,yuanta 或 0050,00919）')
    ap.add_argument('--domestic-only', action='store_true', help=u'只抓台股 ETF（略過海外）')
    ap.add_argument('--no-sitca', action='store_true', help=u'略過公會季報 IN2630')
    ap.add_argument('--sitca-only', action='store_true', help=u'只抓公會季報 IN2630')
    ap.add_argument('--force-sitca', action='store_true', help=u'無視季別相同，強制重抓公會季報')
    ap.add_argument('--force-foreign', action='store_true', help=u'無視 5 天新鮮期，強制輪替海外 ETF')
    ap.add_argument('--max-requests', type=int, default=DEFAULT_MAX_REQUESTS, help=u'單輪最大 HTTP 請求數')
    args = ap.parse_args(argv)

    prev_doc = {}
    if os.path.exists(args.out):
        try:
            prev_doc = json.load(io.open(args.out, encoding='utf-8'))
        except Exception as e:                                # noqa: BLE001
            note(u'既有 etf_holdings.json 讀不起來（%s），本次重建' % str(e)[:60])
    prev_meta = prev_doc.get('meta') or {}
    etfs_out = dict(prev_doc.get('etfs') or {})

    counter = {'count': 0, 'limit': max(1, args.max_requests)}
    http = BudgetHttp(counter, cookies=True, delay=ah.DELAY)
    ctbc_http = BudgetHttp(counter, cookies=False, delay=CTBC_DELAY)
    ctbc_box = {'http': ctbc_http, 'client': None, 'blocked': False}
    sitca_http = SitcaBudgetHttp(counter)
    price_book = PriceBook()

    only = [x.strip() for x in args.only.split(',') if x.strip()] if args.only else None
    etfs_catalog = load_etfs_catalog()
    top10_names = load_top10_names()

    ids = dict((k, tuple(v)) for k, v in (prev_meta.get('ids') or {}).items())
    issuer_ok = {}
    issuer_total = {}
    latest_asof_seen = None
    empty_query_dates = {}
    ctbc_used = 0

    if not args.sitca_only:
        domestic, foreign = select_targets(
            etfs_catalog, prev_etfs=etfs_out, only=only,
            domestic_only=args.domestic_only, force_foreign=args.force_foreign)
        all_targets = domestic + foreign
        # 已有完整快取內部代碼的投信不重查清單（減量並降低中信請求次數）；統一每次必進 PCF 頁拿 cookie
        needed = set(
            x['issuer'] for x in all_targets
            if x['issuer'] in ID_LIST_ISSUERS
            and (x['issuer'] == 'ezmoney' or x['code'] not in ids or ids[x['code']][0] != x['issuer'])
        )
        kgi_aliases = {}
        for e in etfs_catalog:
            c = e.get('code') or ''
            if issuer_of_name(e.get('name')) == 'kgi':
                kgi_aliases[c] = [e.get('name') or '']
                if top10_names.get(c):
                    kgi_aliases[c].append(top10_names[c])

        if needed:
            try:
                ids.update(resolve_passive_ids(http, ctbc_http, needed, kgi_aliases, ctbc_box))
            except BudgetExceeded as e:
                note(str(e))

        weekdays = recent_weekdays(5)
        # 基準最近工作日全程固定，每檔 ETF 皆由此獨立探測，避免日期在不同 ETF 之間連鎖倒退
        anchor = weekdays[0]

        def run_batch(items, label):
            nonlocal latest_asof_seen, ctbc_used
            for it in items:
                code, name, issuer, sec = it['code'], it['name'], it['issuer'], it['sec']
                if issuer in DIRECT_CODE_ISSUERS:
                    fid = code
                else:
                    pair = ids.get(code)
                    if not pair or pair[0] != issuer:
                        note(u'%s（%s）：找不到網站內部代碼，保留前版' % (code, ah.ISSUER_NAME[issuer]))
                        issuer_total[issuer] = issuer_total.get(issuer, 0) + 1
                        continue
                    fid = pair[1]

                if issuer == 'ctbc':
                    if ctbc_box.get('blocked') or ctbc_used >= CTBC_MAX_PER_RUN:
                        continue
                    ctbc_used += 1

                issuer_total[issuer] = issuer_total.get(issuer, 0) + 1
                skip_key = (issuer, sec)
                probe = build_probe_days(issuer, anchor, weekdays, skip_dates=empty_query_dates.get(skip_key))

                try:
                    asof, rows, basis, denom, empty_days = _fetch_one_pcf(
                        issuer, fid, code, http, ctbc_box, probe, anchor, price_book)
                except BudgetExceeded:
                    log(u'  已達請求上限 %d，停止 %s 批次' % (counter['limit'], label))
                    break
                except CtbcBlocked as e:
                    note(u'中信熔斷（%s），其餘中信 ETF 保留前版' % str(e)[:60])
                    continue
                except Exception as e:                        # noqa: BLE001
                    note(u'%s（%s）：%s' % (code, ah.ISSUER_NAME[issuer], str(e)[:120]))
                    continue

                if empty_days and asof:
                    empty_query_dates.setdefault(skip_key, set()).update(empty_days)

                if not asof or not rows:
                    note(u'%s（%s）：查無持股，保留前版' % (code, ah.ISSUER_NAME[issuer]))
                    continue

                ref_asof = latest_asof_seen or anchor.isoformat()
                lag = weekdays_between(asof, ref_asof)
                if lag > MAX_STALE_TRADING_DAYS:
                    note(u'%s（%s）：抓到過舊日期 %s（早於 %s 達 %d 個交易日），改沿用前版' % (
                        code, ah.ISSUER_NAME[issuer], asof, ref_asof, lag))
                    continue

                entry = {
                    'name': name,
                    'asof': asof,
                    'src': ah.ISSUER_NAME[issuer],
                    'basis': basis,
                    'holdings': rows,
                }
                if denom:
                    entry['denom'] = denom
                etfs_out[code] = merge_entry(etfs_out.get(code), entry, ref_asof=ref_asof)
                issuer_ok[issuer] = issuer_ok.get(issuer, 0) + 1
                if latest_asof_seen is None or asof > latest_asof_seen:
                    latest_asof_seen = asof
                tot_w = sum(r[3] for r in rows)
                log(u'  %s %-14s %s %3d 檔 合計 %5.1f%%（%s%s）' % (
                    code, name[:12], asof, len(rows), tot_w, basis,
                    '/' + denom if denom else ''))

        log(u'=== 台股被動式 ETF（%d 檔）===' % len(domestic))
        run_batch(domestic, u'台股')

        # 公會季報擺在台股 PCF 後、海外輪替前：確保每季更新一次時預算充足
        quarterly_asof = prev_meta.get('quarterlyAsof')
        if not args.no_sitca:
            try:
                quarterly_asof, q_entries, _ = fetch_sitca_quarterly(
                    sitca_http, prev_meta, etfs_out, force=args.force_sitca)
                for code, entry in q_entries.items():
                    etfs_out[code] = merge_entry(etfs_out.get(code), entry)
            except BudgetExceeded as e:
                note(u'公會季報：%s' % str(e))
            except Exception as e:                            # noqa: BLE001
                note(u'公會季報失敗（保留前版）：%s' % str(e)[:80])

        if foreign and counter['count'] < counter['limit']:
            log(u'=== 海外被動式 ETF 輪替（候選 %d 檔，剩餘額度 %d）===' % (
                len(foreign), counter['limit'] - counter['count']))
            run_batch(foreign, u'海外')
    else:
        quarterly_asof = prev_meta.get('quarterlyAsof')
        try:
            quarterly_asof, q_entries, _ = fetch_sitca_quarterly(
                sitca_http, prev_meta, etfs_out, force=args.force_sitca)
            for code, entry in q_entries.items():
                etfs_out[code] = merge_entry(etfs_out.get(code), entry)
        except Exception as e:                                # noqa: BLE001
            note(u'公會季報失敗：%s' % str(e)[:80])

    # 印出各家成功檔數
    if issuer_total:
        summary_parts = [u'%s %d/%d' % (ah.ISSUER_NAME[k], issuer_ok.get(k, 0), issuer_total[k])
                         for k in ISSUER_ORDER if k in issuer_total]
        log(u'各家成功：%s' % u'、'.join(summary_parts))

    pcf_count = sum(1 for v in etfs_out.values() if v.get('basis') != 'quarterly1pct')
    q_count = sum(1 for v in etfs_out.values() if v.get('basis') == 'quarterly1pct')

    payload = {
        'meta': {
            'updated': datetime.now(TPE).date().isoformat(),
            'counts': dict((k, issuer_ok.get(k, 0)) for k in ISSUER_ORDER if k in issuer_total),
            'pcfCount': pcf_count,
            'quarterlyCount': q_count,
            'quarterlyAsof': quarterly_asof,
            'requests': counter['count'],
            'ids': dict((c, list(v)) for c, v in sorted(ids.items())),
            'source': u'各投信官網每日申購買回清單（群益、復華、元大、統一、凱基、中信、野村、台新）與投信投顧公會季報（持股 1% 以上）',
            'errors': ERRORS,
        },
        'etfs': dict(sorted(etfs_out.items())),
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with io.open(args.out, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    log(u'完成：%s（PCF %d 檔、季報 %d 檔、請求 %d 次、%.0f KB）' % (
        args.out, pcf_count, q_count, counter['count'], os.path.getsize(args.out) / 1024.0))
    return 0 if etfs_out else 1


if __name__ == '__main__':
    sys.exit(main())
