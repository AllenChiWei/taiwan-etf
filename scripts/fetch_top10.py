# -*- coding: utf-8 -*-
u"""每檔 ETF 的前十大持股（月報），來源是投信投顧公會。

    python scripts/fetch_top10.py [--force]

寫到 app/public/data/top10.json，**進版控**。公會一個月更新一次，所以每次先看最新
月份有沒有變，沒變就不重抓（一個 GET）；變了才查十幾個類型（每個約 600 KB）。

## 為什麼是公會，不是各投信

各投信的 PCF 要一家一家接（二十幾家），而國泰、富邦的網站擋程式。公會的
「基金投資明細－月前十大」（IN2629.aspx?pid=IN22601_04）是所有投信申報的彙整，
上市上櫃、每一家都有，一個類型一個請求。代價是**月報**：資料是上個月底的持股，
大約每月 10 號以後才出來。主動式換股那六檔另有每日持股（active_holdings.json），
前端會優先用那份。

公會沒有 robots.txt（回 404 頁）。查詢是一般的 ASP.NET 表單送出（先 GET 拿
__VIEWSTATE，再 POST），跟在瀏覽器按「查詢」一樣。

## 基金名稱 -> 證券代號

前十大的表格只有基金全名（「兆豐臺灣藍籌30ETF基金」）。公會自己的 ETF 基本資料
（etf_info2.aspx?txtYM=）有「證券代號／基金名稱」對照，上市上櫃都有、寫法跟前十大
一致，一個請求。證交所 t187ap47_L 也有全名，但只有上市、而且名稱多了「證券投資信託」。

## 產出

    {"meta": {"ym": "202608", ...},
     "etfs": {"0050": {"name": "元大台灣卓越50…", "rows": [[名次, 類別, 代號, 名稱, 佔淨值%], ...]}}}
"""
import html as htmllib
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import http.cookiejar
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'top10.json')

TPE = timezone(timedelta(hours=8))
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; +https://allenchiwei.github.io/taiwan-etf/) '
      'ETF top-10 holdings (monthly)')
TOP10 = 'https://www.sitca.org.tw/ROC/Industry/IN2629.aspx?pid=IN22601_04'
INFO = 'https://www.sitca.org.tw/ROC/SITCA_ETF/etf_info2.aspx?txtYM=%s&txtR1=0'
DELAY = 3.0
P = 'ctl00$ContentPlaceHolder1$'

ERRORS = []


def log(m):
    print(m, flush=True)


def note(m):
    log(u'  ⚠ %s' % m)
    ERRORS.append(m)


class Http(object):
    def __init__(self):
        self.op = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def open(self, url, form=None):
        data = urllib.parse.urlencode(form).encode() if form else None
        req = urllib.request.Request(url, data=data, headers={
            'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8',
            'Content-Type': 'application/x-www-form-urlencoded'})
        for attempt in (1, 2, 3):
            try:
                raw = self.op.open(req, timeout=120).read()
                time.sleep(DELAY)
                return raw.decode('utf-8', 'replace')
            except Exception as e:                            # noqa: BLE001
                if attempt == 3:
                    raise
                log(u'  第 %d 次失敗（%s），重試' % (attempt, str(e)[:40]))
                time.sleep(DELAY * attempt)


def cells(tr):
    return [re.sub(r'\s+', ' ', htmllib.unescape(re.sub(r'<[^>]+>', '', c))).strip()
            for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', tr, re.S)]


def options(page, name):
    m = re.search(r'<select[^>]*name="%s"[^>]*>(.*?)</select>' % re.escape(P + name), page, re.S)
    return re.findall(r'<option[^>]*value="([^"]*)"', m.group(1)) if m else []


def norm(name):
    u"""基金名稱比對用：去掉空白、全半形差異，以及後面掛的法定警語。

    前十大那邊的名稱常帶「(本基金之配息來源可能為收益平準金且並無保證收益及配息)」，
    基本資料那邊沒有 —— 第一版沒去掉，340 檔裡有 162 檔對不到代號。
    """
    s = re.sub(r'\s+', '', name or '').replace(u'（', '(').replace(u'）', ')')
    # 也有「(本基金非屬環境、社會及治理相關主題基金)」「(本基金採匯率避險)」這類
    return re.sub(u'\\([^()]*(?:配息|收益平準金|保證|本基金|基金之)[^()]*\\)', '', s)


def keys(name):
    u"""一個基金名稱的比對鍵：全名，以及傘型基金「…傘型基金之」後面的子基金名。"""
    n = norm(name).replace(u'證券投資信託', '')
    out = [n]
    if u'之' in n:
        out.append(n.split(u'之', 1)[1])
    return out


def name_to_code(http, ym):
    u"""{比對鍵: 證券代號}。

    主要是公會 ETF 基本資料那一月的對照表（上市上櫃都有）；那個月才成立的新基金
    它還沒收，所以再用證交所 t187ap47_L（只有上市，全名多了「證券投資信託」）補。
    """
    out = {}
    try:
        raw = urllib.request.urlopen(urllib.request.Request(
            'https://openapi.twse.com.tw/v1/opendata/t187ap47_L',
            headers={'User-Agent': UA}), timeout=60).read()
        for r in json.loads(raw.decode('utf-8')):
            for k in keys(r.get(u'基金中文名稱')):
                out[k] = r.get(u'基金代號')
    except Exception as e:                                    # noqa: BLE001
        note(u'證交所基金基本資料：%s' % str(e)[:60])
    page = http.open(INFO % ym)
    for tr in re.findall(r'<tr.*?</tr>', page, re.S):
        c = cells(tr)
        if len(c) >= 6 and re.match(r'^00\d{2,4}[A-Z]?$', c[3]):
            for k in keys(c[5]):
                out[k] = c[3]                               # 公會的對照優先
    return out


def query_class(http, first, ym, cls):
    u"""某個類型的前十大 -> {基金名稱: [[名次, 類別, 代號, 名稱, 佔淨值%], ...]}。"""
    form = dict((k, htmllib.unescape(v)) for k, v in re.findall(
        r'<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"', first))
    form.update({
        P + 'ddlQ_YM': ym, P + 'rdo1': 'rbClass', P + 'ddlQ_Class': cls,
        P + 'ddlQ_Comid': 'A0005', P + 'ddlQ_Comid1': 'A0005', P + 'ddlQ_Class1': '',
        P + 'BtnQuery': u'查詢',
    })
    page = http.open(TOP10, form)
    tables = re.findall(r'<table.*?</table>', page, re.S)
    if not tables:
        return {}
    out, fund = {}, None
    for tr in re.findall(r'<tr.*?</tr>', max(tables, key=len), re.S):
        c = cells(tr)
        if not c or c[0] in (u'基金名稱', u'合計'):
            continue
        if len(c) == 10:                    # 每檔的第一列：基金名稱 + 第 1 名
            fund, c = c[0], c[1:]
        if fund is None or len(c) != 9 or not c[0].isdigit():
            continue
        try:
            pct = float(c[8].replace(',', ''))
        except ValueError:
            pct = None
        # [名次, 標的種類, 標的代號（債券是 ISIN）, 標的名稱, 佔淨值%]
        out.setdefault(fund, []).append([int(c[0]), c[1], c[2], c[3].rstrip('*'), pct])
    return out


def main():
    force = '--force' in sys.argv[1:]
    doc = {}
    if os.path.exists(OUT):
        try:
            doc = json.load(io.open(OUT, encoding='utf-8'))
        except Exception:                                     # noqa: BLE001
            doc = {}

    http = Http()
    first = http.open(TOP10)
    months = options(first, 'ddlQ_YM')
    if not months:
        note(u'公會的月前十大頁面看不懂（找不到年月選單）')
        return 1
    ym = months[-1]
    if not force and (doc.get('meta') or {}).get('ym') == ym and doc.get('etfs'):
        log(u'公會最新仍是 %s，已經有了，不重抓' % ym)
        return 0

    classes = [c for c in options(first, 'ddlQ_Class') if c[:2] in ('AH', 'AL')]
    log(u'公會月前十大：%s，ETF 類型 %d 個' % (ym, len(classes)))
    mapping = name_to_code(http, ym)
    log(u'  基金名稱對照 %d 檔' % len(mapping))

    etfs, unmatched = {}, []
    for cls in classes:
        try:
            got = query_class(http, first, ym, cls)
        except Exception as e:                                # noqa: BLE001
            note(u'類型 %s：%s' % (cls, str(e)[:60]))
            continue
        for fund, rows in got.items():
            code = next((mapping[k] for k in keys(fund) if k in mapping), None)
            if not code:
                unmatched.append(fund)
                continue
            etfs[code] = {'name': fund, 'rows': sorted(rows)[:10]}
        log(u'  %s：%d 檔' % (cls, len(got)))

    if len(etfs) < 100:
        note(u'只對到 %d 檔，不覆蓋既有的資料' % len(etfs))
        return 1
    payload = {
        'meta': {
            'ym': ym,
            'updated': datetime.now(TPE).date().isoformat(),
            'source': u'中華民國證券投資信託暨顧問商業同業公會「基金投資明細－月前十大」',
            'unmatched': unmatched[:30],
            'errors': ERRORS,
        },
        'etfs': dict(sorted(etfs.items())),
    }
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    log(u'完成：%s（%s，%d 檔；對不到代號 %d 檔；%.0f KB）' % (
        OUT, ym, len(etfs), len(unmatched), os.path.getsize(OUT) / 1024.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
