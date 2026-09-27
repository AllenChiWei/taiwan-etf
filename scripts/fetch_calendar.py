# -*- coding: utf-8 -*-
u"""台股行事曆：除權息預告與股東會日期。

    python scripts/fetch_calendar.py [outfile]

預設寫到 app/public/data/calendar.json（部署時產生，不進版控）。

## 來源（全部是交易所官方的公開端點）

    除權息預告   證交所 rwd/zh/exRight/TWT48U（上市，含 ETF）
                 櫃買 openapi tpex_exright_prepost（上櫃，含 ETF）
    股東會       證交所 openapi t187ap41_L、櫃買 openapi t187ap41_O
                 （召開股東常（臨時）會日期、地點及採用電子投票情形）

財報與月營收的**法定期限**、期貨結算日不需要抓，前端依規則算（`lib/calendar.ts`）。

## 刻意沒有的：法說會

官方的「法人說明會一覽表」只在舊版公開資訊觀測站（mopsov.twse.com.tw），它的
robots.txt 是 `User-Agent: * / Disallow: /`（只開放 bingbot）；新版觀測站的同一頁也是
轉呼叫舊站的 ajax_t100sb02_1。本專案不繞過 robots、不換 host，所以法說會不做。
2026-09-27 查過。

## 日期

兩個交易所都給民國年：證交所「115年10月08日」、櫃買與 openapi「1151008」。
全部轉成 ISO 8601。只留今天（含）以後 `HORIZON_DAYS` 天內的事件。
"""
import io
import json
import os
import re
import sys
import time
import urllib.request
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'calendar.json')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
if args:
    OUT = args[0]

UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) market calendar')
DELAY = 1.5
TIMEOUT = 40
HORIZON_DAYS = 120

TWSE_EXDIV = 'https://www.twse.com.tw/rwd/zh/exRight/TWT48U?response=json'
TPEX_EXDIV = 'https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost'
TWSE_MEETING = 'https://openapi.twse.com.tw/v1/opendata/t187ap41_L'
TPEX_MEETING = 'https://www.tpex.org.tw/openapi/v1/t187ap41_O'


def log(m):
    print(m, flush=True)


def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    last = None
    for attempt in range(3):
        try:
            raw = urllib.request.urlopen(req, timeout=TIMEOUT).read()
            time.sleep(DELAY)
            return json.loads(raw.decode('utf-8'))
        except Exception as e:                                # noqa: BLE001
            last = e
            time.sleep(5 * (attempt + 1))
    raise last


def roc_date(s):
    u"""「115年10月08日」或「1151008」-> '2026-10-08'；看不懂回 None。"""
    s = (s or '').strip()
    m = re.match(r'^(\d{2,3})年(\d{1,2})月(\d{1,2})日$', s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    elif re.match(r'^\d{7}$', s):
        y, mo, d = int(s[:3]), int(s[3:5]), int(s[5:7])
    else:
        return None
    try:
        return date(y + 1911, mo, d).isoformat()
    except ValueError:
        return None


def num(s):
    try:
        return float(str(s).replace(',', '').strip())
    except ValueError:
        return None


def cash_of(raw):
    u"""現金股利欄位。證交所 ETF 還沒公告金額時會寫一段 HTML「待公告實際收益分配金額」。"""
    v = num(re.sub(r'<[^>]+>', '', str(raw)))
    return v if v and v > 0 else None


def twse_exdiv():
    doc = fetch_json(TWSE_EXDIV)
    if doc.get('stat') != 'OK':
        raise ValueError(u'TWT48U 回應 %s' % doc.get('stat'))
    f = doc['fields']
    i_date, i_code, i_name, i_kind = (f.index(u'除權除息日期'), f.index(u'股票代號'),
                                      f.index(u'名稱'), f.index(u'除權息'))
    i_cash, i_stock = f.index(u'現金股利'), f.index(u'無償配股率')
    out = []
    for r in doc.get('data', []):
        day = roc_date(r[i_date])
        if not day:
            continue
        out.append({'d': day, 'code': r[i_code].strip(), 'name': r[i_name].strip(),
                    'k': r[i_kind].strip(), 'cash': cash_of(r[i_cash]),
                    'stock': (num(r[i_stock]) or None), 'm': 'twse'})
    return out


def tpex_exdiv():
    out = []
    for r in fetch_json(TPEX_EXDIV):
        day = roc_date(r.get('ExRrightsExDividendDate'))
        if not day:
            continue
        kind = (r.get('ExRrightsExDividend') or '').replace(u'除', '')   # 除息 -> 息
        out.append({'d': day, 'code': (r.get('SecuritiesCompanyCode') or '').strip(),
                    'name': (r.get('CompanyName') or '').strip(), 'k': kind,
                    'cash': cash_of(r.get('CashDividend')),
                    'stock': (num(r.get('StockDividendRatio')) or None), 'm': 'tpex'})
    return out


def meetings(url, market):
    out = []
    for r in fetch_json(url):
        day = roc_date(r.get(u'開會日期'))
        if not day:
            continue
        out.append({'d': day, 'code': (r.get(u'公司代號') or '').strip(),
                    'name': (r.get(u'公司名稱') or '').strip(),
                    'k': (r.get(u'股東常(臨時)會') or '').strip(),
                    'elect': (r.get(u'是否改選董監') or '').strip() == u'是',
                    'place': (r.get(u'開會地點') or '').strip()[:60], 'm': market})
    return out


def main():
    today = date.today().isoformat()
    until = (date.today() + timedelta(days=HORIZON_DAYS)).isoformat()
    errors = []

    def collect(fn, *a):
        try:
            rows = fn(*a)
        except Exception as e:                                # noqa: BLE001
            name = getattr(fn, '__name__', 'fetch')
            errors.append(u'%s：%s' % (name, str(e)[:80]))
            log(u'  %s 失敗：%s' % (name, str(e)[:80]))
            return []
        return [r for r in rows if today <= r['d'] <= until]

    exdiv = collect(twse_exdiv) + collect(tpex_exdiv)
    meets = collect(meetings, TWSE_MEETING, 'twse') + collect(meetings, TPEX_MEETING, 'tpex')

    # 同一檔同一天只留一筆（交易所偶爾重複列）
    def dedupe(rows):
        seen, out = set(), []
        for r in sorted(rows, key=lambda x: (x['d'], x['code'])):
            key = (r['d'], r['code'], r['k'])
            if key not in seen:
                seen.add(key)
                out.append(r)
        return out

    exdiv, meets = dedupe(exdiv), dedupe(meets)
    log(u'除權息預告 %d 筆、股東會 %d 筆（%s ～ %s）' % (len(exdiv), len(meets), today, until))
    if not exdiv and not meets:
        log(u'兩份都是空的，不寫出')
        sys.exit(1)

    doc = {
        'meta': {'updated': today, 'until': until,
                 'source': u'臺灣證券交易所、證券櫃檯買賣中心（除權除息預告表、股東會資料彙總表）',
                 'errors': errors},
        'exdiv': exdiv,
        'meetings': meets,
    }
    d = os.path.dirname(OUT)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))
    log(u'寫出 %s' % OUT)


if __name__ == '__main__':
    main()
