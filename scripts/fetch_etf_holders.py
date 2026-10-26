# -*- coding: utf-8 -*-
u"""每檔 ETF 的受益人數與受益權單位（張），每週一筆，逐週累積。

    python scripts/fetch_etf_holders.py

寫到 app/public/data/etf_holders.json，**進版控**（360 檔 × 每週兩個數字，一年約 300 KB）。

## 來源

集保結算所開放資料「集保戶股權分散表」（opendata.tdcc.com.tw，id=1-5），政府資料開放
授權、沒有 robots.txt（回 404 頁）。fetch_stocks.py 的大戶比例用的也是這份。
每週五的資料，大約週六晚上公布；**只有最新一週**，沒有歷史 —— 所以跟價平和一樣逐週累積，
第一次執行只有一個點，之後每週多一個。每天的排程都會跑，同一週重跑只是覆蓋同一筆。

ETF 的「股東」就是受益人：持股分級 17（合計）那一列的人數＝受益人數、股數＝流通的
受益權單位（÷1000 換成張）。張數變化就是淨申購／贖回。

## 產出

    {"meta": {"source": ..., "asof": "2026-10-22", "weeks": 1},
     "dates": ["2026-10-22", ...],                   # 舊到新
     "etfs": {"0056": [[1741232, 14704534], ...]}}   # 和 dates 對齊：[受益人數, 張數]，缺的週是 null
"""
import csv
import io
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'etf_holders.json')
ETFS = os.path.join(ROOT, 'app', 'public', 'data', 'etfs.json')
TPE = timezone(timedelta(hours=8))
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; +https://allenchiwei.github.io/taiwan-etf/) '
      'ETF holder counts (weekly)')
TDCC = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5'
TOTAL = '17'                       # 持股分級 17＝合計
KEEP = 260                         # 留五年
MIN_ETFS = 100                     # 對得到的 ETF 少於這個數，當作來源格式變了，不寫檔


def log(m):
    print(m, flush=True)


def fetch(tries=3):
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(TDCC, headers={'User-Agent': UA})
            return urllib.request.urlopen(req, timeout=120).read().decode('utf-8-sig')
        except Exception as e:                                # noqa: BLE001
            if attempt == tries:
                raise
            log(u'  集保股權分散表第 %d 次失敗（%s），重試' % (attempt, str(e)[:60]))
            time.sleep(5 * attempt)


def parse(text, codes):
    u"""回 (資料日期 YYYY-MM-DD, {代號: [人數, 張數]})，只留 codes 裡的。"""
    asof, out = None, {}
    for r in csv.reader(io.StringIO(text)):
        if len(r) < 6 or r[2].strip() != TOTAL:
            continue
        code = r[1].strip()
        if code not in codes:
            continue
        d = r[0].strip()
        if len(d) == 8 and d.isdigit():
            asof = '%s-%s-%s' % (d[:4], d[4:6], d[6:])
        try:
            out[code] = [int(r[3]), int(round(int(r[4]) / 1000))]
        except ValueError:
            continue
    return asof, out


def merge(doc, asof, snap):
    u"""把一週的快照併進累積檔；同一週重跑就覆蓋那一欄。新上市的代號前面補 null。"""
    dates = doc.setdefault('dates', [])
    etfs = doc.setdefault('etfs', {})
    if asof in dates:
        i = dates.index(asof)
    else:
        dates.append(asof)
        dates.sort()
        i = dates.index(asof)
        for v in etfs.values():
            v.insert(i, None)
    n = len(dates)
    for code, val in snap.items():
        row = etfs.setdefault(code, [None] * n)
        row += [None] * (n - len(row))
        row[i] = val
    if n > KEEP:
        cut = n - KEEP
        doc['dates'] = dates[cut:]
        for k in list(etfs):
            etfs[k] = etfs[k][cut:]
            if all(x is None for x in etfs[k]):
                del etfs[k]
    return doc


def main():
    codes = set(e['code'] for e in json.load(open(ETFS, encoding='utf-8'))['etfs'])
    asof, snap = parse(fetch(), codes)
    log(u'集保股權分散表 %s：對到 %d／%d 檔 ETF' % (asof, len(snap), len(codes)))
    if not asof or len(snap) < MIN_ETFS:
        log(u'對到的太少，來源格式可能變了，不寫檔')
        return 1
    doc = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    doc = merge(doc, asof, snap)
    doc['meta'] = {
        'source': u'集保結算所開放資料：集保戶股權分散表（每週）',
        'asof': doc['dates'][-1],
        'weeks': len(doc['dates']),
        'generated': datetime.now(TPE).strftime('%Y-%m-%d %H:%M'),
    }
    out = {'meta': doc['meta'], 'dates': doc['dates'],
           'etfs': dict(sorted(doc['etfs'].items()))}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    log(u'寫入 %s（%d 週）' % (OUT, len(out['dates'])))
    return 0


if __name__ == '__main__':
    sys.exit(main())
