# -*- coding: utf-8 -*-
u"""美股表格的報酬率改成含息（部署時跑，在美股曲線之後、建置之前）。

    python scripts/apply_us_total_return.py

`us_etfs.json` 的報酬率來自 FinLab `us_fund_price`，那只還原分割、不還原配息
（QYLD 近七年含息 +117%、純價格 -13%）。三千七百檔逐檔向 FinMind 要含息價格
一天跑不完，但有曲線的那些（`series/us/*.json`，FinMind 的含息還原價）已經在
這台機器上了 —— 拿它們重算，不多發任何請求。

- 有曲線、而且曲線夠新（最後一天距日曆尾端不超過 STALE_DAYS）的：五個期間全部
  改成含息報酬，標 `tr: true`。曲線是輪替更新的，太舊的會拿舊日期的報酬去跟
  別人今天的比，所以寧可維持價格報酬。
- 其餘的維持 FinLab 的價格報酬，`tr` 不寫。畫面依 `tr` 標出是哪一種。

期間與 `fetch_us_etfs.py` 一樣以交易日計（63／126／252／756／1260 日），
算法也一樣是頭尾價格相除；只是換成這一檔自己有值的那些交易日。

只改 `app/public/data/us_etfs.json` 這份工作副本（部署不提交），進版控的仍是
FinLab 那份。曲線缺席時什麼都不做、正常結束 —— 那只是表格維持價格報酬。
"""
import io
import json
import os
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'app', 'public', 'data')
SERIES = os.path.join(DATA, 'series')

PERIODS = [('r3', 63), ('r6', 126), ('r12', 252), ('r36', 756), ('r60', 1260)]
STALE_DAYS = 10


def total_returns(values):
    u"""一檔的含息還原價（對齊日曆，缺值是 None）-> {r3: '12.34' | 'N/A', …}。"""
    s = [v for v in values if v is not None and v > 0]
    out = {}
    for key, days in PERIODS:
        if len(s) < days + 1:
            out[key] = 'N/A'
        else:
            out[key] = '%.2f' % ((s[-1] / s[-(days + 1)] - 1.0) * 100)
    return out


def last_index(first, values):
    for i in range(len(values) - 1, -1, -1):
        if values[i] is not None:
            return first + i
    return None


def main():
    cal_path = os.path.join(SERIES, '_us.json')
    if not os.path.exists(cal_path):
        print(u'沒有美股曲線，表格維持價格報酬')
        return 0
    dates = json.load(io.open(cal_path, encoding='utf-8'))['dates']
    end = date.fromisoformat(dates[-1])

    path = os.path.join(DATA, 'us_etfs.json')
    doc = json.load(io.open(path, encoding='utf-8'))
    done = stale = 0
    for row in doc['etfs']:
        f = os.path.join(SERIES, 'us', '%s.json' % row['code'])
        if not os.path.exists(f):
            continue
        s = json.load(io.open(f, encoding='utf-8'))
        li = last_index(s['first'], s['values'])
        if li is None or (end - date.fromisoformat(dates[li])).days > STALE_DAYS:
            stale += 1
            continue
        row.update(total_returns(s['values']))
        row['tr'] = True
        done += 1

    doc['meta']['totalReturn'] = done
    doc['meta']['totalReturnAsOf'] = dates[-1]
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))
    print(u'含息報酬：%d 檔（曲線太舊而維持價格報酬 %d 檔），其餘 %d 檔是價格報酬'
          % (done, stale, len(doc['etfs']) - done))
    return 0


if __name__ == '__main__':
    sys.exit(main())
