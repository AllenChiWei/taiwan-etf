# -*- coding: utf-8 -*-
u"""選擇權最後結算價（週三、週五到期，含月選）的歷史，逐日累積。

    python scripts/fetch_settle.py [--max 10]

寫到 app/public/data/settle.json，**進版控**（跟 atm.json 一樣是每日更新流程提交的累積檔）。
網站「結算價預測」頁（#/settle）用它顯示前次結算價、13:00～13:30 的走勢與預測變化、近期結算紀錄。

## 算法（期交所「股價指數類最後結算價」）

    結算日 13:00:00（不含）～13:25:00（含）每 5 秒揭示的加權指數 300 筆
    ＋ 13:30 收盤指數 1 筆，共 301 筆簡單平均，四捨五入到 1 點

用證交所每 5 秒指數 MI_5MINS_INDEX 重算，2026-10-02～11-20 共 15 個結算日和期交所公告
（optIndxFSP）全部相同。這份檔也存期交所公告（fsp）對照，抓不到就只有自算值。

## 結算日從哪來

atm.json 每一列的合約到期日 e（W＝週三、F＝週五、六碼＝月選）——遇假日順延已經在裡面，
例如 202609F4 到期日是 2026-09-29（星期二）。不自己推日曆。

## 每次只補幾天

證交所對同一來源的請求很敏感（太快會暫時封鎖），每天其實只會多 0～1 天；
--max 限制一次最多抓幾天（預設 10），每次間隔 3 秒。13:00～13:30 走勢（v，361 筆）
只留最近 KEEP_SERIES 個結算日，更舊的只留結算價，檔案不會一直長大。
"""
import io
import json
import math
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'settle.json')
ATM = os.path.join(ROOT, 'app', 'public', 'data', 'atm.json')
TPE = timezone(timedelta(hours=8))
UA = {'User-Agent': ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
                     '+https://allenchiwei.github.io/taiwan-etf/) TXO settlement')}
TWSE = 'https://www.twse.com.tw/exchangeReport/MI_5MINS_INDEX?response=json&date=%s'
FSP_URL = 'https://www.taifex.com.tw/cht/5/optIndxFSP'
DELAY = 3
KEEP_SERIES = 30


def log(m):
    print(m, flush=True)


def get(url, tries=3):
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers=UA)
            return urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
        except Exception as e:                                   # noqa: BLE001
            if attempt == tries:
                raise
            log(u'  重試 %d：%s' % (attempt, e))
            time.sleep(DELAY * attempt)


def five_sec(day):
    u"""某日 13:00:00～13:30:00 每 5 秒的加權指數（361 筆）；資料不完整回 None。"""
    j = json.loads(get(TWSE % day.replace('-', '')))
    if j.get('stat') != 'OK':
        return None
    v = {}
    for r in j.get('data') or []:
        t = str(r[0])
        if '13:00:00' <= t <= '13:30:00':
            v[t] = float(str(r[1]).replace(',', ''))
    want = ['13:%02d:%02d' % divmod(i * 5, 60) for i in range(361)]
    if not all(t in v for t in want):
        return None
    return [round(v[t], 2) for t in want]


def settle_of(v):
    u"""期交所算法：v[1..300]（13:00:05～13:25:00）＋ v[360]（13:30 收盤），四捨五入到 1 點。"""
    return int(math.floor((sum(v[1:301]) + v[360]) / 301 + 0.5))


def official():
    u"""期交所公告的臺指選擇權最後結算價 {YYYY-MM-DD: 價}（頁面列近一年）；失敗回 {}。"""
    try:
        t = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', get(FSP_URL)))
    except Exception as e:                                       # noqa: BLE001
        log(u'  期交所公告抓不到（%s），只存自算值' % e)
        return {}
    out = {}
    for d, _c, p in re.findall(r'(\d{4}/\d{2}/\d{2}) (\d{6}(?:[WF]\d)?) (\d{4,6})\b', t):
        out.setdefault(d.replace('/', '-'), int(p))
    return out


def main():
    args = sys.argv[1:]
    cap = int(args[args.index('--max') + 1]) if '--max' in args else 10
    now = datetime.now(TPE)
    # 當天 14:00 以後證交所才有完整的每 5 秒資料
    last_ok = now.date().isoformat() if now.hour >= 14 else (now.date() - timedelta(days=1)).isoformat()

    atm = json.load(io.open(ATM, encoding='utf-8'))
    contracts = {}
    for r in atm.get('rows', []):
        if r.get('e') and r.get('c'):
            contracts.setdefault(r['e'], set()).add(r['c'])
    days = sorted(d for d in contracts if d <= last_ok)

    old = {}
    if os.path.exists(OUT):
        for r in json.load(io.open(OUT, encoding='utf-8')).get('rows', []):
            old[r['d']] = r
    todo = [d for d in days if d not in old][-cap:] if cap > 0 else []
    log(u'結算日 %d 個，已有 %d，這次補 %d：%s' % (len(days), len(old), len(todo), '、'.join(todo)))

    for i, d in enumerate(todo):
        if i:
            time.sleep(DELAY)
        v = five_sec(d)
        if v is None:
            log(u'  %s 證交所每 5 秒資料不完整，下次再補' % d)
            continue
        old[d] = {'d': d, 'c': sorted(contracts[d]), 'settle': settle_of(v), 'v': v}
        log(u'  %s %s 結算價 %d' % (d, '/'.join(old[d]['c']), old[d]['settle']))

    fsp = official()
    bad = []
    for d, r in old.items():
        if d in fsp:
            r['fsp'] = fsp[d]
            if r['settle'] != fsp[d]:
                bad.append(u'%s 自算 %d／公告 %d' % (d, r['settle'], fsp[d]))
    rows = [old[d] for d in sorted(old)]
    for r in rows[:-KEEP_SERIES]:
        r.pop('v', None)
    if bad:
        log(u'  ⚠ 自算和期交所公告不同：' + '；'.join(bad))

    obj = {
        'meta': {
            'updated': now.date().isoformat(),
            'latest': rows[-1]['d'] if rows else '',
            'count': len(rows),
            'source': u'證交所 MI_5MINS_INDEX（每 5 秒加權指數）自算；fsp＝期交所 optIndxFSP 公告',
            'note': u'結算價＝13:00（不含）～13:25（含）每 5 秒指數 300 筆＋13:30 收盤，共 301 筆平均、四捨五入。'
                    u'v＝13:00:00～13:30:00 每 5 秒指數（361 筆），只留最近 %d 個結算日。' % KEEP_SERIES,
            'mismatch': bad,
        },
        'rows': rows,
    }
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')))
    log(u'%s：%d 個結算日（最新 %s），公告對照 %d 個、不同 %d 個'
        % (OUT, len(rows), obj['meta']['latest'], sum(1 for r in rows if 'fsp' in r), len(bad)))


if __name__ == '__main__':
    main()
