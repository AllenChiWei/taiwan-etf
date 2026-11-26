# -*- coding: utf-8 -*-
u"""已公告上市普通股除息對加權指數的點數估算。

    python scripts/fetch_exdiv_pts.py [outfile]

只計目前近月台指期結算日前、calendar.json 已公告且有現金股利的上市普通股。
個股股數與收盤價來自證交所每日資料；市值除數以同期上市普通股總市值／加權指數推算。
"""
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'exdiv_pts.json')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
if args:
    OUT = args[0]

BASE = 'https://www.twse.com.tw/rwd/zh'
SITE = (os.environ.get('SITE_URL') or 'https://allenchiwei.github.io/taiwan-etf/').rstrip('/')
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) ex-dividend index points')
TIMEOUT = 40


def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        return json.loads(res.read().decode('utf-8'))


def number(value):
    try:
        s = str(value).replace(',', '').strip()
        return float(s) if s and s not in ('-', '--', 'X') else None
    except (TypeError, ValueError):
        return None


def roc_date(value):
    """Parse common TWSE ROC dates into ISO dates."""
    s = str(value or '').strip()
    m = re.search(r'(\d{2,3})[年/](\d{1,2})[月/](\d{1,2})', s)
    if not m:
        m = re.fullmatch(r'(\d{3})(\d{2})(\d{2})', s)
    if not m:
        return None
    try:
        return date(int(m.group(1)) + 1911, int(m.group(2)), int(m.group(3))).isoformat()
    except ValueError:
        return None


def parse_tables(doc):
    """Normalize both MI_INDEX table containers and the flat report shape."""
    tables = doc.get('tables') or []
    if not tables and doc.get('fields') and doc.get('data'):
        tables = [doc]
    for table in tables:
        fields = table.get('fields') or []
        if fields and table.get('data'):
            yield fields, table['data']


def rows_by_fields(doc, required):
    for fields, rows in parse_tables(doc):
        if all(any(alias in fields for alias in aliases) for aliases in required.values()):
            idx = {key: next(fields.index(a) for a in aliases if a in fields)
                   for key, aliases in required.items()}
            for row in rows:
                if len(row) >= max(idx.values()) + 1:
                    yield {key: row[i] for key, i in idx.items()}


def latest_taiex(doc, today):
    """Pick the latest published FMTQIK close not after today."""
    fields = doc.get('fields') or []
    if not fields or not doc.get('data'):
        raise ValueError('FMTQIK 缺少欄位或每日資料')
    day_i, index_i = fields.index('日期'), fields.index('發行量加權股價指數')
    rows = []
    for row in doc['data']:
        if len(row) <= max(day_i, index_i):
            continue
        day, index = roc_date(row[day_i]), number(row[index_i])
        if day and day <= today and index and index > 0:
            rows.append((day, index))
    if not rows:
        raise ValueError('FMTQIK 沒有可用的近期加權指數收盤')
    return max(rows)


def twse_snapshot(day):
    """Return date-specific ordinary-share market caps and share counts."""
    q = urllib.parse.urlencode({'date': day.replace('-', ''), 'selectType': 'ALLBUT0999', 'response': 'json'})
    # MI_INDEX 新版 rwd 要用 type=，selectType= 會回 OK 但個股表是空的（Claude 驗收時實測發現）
    pq = urllib.parse.urlencode({'date': day.replace('-', ''), 'type': 'ALLBUT0999', 'response': 'json'})
    prices_doc = fetch_json('%s/afterTrading/MI_INDEX?%s' % (BASE, pq))
    # 發行股數（MI_QFIIS）當天常比收盤行情晚公布（2026-11-26 16 點多實測回「查詢日期大於可查詢最大日期」）。
    # 股數幾乎不會一天就變，所以往前找最近 7 天內有資料的那天；價格仍用指數同一天（Claude 驗收時加）。
    shares_doc = {}
    d0 = date.fromisoformat(day)
    for back in range(0, 8):
        dq = urllib.parse.urlencode({'date': (d0 - timedelta(days=back)).strftime('%Y%m%d'),
                                     'selectType': 'ALLBUT0999', 'response': 'json'})
        time.sleep(1.5)
        shares_doc = fetch_json('%s/fund/MI_QFIIS?%s' % (BASE, dq))
        if shares_doc.get('stat') in (None, 'OK') and shares_doc.get('data'):
            break
    if shares_doc.get('stat') not in (None, 'OK') or prices_doc.get('stat') not in (None, 'OK'):
        raise ValueError('證交所回應非 OK：%s / %s' % (shares_doc.get('stat'), prices_doc.get('stat')))
    shares = {}
    for row in rows_by_fields(shares_doc, {
        'code': ('證券代號', '股票代號'), 'shares': ('總發行股數', '發行股數')
    }):
        code = str(row['code']).strip()
        count = number(row['shares'])
        if re.fullmatch(r'\d{4}', code) and not code.startswith('9') and count and count > 0:
            shares[code] = count
    prices = {}
    for row in rows_by_fields(prices_doc, {
        'code': ('證券代號', '股票代號'), 'close': ('收盤價',),
        'name': ('證券名稱', '名稱')
    }):
        code = str(row['code']).strip()
        close = number(row['close'])
        if re.fullmatch(r'\d{4}', code) and not code.startswith('9') and close and close > 0:
            prices[code] = close
    caps = {code: shares[code] * px for code, px in prices.items() if code in shares}
    if len(caps) < 500:
        raise ValueError('有效上市普通股不足：股數 %d、行情 %d、配對 %d' % (len(shares), len(prices), len(caps)))
    return caps, shares, prices


def monthly_settle(today):
    """Third Wednesday of this/next month; return the first date not before today."""
    y, m = today.year, today.month
    for _ in range(2):
        first = date(y, m, 1)
        day = 1 + (2 - first.weekday()) % 7 + 14
        settle = date(y, m, day)
        if settle >= today:
            return settle.isoformat()
        m += 1
        if m == 13:
            y, m = y + 1, 1
    raise ValueError('cannot find monthly settlement')


def estimate(calendar, snapshot_date, caps, shares, prices, taiex, to_date):
    """Pure estimate; `snapshot_date` supplies a consistent price/share snapshot."""
    total_cap = sum(caps.values())
    if total_cap <= 0:
        raise ValueError('上市普通股市值總額為零')
    divisor = total_cap / taiex
    events, seen = [], set()
    for row in calendar.get('exdiv', []):
        code = str(row.get('code') or '').strip()
        day = row.get('d')
        cash = number(row.get('cash'))
        key = (code, day)
        if (row.get('m') != 'twse' or not re.fullmatch(r'\d{4}', code)
                or day is None or day <= snapshot_date or day > to_date
                or cash is None or cash <= 0 or key in seen
                or code not in shares or code not in prices):
            continue
        seen.add(key)
        pts = cash * shares[code] / divisor
        events.append({'d': day, 'code': code, 'name': row.get('name') or code,
                       'cash': cash, 'pts': round(pts, 3),
                       'weight': round(caps[code] / total_cap, 8)})
    events.sort(key=lambda r: (r['d'], r['code']))
    return {
        'meta': {'updated': datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=8))).isoformat(timespec='seconds'),
                 'date': snapshot_date, 'to': to_date, 'source': '證交所 MI_QFIIS、MI_INDEX、FMTQIK',
                 'rows': len(events), 'shareRows': len(shares), 'matchedRows': len(caps),
                 'matchRate': round(len(caps) / max(1, len(shares)), 4),
                 'taiex': round(taiex, 2), 'divisor': round(divisor, 2),
                 'totalPoints': round(sum(e['pts'] for e in events), 2),
                 'note': '僅計已公告除息之上市普通股，為下限；用最新市值快照估算，不含櫃買與未公告除息。'},
        'events': events,
    }


def load_json(url):
    return fetch_json(url)


def run():
    calendar = load_json(SITE + '/data/calendar.json')
    atm = load_json(SITE + '/data/atm.json')
    tpe = timezone(timedelta(hours=8))
    today = datetime.now(tpe).date()
    # 台指期近月結算日與週三（月）選契約同一日；用已發布合約日曆優先。
    expiries = [r.get('e') for r in atm.get('rows', [])
                if r.get('c') and re.fullmatch(r'\d{6}', r['c']) and r.get('e') >= today.isoformat()]
    to_date = min(expiries) if expiries else monthly_settle(today)
    # FMTQIK 一次列出本月每日指數收盤，先取最新已公布交易日，再查同日股數與行情。
    fmt = fetch_json('%s/afterTrading/FMTQIK' % BASE)
    snapshot_date, taiex = latest_taiex(fmt, today.isoformat())
    time.sleep(1.0)
    caps, shares, prices = twse_snapshot(snapshot_date)
    matched_ratio = len(caps) / max(1, len(shares))
    if matched_ratio < 0.90:
        raise ValueError('發行股數與收盤行情配對率 %.1f%% 低於 90%%，保留前一版' % (matched_ratio * 100))
    result = estimate(calendar, snapshot_date, caps, shares, prices, taiex, to_date)
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(result, fh, ensure_ascii=False, separators=(',', ':'))
    print('除息影響估算：%s 至 %s，%d 檔、%.2f 點（行情配對率 %.2f%%）' % (
        snapshot_date, to_date, result['meta']['rows'], result['meta']['totalPoints'], result['meta']['matchRate'] * 100))


if __name__ == '__main__':
    run()
