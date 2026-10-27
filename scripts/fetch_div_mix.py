# -*- coding: utf-8 -*-
u"""每檔 ETF 最近一次公告的配息組成（股利／利息／收益平準金／資本利得／其他所得的占比）。

    python scripts/fetch_div_mix.py

寫到 app/public/data/div_mix.json，進版控（約 260 檔 × 一組五個數字，十幾 KB）。

## 為什麼要（2026-10-27 站主回報）

月領試算原本把整筆配息當成股利所得，算二代健保補充保費。實際上只有「股利所得」「利息所得」
要扣 2.11% 補充保費、併入所得稅；收益平準金、已實現資本利得（掩護性買權 ETF 的選擇權權利金
也歸在這裡）都不扣不課。0056 最近一次 82% 是資本利得、00919／00981A 100% —— 原本的估計
把它們的健保高估好幾倍。

## 來源

集保結算所「ETF 觀測站」（www.fundclear.com.tw/etf）收益分配查詢頁背後的 API：
POST /api/etf/dividend/query-dividend，`divDet1`～`divDet5` 依序是股利所得、利息所得、
收益平準金、已實現資本利得、其他所得的占比（%），是投信公告的「預估」組成。
沒有 robots.txt（回 404）。每頁最多 100 筆（500 會 400），依除息日新到舊排，
抓到除息日早於 LOOKBACK 天就停（約 20 頁）。

- 五項都是 0 ＝ 觀測站顯示「尚未取得或尚未公告配息組成資訊」，跳過，往前找上一次。
- disAmount -9999 ＝ 已公告除息日、金額還沒定，一樣跳過。
- 每檔只留最近一次有組成的那筆；整年都沒有的不列（前端顯示「組成未公告」）。

## 產出

    {"meta": {"source": ..., "generated": "2026-10-27 10:10", "count": 229},
     "mix": {"0056": {"date": "2026-10-22", "d": [17.97, 0, 0, 82.03, 0]}}}
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'div_mix.json')
TPE = timezone(timedelta(hours=8))
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; +https://allenchiwei.github.io/taiwan-etf/) '
      'ETF distribution composition (daily)')
URL = 'https://www.fundclear.com.tw/api/etf/dividend/query-dividend'
PAGE = 100
LOOKBACK = 400                     # 天；年配的也至少看得到一次
MAX_PAGES = 60
MIN_ETFS = 100                     # 有組成的少於這個數，當作來源格式變了，不寫檔


def log(m):
    print(m, flush=True)


def fetch_page(n, tries=3):
    body = {'_pageNum': n, '_pageSize': PAGE, 'etfType': '', 'searchName': '',
            'exDividendDateStart': '', 'exDividendDateEnd': '', 'payDateStart': '', 'payDateEnd': ''}
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(URL, data=json.dumps(body).encode('utf-8'), headers={
                'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': UA})
            return json.loads(urllib.request.urlopen(req, timeout=60).read().decode('utf-8'))
        except Exception as e:                                # noqa: BLE001
            if attempt == tries:
                raise
            log(u'  第 %d 頁第 %d 次失敗（%s），重試' % (n, attempt, str(e)[:60]))
            time.sleep(5 * attempt)


def mix_of(row):
    u"""五項占比；全 0、讀不到或金額未定回 None。"""
    try:
        if float(row.get('disAmount') or 0) <= 0:
            return None
        d = [round(float(row.get('divDet%d' % i) or 0), 2) for i in range(1, 6)]
    except ValueError:
        return None
    return d if any(d) else None


def pick(rows):
    u"""每檔取除息日最新、有組成的那一筆 → {代號: {"date", "d"}}"""
    out = {}
    for r in sorted(rows, key=lambda r: r.get('exDivDate') or '', reverse=True):
        code = (r.get('stockNo') or '').strip()
        d, day = mix_of(r), r.get('exDivDate') or ''
        if not code or code in out or not d or len(day) != 8:
            continue
        out[code] = {'date': '%s-%s-%s' % (day[:4], day[4:6], day[6:]), 'd': d}
    return out


def main():
    cutoff = (datetime.now(TPE) - timedelta(days=LOOKBACK)).strftime('%Y%m%d')
    rows = []
    for n in range(1, MAX_PAGES + 1):
        doc = fetch_page(n)
        page = doc.get('list') or []
        rows += page
        if not page or len(rows) >= (doc.get('total') or 0) or min(r.get('exDivDate') or '9' for r in page) < cutoff:
            break
        time.sleep(0.5)
    mix = pick([r for r in rows if (r.get('exDivDate') or '') >= cutoff])
    log(u'集保 ETF 觀測站配息組成：讀 %d 筆（%d 頁），%d 檔有組成' % (len(rows), n, len(mix)))
    if len(mix) < MIN_ETFS:
        log(u'有組成的太少，來源格式可能變了，不寫檔')
        return 1
    out = {'meta': {'source': u'集保結算所 ETF 觀測站：收益分配預估組成占比',
                    'generated': datetime.now(TPE).strftime('%Y-%m-%d %H:%M'),
                    'count': len(mix)},
           'mix': dict(sorted(mix.items()))}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    log(u'寫入 %s' % OUT)
    return 0


if __name__ == '__main__':
    sys.exit(main())
