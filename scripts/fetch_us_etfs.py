# -*- coding: utf-8 -*-
u"""Build app/public/data/us_etfs.json from FinLab (prices) + Nasdaq Trader (the registry).

    python scripts/fetch_us_etfs.py [out.json]

Why two sources: FinLab's `us_fund_price` covers ~10,000 funds but mixes ETFs with mutual
funds (the 5-letter tickers ending in X). Nasdaq Trader publishes an official file with an
explicit ETF flag but no prices. The intersection is the universe.

**These are PRICE returns, not total returns.** FinLab's `us_fund_price` is a price
series: at the start of the history adj_close equals close exactly for every fund, and at
the end the ratio is only 1.020 for QYLD — after ten years of ~12% annual distributions a
dividend-adjusted series would be near 3.1. The adjustment covers splits, not payouts.

The gap that causes is large. MoneyDJ (which states its figures include distributions)
puts QYLD's five-year return at +47.61%; the price-only figure here is -12.66%, a 60
percentage point difference. Index funds barely differ, high-yield funds differ hugely.

Computing true total return needs a distribution history, and no source we can use has
full coverage: FinLab has none for funds, and Nasdaq's dividend endpoint returns 152 rows
for QYLD but zero for SPY, JEPI and SCHD (verified repeatedly — not rate limiting). So the
column is labelled as price return in the UI rather than quietly being wrong.

There is likewise no 殖利率 column: the same missing distribution data.
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

# 通過金額門檻還不夠，還要有夠長的歷史才算 liquid。兩個理由：只有幾天資料的標的，
# 它的「日均」其實是那幾天的平均；而且算不出近 3 月報酬，進了預設畫面就是一整排 N/A。
#
# 2026-09-22 踩過：FinLab 一夜之間把 us_fund_price 從 10,097 檔擴到 11,981 檔
# （連 AAAU 這種 2018 年就上市、先前沒收的都補進來了），多出的 1,924 檔大多只有
# 幾天價格。其中 165 檔通過金額門檻卻沒有近 3 月報酬，verify_us_data.py 的
# 「liquid 缺 r3 超過一成」因此擋下整次更新 —— 那條規則本來是要抓價格矩陣壞掉。
LIQUID_MIN_DAYS = 64                 # 算得出近 3 月報酬所需的價格點數（63 個交易日 + 1）


def log(msg):
    print(msg, flush=True)


def load_registry():
    u"""Nasdaq Trader 的官方清單 -> {symbol: (name, exchange)}，只取 ETF。"""
    import urllib.request
    req = urllib.request.Request(NASDAQ_URL, headers={
        'User-Agent': ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
                       '+https://allenchiwei.github.io/taiwan-etf/) US ETF registry')})
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
    u"""每日報酬連乘成期間累積報酬（%）。只有 adj_close 取不到時才用。"""
    s = pct_series.dropna()
    if len(s) < days:
        return None
    total = (1.0 + s.iloc[-days:]).prod() - 1.0
    if total != total:
        return None
    return round(total * 100, 2)


def period_return(close_series, days):
    u"""還原收盤價 -> 期間累積報酬（%）。資料不足回傳 None。

    原本是抓 `us_fund_price:adj_pct_change`（每日報酬）再連乘。但每日報酬連乘會
    telescoping 成頭尾價格的比值，所以從 `adj_close` 直接除就好 —— 結果一樣，
    卻少抓一個 133 MB 的資料集（那是所有資料集裡最大的一個，佔每日 FinLab
    下載量約四分之一）。

    days 是「幾個交易日的報酬」，所以需要 days+1 個價格點。
    """
    s = close_series.dropna()
    if len(s) < days + 1:
        return None
    first = float(s.iloc[-(days + 1)])
    last = float(s.iloc[-1])
    if first <= 0 or last != last or first != first:
        return None
    return round((last / first - 1.0) * 100, 2)


def main():
    from finlab_client import login
    login()
    from finlab import data

    log('讀取 Nasdaq 官方 ETF 清單…')
    registry = load_registry()
    log('  官方標記為 ETF：%d 檔' % len(registry))

    log('讀取 FinLab 價格資料…')
    # 只抓三個資料集：報酬率從 adj_close 自己算（見 period_return），
    # 不再抓 adj_pct_change —— 那是最大的一個（133 MB），而且是可以推導的。
    #
    # 退路：舊版 finlab（本機那套 0.4.3）解析 us_fund_price:adj_close 會找錯 bucket，
    # 取不到就退回原本的每日報酬資料集。結果一樣，只是那天多下載 133 MB。
    adj = pct = None
    try:
        adj = data.get('us_fund_price:adj_close')
    except Exception as e:                           # noqa: BLE001
        log('  取不到 adj_close（%s），退回 adj_pct_change' % str(e)[:60])
        pct = data.get('us_fund_price:adj_pct_change')
    close = data.get('us_fund_price:close')
    volume = data.get('us_fund_price:volume')
    frame = adj if adj is not None else pct
    log('  價格矩陣：%d 個交易日 x %d 檔' % frame.shape)

    asof = frame.index.max()
    latest_close = close.iloc[-1]

    universe = sorted(set(registry) & set(frame.columns))
    log('  與官方清單交集：%d 檔' % len(universe))

    # 最新交易日沒有報價的視為已下市／停止交易
    alive = [t for t in universe if latest_close.get(t) == latest_close.get(t)]
    log('  最新交易日仍有報價：%d 檔' % len(alive))

    log('計算報酬率與日均成交金額…')
    # 成交量或價格是負的那幾天是來源的壞點（2026-09-24 XNDX 就算出 -173 萬），
    # 當成缺值不算進平均，免得一檔壞資料讓整份美股清單擱置。
    daily = volume[alive].iloc[-ADV_WINDOW:] * close[alive].iloc[-ADV_WINDOW:]
    dollar_vol = daily.where(daily >= 0).mean()
    # 歷史長度算在報價上（close），與報酬率用的 adj 分開 —— 這樣「close 有、adj 沒有」
    # 那種矩陣壞法仍然會被驗證器的 liquid 缺 r3 規則抓到。
    history = close[alive].notna().sum()

    rows = []
    for t in alive:
        name, exch = registry[t]
        row = {'code': t, 'name': name, 'exch': exch}
        for key, days in PERIODS:
            v = (period_return(adj[t], days) if adj is not None
                 else compound(pct[t], days))
            row[key] = 'N/A' if v is None else ('%.2f' % v)
        adv = dollar_vol.get(t)
        adv = 0.0 if adv != adv else float(adv)      # NaN -> 0
        row['adv'] = int(adv)
        row['liquid'] = (adv >= LIQUID_MIN_ADV
                         and int(history.get(t, 0)) >= LIQUID_MIN_DAYS)
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
            'liquidMinDays': LIQUID_MIN_DAYS,
            'source': 'FinLab / Nasdaq Trader',
            'generated_by': 'fetch_us_etfs.py',
            # 前端據此標示欄位意義。改成含息的總報酬時，這裡也要一起改。
            'note': 'PRICE returns, excluding distributions; cumulative, not annualised',
            'returnBasis': 'price',
        },
        'etfs': rows,
    }

    d = os.path.dirname(OUT)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))

    log('')
    log('%s：%d 檔（有流動性 %d 檔，門檻日均成交金額 $%s、歷史至少 %d 個交易日）'
        % (OUT, len(rows), liquid, format(LIQUID_MIN_ADV, ','), LIQUID_MIN_DAYS))
    short = sum(1 for t in alive if int(history.get(t, 0)) < LIQUID_MIN_DAYS)
    if short:
        log('  其中 %d 檔資料不足 %d 個交易日，不列為有流動性' % (short, LIQUID_MIN_DAYS))
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


if __name__ == '__main__':
    # 這支腳本原本在模組層級直接呼叫 main()，import 進來就會整支跑起來
    # （測試 period_return 時真的打了一次 FinLab）。加上保護。
    main()
