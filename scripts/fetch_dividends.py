# -*- coding: utf-8 -*-
u"""交易所官方的 ETF 除息金額。

    python scripts/fetch_dividends.py [outfile] [--from-year 2019]

預設寫到 app/public/data/dividends.json：

    {"meta": {...}, "dividends": {"00406A": [["2026-07-31", 0.128], ...]}}

## 為什麼需要這支 —— 回推的精度在來源端就沒了

原本 ETF 的配息是從還原股價與原始收盤價的比值回推的（見 fetch_calc.py）。
那個方法能算出是哪一天除息、大致配多少，但**金額只準到「分」**：

    00406A 2026-09-02　官方配息 0.138000
                       前收 9.96，9.96 − 0.138 = 9.822
                       但除權息參考價依最小跳動單位取整成 9.82
                       還原股價按參考價調整 -> 回推得到 9.96 − 9.82 = 0.14

那 0.002 在資料進到本專案之前就消失了。單價低、配息小的標的影響最明顯：
0.138 被算成 0.14 是 1.4% 的誤差，乘上一年十二次就會讓年配息估錯。

使用者實際回報了這個差異，所以改用交易所公告的原始數字。

## 兩個交易所，兩種涵蓋範圍

**證交所（上市）** `exchangeReport/TWT49U`
查詢參數是 `startDate` / `endDate`（不是 `strDate`，那個會回「結束日期不能小於
開始日期」的錯誤訊息，很容易誤判成日期格式不對）。可以一次查一整年，
金額欄位「權值+息值」給到小數第六位。

**櫃買（上櫃）** `exright/dailyquo/exDailyQ_result.php`
只回傳「當前的除息清單」—— 帶 d=115/08 或 d=115/09/02 都一樣回最新那天，
參數是被忽略的。所以拿不到歷史，只能每天抓一次慢慢累積。

因此債券 ETF（00679B 這類在櫃買掛牌的）短期內仍要靠 fetch_calc.py 的回推值。
2026 年有配息的 202 檔裡，證交所涵蓋 100 檔。

## 累積式

產出的檔案會進版控，每次執行是「合併」而不是「重寫」：證交所補歷史，
櫃買補當天。已經有官方數字的紀錄不會被覆蓋掉。
"""
import io
import json
import os
import sys
import time
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'dividends.json')

TWSE_URL = ('https://www.twse.com.tw/exchangeReport/TWT49U'
            '?response=json&startDate=%s&endDate=%s')
TPEX_URL = ('https://www.tpex.org.tw/web/stock/exright/dailyquo/exDailyQ_result.php'
            '?l=zh-tw')

UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) ETF dividend amounts')

DELAY = 2.0
TIMEOUT = 40
FROM_YEAR = 2019

args = [a for a in sys.argv[1:] if not a.startswith('--')]
if args:
    OUT = args[0]
for a in sys.argv[1:]:
    if a.startswith('--from-year'):
        FROM_YEAR = int(a.split('=')[1]) if '=' in a else FROM_YEAR


def log(m):
    print(m, flush=True)


def fetch_json(url):
    try:
        from urllib.request import Request, urlopen
    except ImportError:
        from urllib2 import Request, urlopen          # noqa
    req = Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    raw = urlopen(req, timeout=TIMEOUT).read()
    return json.loads(raw.decode('utf-8', 'replace'))


def to_float(s):
    try:
        return float(str(s).replace(',', '').strip())
    except (TypeError, ValueError):
        return None


def roc_to_iso(s):
    u"""'115年08月03日' 或 '115/09/17' -> '2026-08-03'。"""
    t = str(s).strip()
    digits = [d for d in t.replace(u'年', '/').replace(u'月', '/')
                        .replace(u'日', '').split('/') if d.strip()]
    if len(digits) != 3:
        return None
    try:
        y, m, d = (int(x) for x in digits)
    except ValueError:
        return None
    if y < 1911:
        y += 1911
    return '%04d-%02d-%02d' % (y, m, d)


def fetch_twse(year):
    u"""一整年的除權息計算結果表。回傳 [(code, iso_date, amount)]。"""
    url = TWSE_URL % ('%d0101' % year, '%d1231' % year)
    doc = fetch_json(url)
    if doc.get('stat') != 'OK':
        log(u'  %d 年：%s' % (year, str(doc.get('stat'))[:60]))
        return []
    fields = doc.get('fields') or []
    try:
        i_date = fields.index(u'資料日期')
        i_code = fields.index(u'股票代號')
        i_amt = fields.index(u'權值+息值')
    except ValueError:
        log(u'  %d 年：欄位名稱變了 -> %s' % (year, fields[:6]))
        return []

    out = []
    for r in doc.get('data') or []:
        iso = roc_to_iso(r[i_date])
        amt = to_float(r[i_amt])
        if iso and amt is not None and amt > 0:
            out.append((str(r[i_code]).strip(), iso, amt))
    return out


def fetch_tpex():
    u"""櫃買當前的除息清單。只有今天，拿不到歷史。"""
    doc = fetch_json(TPEX_URL)
    tables = doc.get('tables') or []
    if not tables:
        return []
    tb = tables[0]
    fields = tb.get('fields') or []
    try:
        i_date = fields.index(u'除權息日期')
        i_code = fields.index(u'代號')
        i_amt = fields.index(u'現金股利')
    except ValueError:
        log(u'  櫃買：欄位名稱變了 -> %s' % fields[:6])
        return []

    out = []
    for r in tb.get('data') or []:
        iso = roc_to_iso(r[i_date])
        amt = to_float(r[i_amt])
        if iso and amt is not None and amt > 0:
            out.append((str(r[i_code]).strip(), iso, amt))
    return out


def load_existing(path):
    if not os.path.exists(path):
        return {}
    try:
        doc = json.load(io.open(path, encoding='utf-8'))
        return doc.get('dividends') or {}
    except Exception:                                  # noqa: BLE001
        return {}


def main():
    etfs = json.load(io.open(
        os.path.join(ROOT, 'app', 'public', 'data', 'etfs.json'), encoding='utf-8'))
    codes = set(e['code'] for e in etfs['etfs'])
    log(u'名單裡有 %d 檔 ETF' % len(codes))

    merged = load_existing(OUT)
    before = sum(len(v) for v in merged.values())
    log(u'既有紀錄 %d 筆（%d 檔）' % (before, len(merged)))

    this_year = date.today().year
    added = 0

    log(u'')
    log(u'證交所（上市）：')
    for year in range(FROM_YEAR, this_year + 1):
        rows = fetch_twse(year)
        n = 0
        for code, iso, amt in rows:
            if code not in codes:
                continue
            lst = merged.setdefault(code, [])
            if any(d == iso for d, _ in lst):
                continue
            lst.append([iso, amt])
            n += 1
        added += n
        log(u'  %d 年：%d 筆除權息，其中 ETF 新增 %d 筆' % (year, len(rows), n))
        time.sleep(DELAY)

    log(u'')
    log(u'櫃買（上櫃，只有當前清單）：')
    try:
        rows = fetch_tpex()
        n = 0
        for code, iso, amt in rows:
            if code not in codes:
                continue
            lst = merged.setdefault(code, [])
            if any(d == iso for d, _ in lst):
                continue
            lst.append([iso, amt])
            n += 1
        added += n
        log(u'  當前清單 %d 筆，其中 ETF 新增 %d 筆' % (len(rows), n))
    except Exception as e:                             # noqa: BLE001
        # 櫃買掛掉不該讓整個流程失敗 —— 證交所那份才是主力
        log(u'  抓取失敗（略過）：%s' % str(e)[:80])

    for lst in merged.values():
        lst.sort()

    payload = {
        'meta': {
            'updated': date.today().isoformat(),
            'codes': len(merged),
            'records': sum(len(v) for v in merged.values()),
            'source': u'臺灣證券交易所 除權除息計算結果表 / 櫃買中心 除權息預告',
            'note': (u'交易所公告的原始金額。櫃買只提供當前清單，'
                     u'歷史部分要靠每日累積。'),
        },
        'dividends': merged,
    }
    d = os.path.dirname(OUT)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, sort_keys=True,
                            separators=(',', ':')))

    log(u'')
    log(u'新增 %d 筆，合計 %d 筆（%d 檔），寫入 %s（%.0f KB）'
        % (added, payload['meta']['records'], payload['meta']['codes'],
           OUT, os.path.getsize(OUT) / 1024.0))


if __name__ == '__main__':
    main()
