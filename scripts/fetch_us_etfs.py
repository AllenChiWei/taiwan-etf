# -*- coding: utf-8 -*-
u"""Build app/public/data/us_etfs.json from FinLab (prices) + Nasdaq Trader (the registry).

    python scripts/fetch_us_etfs.py [out.json]

Why two sources: FinLab's `us_fund_price` covers ~10,000 funds but mixes ETFs with mutual
funds (the 5-letter tickers ending in X). Nasdaq Trader publishes an official file with an
explicit ETF flag but no prices. The intersection is the universe.

Returns come from `us_fund_price:adj_pct_change` compounded, NOT from the ratio of two
`adj_close` values. Those two agree for most funds but not all: JEPI's adj_close implies a
-1.95% one-year return while its daily adjusted returns compound to +3.83%. JEPI is a
covered-call income fund yielding ~7-8%, so the negative figure is wrong — its adj_close
series is missing distribution adjustments. The daily series is the one to trust.

There is deliberately **no 殖利率 column**. FinLab's `us_ratios:dividend_yield` covers
operating companies only (AAPL yes, SPY/JEPI/SCHD absent), and deriving yield from
total-return minus price-return gives 0.30% for SPY (actually ~1.1%) and a negative number
for JEPI. A wrong number is worse than an absent one.
"""
import io
import json
import os
import sys
import datetime
import warnings

warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    ROOT, 'app', 'public', 'data', 'us_etfs.json')

NASDAQ_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt'

# 交易日數。美股一年約 252 個交易日。
PERIODS = [('r3', 63), ('r6', 126), ('r12', 252), ('r36', 756), ('r60', 1260)]

# 日均成交金額門檻（美元）。實測分布：$5M -> 1103 檔、$10M -> 849、$15M -> 709、
# $30M -> 514。取 $15M 讓清單落在七百檔上下 —— 夠涵蓋各類主題，又濾掉幾乎沒人
# 交易、買賣價差極大的迷你 ETF。資料裡仍保留全部 3,690 檔，只是標記
# liquid=false，前端預設不顯示，使用者可以自己打開。
LIQUID_MIN_ADV = 15_000_000
ADV_WINDOW = 60                      # 用最近 60 個交易日算日均


def log(msg):
    print(msg, flush=True)


def load_registry():
    u"""Nasdaq Trader 的官方清單 -> {symbol: (name, exchange)}，只取 ETF。"""
    import urllib.request
    req = urllib.request.Request(NASDAQ_URL, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0 Safari/537.36'})
    raw = urllib.request.urlopen(req, timeout=60).read().decode('utf-8', 'ignore')

    lines = [l for l in raw.splitlines() if l.strip()]
    header = lines[0].split('|')
    idx = dict((h, i) for i, h in enumerate(header))
    for col in ('Symbol', 'Security Name', 'ETF', 'Listing Exchange'):
        if col not in idx:
            sys.exit('Nasdaq 檔案缺少欄位 %s：格式可能變了' % col)

    out = {}
    for line in lines[1:]:
        f = line.split('|')
        if len(f) <= idx['ETF'] or f[idx['ETF']] != 'Y':
            continue
        sym = f[idx['Symbol']].strip()
        if not sym or sym.startswith('File Creation'):
            continue
        name = f[idx['Security Name']].strip()
        # 名稱常常是 "SPDR S&P 500 ETF Trust" 這種，但也有帶 " - Class A" 的後綴
        out[sym] = (name, f[idx['Listing Exchange']].strip())
    return out


def compound(pct_series, days):
    u"""把每日還原報酬複利成期間累積報酬（%）。資料不足回傳 None。"""
    s = pct_series.dropna()
    if len(s) < days:
        return None
    window = s.iloc[-days:]
    total = (1.0 + window).prod() - 1.0
    if total != total:               # NaN
        return None
    return round(total * 100, 2)


def main():
    from finlab_client import login
    login()
    from finlab import data

    log('讀取 Nasdaq 官方 ETF 清單…')
    registry = load_registry()
    log('  官方標記為 ETF：%d 檔' % len(registry))

    log('讀取 FinLab 價格資料…')
    pct = data.get('us_fund_price:adj_pct_change')
    close = data.get('us_fund_price:close')
    volume = data.get('us_fund_price:volume')
    log('  價格矩陣：%d 個交易日 x %d 檔' % pct.shape)

    asof = pct.index.max()
    latest_close = close.iloc[-1]

    universe = sorted(set(registry) & set(pct.columns))
    log('  與官方清單交集：%d 檔' % len(universe))

    # 最新交易日沒有報價的視為已下市／停止交易
    alive = [t for t in universe if latest_close.get(t) == latest_close.get(t)]
    log('  最新交易日仍有報價：%d 檔' % len(alive))

    log('計算報酬率與日均成交金額…')
    dollar_vol = (volume[alive].iloc[-ADV_WINDOW:] * close[alive].iloc[-ADV_WINDOW:]).mean()

    rows = []
    for t in alive:
        name, exch = registry[t]
        row = {'code': t, 'name': name, 'exch': exch}
        for key, days in PERIODS:
            v = compound(pct[t], days)
            row[key] = 'N/A' if v is None else ('%.2f' % v)
        adv = dollar_vol.get(t)
        adv = 0.0 if adv != adv else float(adv)      # NaN -> 0
        row['adv'] = int(adv)
        row['liquid'] = adv >= LIQUID_MIN_ADV
        rows.append(row)

    rows.sort(key=lambda r: -r['adv'])
    liquid = sum(1 for r in rows if r['liquid'])

    doc = {
        'meta': {
            'updated': datetime.date.today().isoformat(),
            'asof': asof.strftime('%Y-%m-%d'),
            'total': len(rows),
            'liquid': liquid,
            'liquidMinAdv': LIQUID_MIN_ADV,
            'source': 'FinLab / Nasdaq Trader',
            'generated_by': 'fetch_us_etfs.py',
            # 前端要據此說明為什麼沒有殖利率
            'note': 'returns are total return (dividends reinvested), cumulative not annualised',
        },
        'etfs': rows,
    }

    d = os.path.dirname(OUT)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))

    log('')
    log('%s：%d 檔（有流動性 %d 檔，門檻日均成交金額 $%s）'
        % (OUT, len(rows), liquid, format(LIQUID_MIN_ADV, ',')))
    log('資料截至 %s' % doc['meta']['asof'])
    log('')
    log('成交金額分布（檔數）：')
    for th in (1e8, 5e7, 1e7, 5e6, 1e6, 1e5):
        n = sum(1 for r in rows if r['adv'] >= th)
        log('  >= $%-14s %5d' % (format(int(th), ','), n))
    log('')
    log('成交金額前 10 名：')
    for r in rows[:10]:
        log('  %-6s %-44s $%s  近1年 %s%%'
            % (r['code'], r['name'][:44], format(r['adv'], ','), r['r12']))


main()
