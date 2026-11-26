# -*- coding: utf-8 -*-
u"""民生必需股的建議持有價（便宜／合理／昂貴價）。

    python scripts/fetch_defensive.py

寫到 app/public/data/defensive.json，**進版控**（每日更新流程的個股那一步順便跑，失敗只出警告）。
2026-11-21 站主：「增加一些民生必需品的股票，看建議持有價等條件，例如中華電／遠傳／台哥大」。

## 怎麼估（主：殖利率區間；參考：本益比、淨值比區間、傳統股利法）

民生股長期殖利率多在 3～5%，傳統「股利法」（平均股利 × 16／20／32，＝殖利率 6.25%／5%／3.125%）
套在中華電上便宜價只有 80 幾元、十幾年都碰不到 → 改用**這檔自己近 10 年的殖利率分布**（殖利率河流）：
    便宜價＝最近一次全年現金股利 ÷ 近 10 年殖利率的第 80 百分位（殖利率高＝股價相對便宜）
    合理價＝÷ 第 50 百分位；昂貴價＝÷ 第 20 百分位
本益比、淨值比同理（近 10 年第 20／50／80 百分位 × 目前的 EPS／每股淨值），傳統股利法也列著當參考。
殖利率、本益比、淨值比來自 FinMind TaiwanStockPER（＝證交所／櫃買每日公布的值），股利 TaiwanStockDividend，股價 TaiwanStockPrice。

只是歷史區間的位置，不是買賣建議；公司基本面變了（例：電信降價戰、燃氣調價），歷史區間就不一定適用。
"""
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'defensive.json')
TPE = timezone(timedelta(hours=8))
API = 'https://api.finmindtrade.com/api/v4/data'
TOKEN = os.environ.get('FINMIND_TOKEN', '').strip()
UA = {'User-Agent': 'Mozilla/5.0 (compatible; TaiwanETF/1.0; +https://allenchiwei.github.io/taiwan-etf/) defensive stocks'}
YEARS = 10
PCT = (0.2, 0.5, 0.8)

# 民生必需：電信、食品、零售通路、燃氣公用、保全、交通（站主 2026-11-21 舉例中華電／遠傳／台哥大）
STOCKS = [
    ('2412', u'電信'), ('3045', u'電信'), ('4904', u'電信'),
    ('1216', u'食品'), ('1232', u'食品'), ('1210', u'食品'), ('1215', u'食品'),
    ('2912', u'零售通路'), ('5903', u'零售通路'),
    ('9908', u'燃氣公用'), ('9918', u'燃氣公用'), ('9926', u'燃氣公用'), ('8926', u'燃氣公用'),
    ('9917', u'保全'), ('9925', u'保全'), ('2633', u'交通'),
]


def log(m):
    print(m, flush=True)


def fm(ds, code, start):
    q = {'dataset': ds, 'data_id': code, 'start_date': start}
    if TOKEN:
        q['token'] = TOKEN
    for attempt in range(3):
        try:
            req = urllib.request.Request(API + '?' + urllib.parse.urlencode(q), headers=UA)
            d = json.loads(urllib.request.urlopen(req, timeout=60).read().decode('utf-8'))
            if d.get('msg') != 'success':
                raise RuntimeError(str(d.get('msg'))[:80])
            return d.get('data') or []
        except Exception as e:                                # noqa: BLE001
            if attempt == 2:
                raise
            log(u'  重試 %s %s：%s' % (ds, code, str(e)[:60]))
            time.sleep(3 * (attempt + 1))


def quantile(xs, p):
    s = sorted(xs)
    if not s:
        return None
    k = (len(s) - 1) * p
    f = int(k)
    c = min(f + 1, len(s) - 1)
    return s[f] + (s[c] - s[f]) * (k - f)


def rank(xs, x):
    return sum(1 for v in xs if v <= x) / len(xs) if xs else None


def one(code, cat, today):
    start10 = (today - timedelta(days=365 * YEARS)).isoformat()
    per = [r for r in fm('TaiwanStockPER', code, start10) if r.get('date')]
    px = fm('TaiwanStockPrice', code, (today - timedelta(days=400)).isoformat())
    dv = fm('TaiwanStockDividend', code, '2000-01-01')
    if not px or not per:
        raise RuntimeError(u'沒有股價或本益比資料')
    price = float(px[-1]['close'])
    pdate = px[-1]['date']
    closes = [float(r['close']) for r in px if r.get('close')]
    last250 = closes[-250:]
    # 每年現金股利（依除息日的年份合計；同年多次配息加總）
    by_year = {}
    for r in dv:
        cash = float(r.get('CashEarningsDistribution') or 0) + float(r.get('CashStatutorySurplus') or 0)
        d = r.get('CashExDividendTradingDate') or r.get('date') or ''
        if cash > 0 and len(d) >= 4:
            by_year[d[:4]] = round(by_year.get(d[:4], 0) + cash, 4)
    years = sorted(by_year)
    this_year = str(today.year)
    done_years = [y for y in years if y < this_year]
    last_div = by_year.get(this_year) or (by_year[done_years[-1]] if done_years else None)   # 最近一次全年現金股利
    avg5 = sum(by_year[y] for y in done_years[-5:]) / len(done_years[-5:]) if done_years else None
    streak, y = 0, today.year if this_year in by_year else today.year - 1
    while str(y) in by_year:
        streak += 1
        y -= 1
    ys = [float(r['dividend_yield']) for r in per if r.get('dividend_yield') and float(r['dividend_yield']) > 0]
    pes = [float(r['PER']) for r in per if r.get('PER') and float(r['PER']) > 0]
    pbs = [float(r['PBR']) for r in per if r.get('PBR') and float(r['PBR']) > 0]
    now = per[-1]
    pe_now, pb_now = float(now.get('PER') or 0), float(now.get('PBR') or 0)

    def band(base, qs, invert=False):
        if not base or not qs:
            return None
        q = [quantile(qs, p) for p in PCT]
        if invert:                                            # 殖利率：高殖利率＝便宜
            return {'cheap': round(base / (q[2] / 100), 2), 'fair': round(base / (q[1] / 100), 2), 'rich': round(base / (q[0] / 100), 2),
                    'q': [round(v, 2) for v in q]}
        return {'cheap': round(base * q[0], 2), 'fair': round(base * q[1], 2), 'rich': round(base * q[2], 2), 'q': [round(v, 2) for v in q]}

    y_now = last_div / price * 100 if last_div else None
    out = {
        'c': code, 'cat': cat, 'price': price, 'pdate': pdate,
        'chg1y': round(price / closes[-250] - 1, 4) if len(closes) >= 250 else None,
        'hi52': max(last250) if last250 else None, 'lo52': min(last250) if last250 else None,
        'div': last_div, 'divYear': this_year if this_year in by_year else (done_years[-1] if done_years else None),
        'avg5': round(avg5, 3) if avg5 else None, 'streak': streak,
        'streakMin': bool(years) and streak >= len([y for y in years if y <= (this_year if this_year in by_year else str(today.year - 1))]),   # 從資料第一年就連續＝實際可能更久
        'divs': [[y, by_year[y]] for y in years[-8:]],
        'yield': round(y_now, 2) if y_now else None,
        'yieldRank': round(rank(ys, y_now), 3) if y_now and ys else None,      # 現在殖利率在 10 年裡的百分位（高＝便宜）
        'pe': pe_now or None, 'pb': pb_now or None,
        'peRank': round(rank(pes, pe_now), 3) if pe_now and pes else None,
        'pbRank': round(rank(pbs, pb_now), 3) if pb_now and pbs else None,
        'byYield': band(last_div, ys, invert=True),
        'byPe': band(price / pe_now if pe_now else None, pes),
        'byPb': band(price / pb_now if pb_now else None, pbs),
        'byClassic': {'cheap': round(avg5 * 16, 2), 'fair': round(avg5 * 20, 2), 'rich': round(avg5 * 32, 2)} if avg5 else None,
        'since': per[0]['date'],
    }
    return out


def main():
    today = datetime.now(TPE).date()
    names = {}
    try:                                                      # 名稱、產業用網站自己的全市場本益比檔（部署時產生）
        pe = json.loads(urllib.request.urlopen(urllib.request.Request(
            'https://allenchiwei.github.io/taiwan-etf/data/stocks/pe.json', headers=UA), timeout=60).read().decode('utf-8'))
        names = dict((r['c'], (r['n'], r.get('m'), r.get('i'))) for r in pe.get('rows') or [])
    except Exception as e:                                    # noqa: BLE001
        log(u'  ⚠ pe.json 讀不到（%s），名稱用代號' % str(e)[:60])
    rows, errors = [], []
    for code, cat in STOCKS:
        try:
            r = one(code, cat, today)
            n = names.get(code)
            r['n'], r['m'], r['i'] = (n[0], n[1], n[2]) if n else (code, None, None)
            rows.append(r)
            log(u'%s %s %.2f 殖利率 %s%%（10 年第 %s 百分位）便宜 %s 合理 %s 昂貴 %s'
                % (code, r['n'], r['price'], r['yield'], None if r['yieldRank'] is None else round(r['yieldRank'] * 100),
                   (r['byYield'] or {}).get('cheap'), (r['byYield'] or {}).get('fair'), (r['byYield'] or {}).get('rich')))
        except Exception as e:                                # noqa: BLE001
            errors.append(u'%s：%s' % (code, str(e)[:80]))
            log(u'  ⚠ %s 失敗：%s' % (code, str(e)[:80]))
        time.sleep(0.5)
    if len(rows) < len(STOCKS) // 2:
        log(u'⚠ 成功不到一半（%d/%d），defensive.json 保留前一版' % (len(rows), len(STOCKS)))
        return 0
    doc = {'meta': {'updated': today.isoformat(), 'date': max(r['pdate'] for r in rows), 'years': YEARS, 'pct': list(PCT),
                    'source': u'FinMind TaiwanStockPER（證交所／櫃買每日殖利率、本益比、淨值比）、TaiwanStockDividend、TaiwanStockPrice',
                    'errors': errors},
           'rows': rows}
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))
    log(u'%s：%d 檔' % (OUT, len(rows)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
