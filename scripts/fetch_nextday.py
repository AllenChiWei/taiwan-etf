# -*- coding: utf-8 -*-
u"""隔日加權指數漲跌幅：明天最高／最低／收盤可能到哪（給選擇權賣方挑偏離夠遠的履約價）。

    python scripts/fetch_nextday.py

寫到 app/public/data/nextday.json，**進版控**（每日更新流程的價平和那一塊順便跑，失敗只出警告）。

## 方法（2026-11-21 研究：D:/ai/_tmp/scripts_iso/nextday_study.py）

站在今天收盤看明天：H＝明天最高÷今收−1、L＝明天最低÷今收−1、C＝明天收盤÷今收−1。
比了三種估法，用 2023-11 以後約 3 年當樣本外：

    全歷史分位數        90% 區間上緣實際被突破 17%（應 10%）——波動大的時期整段失準
    近 20 日標準差調整  90% 13%／10%
    EWMA（λ=0.94）調整  90% 11%／9%、95% 6.3%／5.7%、99% 1.5%／1.7%   ← 採用

所以：先把每一天的 H、L、C 除以「當天的 EWMA 日標準差」變成倍數，取倍數的分位數，
再乘上今天的 EWMA 標準差。上下分開算（下跌的尾巴比較肥）。

**跨週末、連假要分開**：明天和今天差 3 個日曆日（週五→週一）、4 天以上（連假），
99% 倍數從 2.47 變 2.82、3.90。依「下一個交易日」決定用哪一組（證交所休市日 OpenAPI）。

## 資料

FinMind TaiwanStockPrice data_id=TAIEX（加權指數日線，2000 年起，一個請求；有 FINMIND_TOKEN 就帶）。
抓不到就不寫檔，網站保留前一版。
"""
import bisect
import io
import json
import math
import os
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'nextday.json')
TPE = timezone(timedelta(hours=8))
UA = {'User-Agent': 'Mozilla/5.0 (compatible; TaiwanETF/1.0; +https://allenchiwei.github.io/taiwan-etf/) next-day range'}
FINMIND_API = 'https://api.finmindtrade.com/api/v4/data'
FINMIND_TOKEN = os.environ.get('FINMIND_TOKEN', '').strip()
HOLIDAY_API = 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule'
LAMBDA = 0.94
PS = [0.90, 0.95, 0.99, 0.995, 0.999]
CHECK_YEARS = 3
SERIES_DAYS = 500              # 通道推移圖：最近幾個交易日
LIMIT = 0.10                     # 個股漲跌停 10%，指數一天不會超過


def log(m):
    print(m, flush=True)


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    return json.loads(urllib.request.urlopen(req, timeout=120).read().decode('utf-8'))


def load_taiex():
    params = {'dataset': 'TaiwanStockPrice', 'data_id': 'TAIEX', 'start_date': '2000-01-01',
              'end_date': datetime.now(TPE).date().isoformat()}
    if FINMIND_TOKEN:
        params['token'] = FINMIND_TOKEN
    doc = get_json(FINMIND_API + '?' + urllib.parse.urlencode(params))
    if doc.get('msg') != 'success':
        raise RuntimeError(u'FinMind 回應不是 success：%s' % str(doc.get('msg'))[:60])
    rows = []
    for r in doc.get('data') or []:
        h, l, c = float(r.get('max') or 0), float(r.get('min') or 0), float(r.get('close') or 0)
        if r.get('date') and 0 < l <= c <= h:
            rows.append((r['date'], h, l, c))
    rows.sort()
    if len(rows) < 3000:
        raise RuntimeError(u'FinMind 只回 %d 天' % len(rows))
    return rows


def holidays():
    u"""證交所休市日（名稱含「交易日」的是開始／最後交易日，不算休市）；抓不到回空集合（只扣週末）。"""
    out = set()
    try:
        for o in get_json(HOLIDAY_API):
            name, d = o.get('Name', ''), str(o.get('Date', '')).strip()
            if u'交易日' in name or len(d) < 7:
                continue
            out.add(date(int(d[:-4]) + 1911, int(d[-4:-2]), int(d[-2:])))
    except Exception as e:                                    # noqa: BLE001
        log(u'  ⚠ 休市日抓不到（%s），只扣週末' % str(e)[:60])
    return out


def next_trading_day(d, hol):
    x = d + timedelta(days=1)
    while x.weekday() >= 5 or x in hol:
        x += timedelta(days=1)
    return x


def regime_of(gap):
    return 'normal' if gap <= 2 else 'weekend' if gap == 3 else 'holiday'


def quantile(xs, p):
    u"""線性內插分位數（同 numpy 預設）"""
    s = sorted(xs)
    if not s:
        return float('nan')
    k = (len(s) - 1) * p
    f = int(math.floor(k))
    c = min(f + 1, len(s) - 1)
    return s[f] + (s[c] - s[f]) * (k - f)


def build(rows, hol, today=None):
    n = len(rows)
    ds = [r[0] for r in rows]
    cl = [r[3] for r in rows]
    # EWMA 日標準差（含當天報酬），前 60 天的變異數當起點
    rets = [0.0] + [cl[i] / cl[i - 1] - 1 for i in range(1, n)]
    v = sum(x * x for x in rets[1:61]) / 60
    sig = [float('nan')] * n
    for i in range(1, n):
        v = LAMBDA * v + (1 - LAMBDA) * rets[i] ** 2
        sig[i] = math.sqrt(v)
    # 第 i 天看第 i+1 天
    obs = []
    for i in range(61, n - 1):
        gap = (date.fromisoformat(ds[i + 1]) - date.fromisoformat(ds[i])).days
        obs.append({'i': i, 'd': ds[i], 'd1': ds[i + 1], 'reg': regime_of(gap), 's': sig[i],
                    'H': rows[i + 1][1] / cl[i] - 1, 'L': rows[i + 1][2] / cl[i] - 1, 'C': cl[i + 1] / cl[i] - 1})

    def zq(sample, reg):
        u"""某一組的倍數分位數 {p: (上, 下, |收盤|)}"""
        g = [o for o in sample if o['reg'] == reg]
        return len(g), dict((p, (quantile([o['H'] / o['s'] for o in g], p),
                                 quantile([o['L'] / o['s'] for o in g], 1 - p),
                                 quantile([abs(o['C']) / o['s'] for o in g], p))) for p in PS)

    regs = ('normal', 'weekend', 'holiday')
    zs = dict((r, zq(obs, r)) for r in regs)

    # 明天
    last = date.fromisoformat(ds[-1])
    nxt = next_trading_day(last, hol)
    reg = regime_of((nxt - last).days)
    s = sig[-1]
    cnt, z = zs[reg]
    bands = []
    for p in PS:
        up, dn, cc = z[p]
        bands.append({'p': p, 'up': round(min(up * s, LIMIT), 5), 'dn': round(max(dn * s, -LIMIT), 5),
                      'c': round(min(cc * s, LIMIT), 5)})

    # 樣本外驗證：最近 CHECK_YEARS 年，用之前的資料算倍數
    split = (last - timedelta(days=365 * CHECK_YEARS)).isoformat()
    train = [o for o in obs if o['d'] <= split]
    test = [o for o in obs if o['d'] > split]
    ztr = dict((r, zq(train, r)[1]) for r in regs)
    check = []
    for p in (0.90, 0.95, 0.99):
        eu = sum(1 for o in test if o['H'] > ztr[o['reg']][p][0] * o['s'])
        ed = sum(1 for o in test if o['L'] < ztr[o['reg']][p][1] * o['s'])
        check.append({'p': p, 'up': round(eu / len(test), 4), 'dn': round(ed / len(test), 4)})

    # 通道推移：最近 SERIES_DAYS 天，每天的 95%／99% 通道只用「那天收盤以前」已經知道的隔日資料
    # （obs[k] 的答案在 obs[k].d1 才知道，算第 j 天時 obs[0..j-1] 都已經知道）。各組各維護一份排好的倍數。
    def sq(sorted_xs, p):
        if not sorted_xs:
            return float('nan')
        k = (len(sorted_xs) - 1) * p
        f = int(math.floor(k))
        c = min(f + 1, len(sorted_xs) - 1)
        return sorted_xs[f] + (sorted_xs[c] - sorted_xs[f]) * (k - f)

    known = dict((r, ([], [])) for r in regs)          # 組 → (H 倍數, L 倍數)，排好的
    start = max(0, len(obs) - SERIES_DAYS)
    for o in obs[:start]:
        bisect.insort(known[o['reg']][0], o['H'] / o['s'])
        bisect.insort(known[o['reg']][1], o['L'] / o['s'])

    def channel(reg_, s_, base):
        hz, lz = known[reg_]
        return dict((k, round(base * (1 + v), 1)) for k, v in (
            ('u95', min(sq(hz, 0.95) * s_, LIMIT)), ('d95', max(sq(lz, 0.05) * s_, -LIMIT)),
            ('u99', min(sq(hz, 0.99) * s_, LIMIT)), ('d99', max(sq(lz, 0.01) * s_, -LIMIT))))

    def learn(o):
        bisect.insort(known[o['reg']][0], o['H'] / o['s'])
        bisect.insort(known[o['reg']][1], o['L'] / o['s'])

    series, recent = [], []
    for j in range(start, len(obs)):
        o = obs[j]
        if j > start:
            learn(obs[j - 1])                          # 前一天的答案今天收盤時已經知道
        base = cl[o['i']]
        ch = channel(o['reg'], o['s'], base)
        series.append(dict({'d': o['d1'], 'b': base, 'h': rows[o['i'] + 1][1], 'l': rows[o['i'] + 1][2],
                            'c': cl[o['i'] + 1], 'r': o['reg'][0]}, **ch))
        if j >= len(obs) - 10:
            recent.append({'d': o['d'], 'd1': o['d1'], 'close': base, 'reg': o['reg'],
                           'H': round(o['H'], 5), 'L': round(o['L'], 5), 'C': round(o['C'], 5),
                           'up95': round(ch['u95'] / base - 1, 5), 'dn95': round(ch['d95'] / base - 1, 5),
                           'up99': round(ch['u99'] / base - 1, 5), 'dn99': round(ch['d99'] / base - 1, 5)})
    # 最後一點：明天（還沒有答案），用全部資料
    if obs:
        learn(obs[-1])

    def ext(key, best):
        o = best(obs, key=lambda x: x[key])
        return {'v': round(o[key], 5), 'd': o['d'], 'd1': o['d1']}

    return {
        'meta': {
            'updated': (today or datetime.now(TPE).date()).isoformat(),
            'date': ds[-1], 'close': cl[-1], 'next': nxt.isoformat(), 'gap': (nxt - last).days, 'regime': reg,
            'sigma': round(s, 5), 'lambda': LAMBDA, 'since': ds[0], 'samples': cnt,
            'counts': dict((r, zs[r][0]) for r in regs),
            'mult99': dict((r, [round(zs[r][1][0.99][0], 3), round(zs[r][1][0.99][1], 3)]) for r in regs),
            'limit': LIMIT, 'checkFrom': split, 'checkDays': len(test),
            'source': u'FinMind TaiwanStockPrice TAIEX（加權指數日線）；休市日：證交所 OpenAPI',
        },
        'bands': bands,
        'check': check,
        'recent': recent,
        # 通道推移圖：d＝那一天（被預測的日子），b＝前一日收盤，h/l/c＝實際，u95/d95/u99/d99＝當時估的通道（點位），
        # r＝n 一般／w 跨週末／h 連假。最後一列是明天（f＝1，沒有 h/l/c）
        'series': series + [dict({'d': nxt.isoformat(), 'b': cl[-1], 'r': reg[0], 'f': 1}, **channel(reg, s, cl[-1]))],
        'extremes': {'H': ext('H', max), 'L': ext('L', min), 'Cup': ext('C', max), 'Cdn': ext('C', min)},
    }


def main():
    try:
        rows = load_taiex()
    except Exception as e:                                    # noqa: BLE001
        log(u'⚠ 加權指數日線抓不到（%s），nextday.json 保留前一版' % str(e)[:80])
        return 0
    doc = build(rows, holidays())
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))
    m = doc['meta']
    b99 = next(b for b in doc['bands'] if b['p'] == 0.99)
    log(u'%s：%s 收 %.2f → 下一個交易日 %s（%s，EWMA %.2f%%）；99%% 最高 %+.2f%%、最低 %+.2f%%；'
        u'樣本外 99%% 突破 上 %.2f%%／下 %.2f%%'
        % (OUT, m['date'], m['close'], m['next'], m['regime'], m['sigma'] * 100, b99['up'] * 100, b99['dn'] * 100,
           doc['check'][2]['up'] * 100, doc['check'][2]['dn'] * 100))
    return 0


if __name__ == '__main__':
    sys.exit(main())
