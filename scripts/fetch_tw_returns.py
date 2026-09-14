# -*- coding: utf-8 -*-
u"""Compute Taiwan ETF period returns from FinLab, replacing the MoneyDJ Basic0008 scrape.

    python scripts/fetch_tw_returns.py <workdir>

Reads <workdir>/universe.tsv, writes <workdir>/tw_returns.json:

    {"asof": "2026-09-11",
     "returns": {"0050": {"r3": "6.28", "r6": "41.46", …}, …}}

Why this exists: it halves how much we take from MoneyDJ. That scrape was 359 pages a day
for returns plus 359 for the basic table; now only the basic table (保管銀行/配息/殖利率)
comes from there, because FinLab has no equivalent for those three fields.

`etl:adj_close` is a genuine total-return series for Taiwan — 0056's adjusted/raw ratio has
grown to 3.03 over the history, which is dividend reinvestment showing up. (The US
`us_fund_price` series is *not* adjusted that way; see fetch_us_etfs.py.) So these are
total returns, the same basis MoneyDJ used.

Periods are calendar offsets, not trading-day counts: "近1年" means one year back from the
last trading day, which is what a reader expects and what MoneyDJ reports.
"""
import io
import json
import os
import sys
import warnings

warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

WORK = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = os.path.join(WORK, 'tw_returns.json')

# JSON 欄位名 -> 往回推幾個月
PERIODS = [('r3', 3), ('r6', 6), ('r12', 12), ('r36', 36), ('r60', 60)]

# 起點附近要有報價才算數。基金剛上市那幾天可能還沒成交。
TOLERANCE_DAYS = 10


def main():
    from finlab_client import login
    login()
    from finlab import data
    import pandas as pd

    universe_path = os.path.join(WORK, 'universe.tsv')
    if not os.path.exists(universe_path):
        sys.exit('%s not found - run fetch_universe.py first' % universe_path)
    codes = [l.split('\t')[0].strip()
             for l in io.open(universe_path, encoding='utf-8') if l.strip()]

    print('讀取 FinLab 台股還原收盤價…', flush=True)
    adj = data.get('etl:adj_close')
    asof = adj.index[-1]
    print('  %d 個交易日 x %d 檔，最後交易日 %s'
          % (adj.shape[0], adj.shape[1], asof.date()), flush=True)

    missing = [c for c in codes if c not in adj.columns]
    if missing:
        print('  FinLab 沒有價格的 %d 檔：%s%s'
              % (len(missing), ', '.join(missing[:10]),
                 '…' if len(missing) > 10 else ''), flush=True)

    out = {}
    counts = dict((k, 0) for k, _ in PERIODS)
    for code in codes:
        row = {}
        if code in adj.columns:
            s = adj[code].dropna()
            for key, months in PERIODS:
                row[key] = 'N/A'
                if len(s) < 2:
                    continue
                target = asof - pd.DateOffset(months=months)
                # 找起點：目標日當天或之後第一個有報價的交易日
                idx = s.index[s.index >= target]
                if len(idx) == 0:
                    continue
                start = idx[0]
                # 基金上市晚於目標日就沒有這段期間的資料，不要拿上市日硬充
                if (start - target).days > TOLERANCE_DAYS:
                    continue
                base = s[start]
                if base <= 0:
                    continue
                row[key] = '%.2f' % ((s.iloc[-1] / base - 1) * 100)
                counts[key] += 1
        else:
            row = dict((k, 'N/A') for k, _ in PERIODS)
        out[code] = row

    d = os.path.dirname(OUT)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps({'asof': asof.strftime('%Y-%m-%d'), 'returns': out},
                            ensure_ascii=False, separators=(',', ':')))

    print('', flush=True)
    print('%s：%d 檔' % (OUT, len(out)), flush=True)
    print('各期間有資料的檔數：%s'
          % '  '.join('%s=%d' % (k, counts[k]) for k, _ in PERIODS), flush=True)


main()
