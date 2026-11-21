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

import numpy as np                       # 狀態調整的 OLS（每日更新流程裝 finlab 時就有 numpy）
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
MAINT_LOW = 165                  # 大盤融資維持率（證交所口徑）低於這個數＝低維持率日；網站 11-07 起維持率一律證交所口徑，
                                 # 研究的自算 160 換算（官方 ≈ 23.55＋0.885×自算）＝165＝籌碼頁「正常區」下緣 MAINT_T.calm
MAINT_CALL = 139                 # 同上換算自算 140＝籌碼頁 MAINT_T.call（斷頭區）
CHIPS_URL = 'https://allenchiwei.github.io/taiwan-etf/data/chips.json'
ATM_PATH = os.path.join(ROOT, 'app', 'public', 'data', 'atm.json')


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
            rows.append((r['date'], h, l, c, float(r.get('open') or 0) or None))
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


def load_maint():
    u"""{日期: 大盤融資維持率（證交所口徑）}，從網站 chips.json 的 margin.keepHist（官方＋換算，2009 起；網站所有維持率都用這個）。
    抓不到回 {}（不做維持率調整）"""
    try:
        doc = get_json(CHIPS_URL)
        return dict((r[0], float(r[1])) for r in (doc.get('margin') or {}).get('keepHist') or [] if r[1])
    except Exception as e:                                    # noqa: BLE001
        log(u'  ⚠ 融資維持率抓不到（%s），不做維持率調整' % str(e)[:60])
        return {}


def load_iv():
    u"""{日期: 選擇權隱含的日波動}，從 atm.json（同一步驟剛更新）：最近到期合約（r＝0、未到期、配對夠）的價平和
    ÷ (0.8 × 加權指數 × √到期交易日數)（ATM 跨式 ≈ 0.8·S·σ·√T；日曆天 × 5/7 當交易日）。週三、週五兩個系列取較小（較近的）。
    2026-11-21 研究（D:/ai/_tmp/scripts_iso/nextday_iv_study.py）：預測隔日振幅 R² 0.40，EWMA 0.16；美國 VIX 比 EWMA 差（不用）"""
    try:
        atm = json.load(io.open(ATM_PATH, encoding='utf-8'))
    except Exception as e:                                    # noqa: BLE001
        log(u'  ⚠ atm.json 讀不到（%s），不用隱含波動' % str(e)[:60])
        return {}
    tx = atm.get('taiex') or {}
    out = {}
    for r in atm.get('rows') or []:
        if r.get('r') != 0 or (r.get('dte') or 0) <= 0 or r.get('thin') or r.get('d') not in tx or not r.get('sum'):
            continue
        s = r['sum'] / (0.8 * tx[r['d']] * math.sqrt(max(1.0, r['dte'] * 5.0 / 7)))
        out[r['d']] = min(out.get(r['d'], 9.0), s)
    return out


# ── 狀態調整（2026-11-21 使用者：增加預測隔日漲跌的數據、看 IC）────────────────
# IC 研究（D:/ai/_tmp/scripts_iso/nextday_ic.py，2009 起逐年 Spearman）：在已經除以 EWMA 之後，
#   下檔（隔日最大跌幅÷σ）：維持率 1 日變化 −0.080（18 年 89% 同號）、今天報酬 −0.077（94%）、今天跳空 −0.072、下跌家數占比 +0.069（94%）；
#   上檔（隔日最大漲幅÷σ）：5 日報酬 −0.086（94%）、維持率 5 日變化 −0.085、收盤位置 −0.081；EWMA 本身 −0.07（大波動後 EWMA 偏大）。
# 做法：log(倍數) 對這些特徵做 OLS → 調整係數 exp(Σβ·標準化x)（夾在 0.6～2.0）；倍數分位改用「倍數÷調整係數」。
# 樣本外（nextday_model.py，2009～2019 估、2020～ 測 1,671 天；2009～2016 估、2017～ 測）：12 組分位數損失全部下降 1.4～9.7%，
#   壓力日（大跌 2% 或維持率掉 2 點）的突破率下降（下緣 95% 10.2%→8.6%），平常日區間平均窄 5～10%。
FEAT_DN = ('dkeep1', 'ret', 'gapo', 'dnshare', 'lsig', 'wk')
FEAT_UP = ('ret5', 'dkeep5', 'clv', 'dnshare', 'lsig', 'wk')
FEAT_LABEL = {'dkeep1': u'維持率今天變化', 'ret': u'今天漲跌', 'gapo': u'今天跳空', 'dnshare': u'下跌家數占比',
              'lsig': u'近期波動水準', 'wk': u'隔天跨週末', 'ret5': u'5 日漲跌', 'dkeep5': u'維持率 5 日變化', 'clv': u'收盤位置'}
FAC_MIN, FAC_MAX = 1.0, 2.0          # 只放寬不收窄：0.6 版最近 3 年樣本外突破率變高（平常日收太窄），賣方不能接受


def load_chips():
    u"""網站 chips.json（部署流程每天更新）；抓不到回 {}（不做維持率與漲跌家數相關的調整）"""
    try:
        return get_json(CHIPS_URL)
    except Exception as e:                                    # noqa: BLE001
        log(u'  ⚠ 籌碼資料（chips.json）抓不到（%s），不做維持率與漲跌家數調整' % str(e)[:60])
        return {}


def fit_model(sample, feats, side):
    u"""log(max(倍數, 0.1)) 對特徵做 OLS；回 (平均, 標準差, 係數) 或 None"""
    xs, ys = [], []
    for o in sample:
        x = o['x']
        if x is None or any(x.get(k) is None for k in feats):
            continue
        z = o['H'] / o['s'] if side == 'u' else -o['L'] / o['s']
        xs.append([x[k] for k in feats]); ys.append(math.log(max(z, 0.1)))
    if len(xs) < 500:
        return None
    X = np.array(xs, float); y = np.array(ys, float)
    mu, sd = X.mean(0), X.std(0)
    sd[sd == 0] = 1
    A = np.c_[np.ones(len(X)), (X - mu) / sd]
    beta = np.linalg.lstsq(A, y, rcond=None)[0]
    return mu, sd, beta, feats


def model_fac(model, x):
    if model is None or x is None or any(x.get(k) is None for k in model[3]):
        return 1.0, []
    mu, sd, beta, feats = model
    zx = (np.array([x[k] for k in feats], float) - mu) / sd
    contrib = beta[1:] * zx
    f = float(np.exp(contrib.sum()))
    return min(FAC_MAX, max(FAC_MIN, f)), [(feats[k], float(contrib[k]), float(x[feats[k]])) for k in range(len(feats))]


def build(rows, hol, today=None, maint=None, iv=None, chips=None):
    n = len(rows)
    ds = [r[0] for r in rows]
    cl = [r[3] for r in rows]
    hi = [r[1] for r in rows]
    lo = [r[2] for r in rows]
    op = [r[4] if len(r) > 4 else None for r in rows]
    chips = chips or {}
    if maint is None:
        maint = dict((r[0], float(r[1])) for r in (chips.get('margin') or {}).get('keepHist') or [] if r[1])
    breadth = dict((r[0], r[2] / (r[1] + r[2])) for r in (chips.get('tw') or {}).get('breadth') or [] if (r[1] + r[2]) > 0)
    # 每天的融資維持率：當天的；還沒公布（晚上才有）就用最近 5 個日曆日內的前一筆
    mt, md = [None] * n, [None] * n
    last_m, last_d = None, None
    for i, dd in enumerate(ds):
        if dd in maint:
            last_m, last_d = maint[dd], dd
        if last_d and (date.fromisoformat(dd) - date.fromisoformat(last_d)).days <= 5:
            mt[i], md[i] = last_m, last_d
    # EWMA 日標準差（含當天報酬），前 60 天的變異數當起點
    rets = [0.0] + [cl[i] / cl[i - 1] - 1 for i in range(1, n)]
    v = sum(x * x for x in rets[1:61]) / 60
    sig = [float('nan')] * n
    for i in range(1, n):
        v = LAMBDA * v + (1 - LAMBDA) * rets[i] ** 2
        sig[i] = math.sqrt(v)

    def feats_at(i, wk):
        u"""第 i 天收盤時已知的特徵（缺的是 None）"""
        if i < 5:
            return None
        def dk(k):
            return mt[i] - mt[i - k] if mt[i] is not None and mt[i - k] is not None else None
        return {'dkeep1': dk(1), 'dkeep5': dk(5), 'ret': cl[i] / cl[i - 1] - 1,
                'gapo': op[i] / cl[i - 1] - 1 if op[i] else None, 'dnshare': breadth.get(ds[i]),
                'lsig': math.log(sig[i]), 'wk': 1.0 if wk else 0.0, 'ret5': cl[i] / cl[i - 5] - 1,
                'clv': (cl[i] - lo[i]) / (hi[i] - lo[i]) if hi[i] > lo[i] else None}

    # 第 i 天看第 i+1 天
    obs = []
    for i in range(61, n - 1):
        gap = (date.fromisoformat(ds[i + 1]) - date.fromisoformat(ds[i])).days
        obs.append({'i': i, 'd': ds[i], 'd1': ds[i + 1], 'reg': regime_of(gap), 's': sig[i], 'm': mt[i],
                    'low': mt[i] is not None and mt[i] < MAINT_LOW, 'x': feats_at(i, gap >= 3), 'fu': 1.0, 'fd': 1.0,
                    'H': rows[i + 1][1] / cl[i] - 1, 'L': rows[i + 1][2] / cl[i] - 1, 'C': cl[i + 1] / cl[i] - 1})

    def set_fac(mu_, md_):
        for o in obs:
            o['fu'] = model_fac(mu_, o['x'])[0]
            o['fd'] = model_fac(md_, o['x'])[0]

    def zq(sample, reg, adj=True):
        u"""某一組的倍數分位數 {p: (上, 下, |收盤|)}；adj＝倍數先除以狀態調整係數"""
        g = [o for o in sample if o['reg'] == reg]
        fu = (lambda o: o['fu']) if adj else (lambda o: 1.0)
        fd = (lambda o: o['fd']) if adj else (lambda o: 1.0)
        return len(g), dict((p, (quantile([o['H'] / o['s'] / fu(o) for o in g], p),
                                 quantile([o['L'] / o['s'] / fd(o) for o in g], 1 - p),
                                 quantile([abs(o['C']) / o['s'] / max(fu(o), fd(o)) for o in g], p))) for p in PS)

    regs = ('normal', 'weekend', 'holiday')
    last = date.fromisoformat(ds[-1])
    nxt = next_trading_day(last, hol)
    reg = regime_of((nxt - last).days)
    iv = iv or {}
    s_e = sig[-1]
    iv_now = iv.get(ds[-1])
    s = max(s_e, iv_now) if iv_now else s_e

    # ── 明天：模型用全部資料估 ──
    m_up, m_dn = fit_model(obs, FEAT_UP, 'u'), fit_model(obs, FEAT_DN, 'd')
    set_fac(m_up, m_dn)
    zs = dict((r, zq(obs, r)) for r in regs)
    zs_raw = dict((r, zq(obs, r, adj=False)) for r in regs)
    x_now = feats_at(n - 1, (nxt - last).days >= 3)
    fu_now, why_u = model_fac(m_up, x_now)
    fd_now, why_d = model_fac(m_dn, x_now)
    cnt, z = zs[reg]
    z0 = zs_raw[reg][1]
    bands = []
    for p in PS:
        up, dn, cc = z[p]
        u0, d0, _ = z0[p]
        bands.append({'p': p, 'up': round(min(up * fu_now * s, LIMIT), 5), 'dn': round(max(dn * fd_now * s, -LIMIT), 5),
                      'c': round(min(cc * max(fu_now, fd_now) * s, LIMIT), 5),
                      'up0': round(min(u0 * s, LIMIT), 5), 'dn0': round(max(d0 * s, -LIMIT), 5),
                      'upE': round(min(u0 * s_e, LIMIT), 5), 'dnE': round(max(d0 * s_e, -LIMIT), 5)})

    # 隱含波動的驗證（不含狀態調整，看隱含波動本身）
    iv_check = []
    iv_obs = [o for o in obs if o['d'] in iv and o['reg'] != 'holiday']
    if iv_obs:
        first = min(o['d'] for o in iv_obs)
        zpre = dict((r, zq([o for o in obs if o['d1'] < first], r, adj=False)[1]) for r in ('normal', 'weekend'))
        for p in (0.90, 0.95, 0.99):
            def rate(fn):
                return (round(sum(1 for o in iv_obs if o['H'] > zpre[o['reg']][p][0] * fn(o)) / len(iv_obs), 4),
                        round(sum(1 for o in iv_obs if o['L'] < zpre[o['reg']][p][1] * fn(o)) / len(iv_obs), 4))
            ue, de = rate(lambda o: o['s'])
            um, dm = rate(lambda o: max(o['s'], iv[o['d']]))
            iv_check.append({'p': p, 'upE': ue, 'dnE': de, 'up': um, 'dn': dm})

    # 樣本外驗證：最近 CHECK_YEARS 年；模型與倍數都只用之前的資料。up0/dn0＝沒有狀態調整；stress＝大跌 2% 或維持率一天掉 2 點的日子
    split = (last - timedelta(days=365 * CHECK_YEARS)).isoformat()
    train = [o for o in obs if o['d'] <= split]
    test = [o for o in obs if o['d'] > split]
    set_fac(fit_model(train, FEAT_UP, 'u'), fit_model(train, FEAT_DN, 'd'))
    ztr = dict((r, zq(train, r)[1]) for r in regs)
    ztr0 = dict((r, zq(train, r, adj=False)[1]) for r in regs)
    stress = [o for o in test if o['x'] and (o['x']['ret'] <= -0.02 or (o['x']['dkeep1'] is not None and o['x']['dkeep1'] <= -2))]

    def brk(sample, p, adj):
        if not sample:
            return None, None
        zt = ztr if adj else ztr0
        return (round(sum(1 for o in sample if o['H'] > zt[o['reg']][p][0] * (o['fu'] if adj else 1) * o['s']) / len(sample), 4),
                round(sum(1 for o in sample if o['L'] < zt[o['reg']][p][1] * (o['fd'] if adj else 1) * o['s']) / len(sample), 4))
    check = []
    for p in (0.90, 0.95, 0.99):
        u1, d1 = brk(test, p, True)
        u0_, d0_ = brk(test, p, False)
        su1, sd1 = brk(stress, p, True)
        su0, sd0 = brk(stress, p, False)
        check.append({'p': p, 'up': u1, 'dn': d1, 'up0': u0_, 'dn0': d0_,
                      'stressUp0': su0, 'stressDn0': sd0, 'stressUp': su1, 'stressDn': sd1})

    # 通道推移：最近 SERIES_DAYS 天；模型用通道開始以前的資料估，倍數只用「那天收盤以前」已經知道的隔日資料
    def sq(sorted_xs, p):
        if not sorted_xs:
            return float('nan')
        k = (len(sorted_xs) - 1) * p
        f = int(math.floor(k))
        c = min(f + 1, len(sorted_xs) - 1)
        return sorted_xs[f] + (sorted_xs[c] - sorted_xs[f]) * (k - f)

    start = max(0, len(obs) - SERIES_DAYS)
    set_fac(fit_model(obs[:start], FEAT_UP, 'u'), fit_model(obs[:start], FEAT_DN, 'd'))
    known = dict((r, ([], [])) for r in regs)

    def learn(o):
        bisect.insort(known[o['reg']][0], o['H'] / o['s'] / o['fu'])
        bisect.insort(known[o['reg']][1], o['L'] / o['s'] / o['fd'])

    for o in obs[:start]:
        learn(o)

    def channel(reg_, s_, base, fu_, fd_):
        hz, lz = known[reg_]
        return dict((k, round(base * (1 + v), 1)) for k, v in (
            ('u95', min(sq(hz, 0.95) * fu_ * s_, LIMIT)), ('d95', max(sq(lz, 0.05) * fd_ * s_, -LIMIT)),
            ('u99', min(sq(hz, 0.99) * fu_ * s_, LIMIT)), ('d99', max(sq(lz, 0.01) * fd_ * s_, -LIMIT))))

    series, recent = [], []
    for j in range(start, len(obs)):
        o = obs[j]
        if j > start:
            learn(obs[j - 1])                          # 前一天的答案今天收盤時已經知道
        base = cl[o['i']]
        s_o = max(o['s'], iv[o['d']]) if o['d'] in iv else o['s']
        ch = channel(o['reg'], s_o, base, o['fu'], o['fd'])
        series.append(dict({'d': o['d1'], 'b': base, 'h': rows[o['i'] + 1][1], 'l': rows[o['i'] + 1][2],
                            'c': cl[o['i'] + 1], 'r': o['reg'][0], 'mt': o['m'], 'fu': round(o['fu'], 3), 'fd': round(o['fd'], 3)}, **ch))
        if j >= len(obs) - 10:
            recent.append({'d': o['d'], 'd1': o['d1'], 'close': base, 'reg': o['reg'],
                           'H': round(o['H'], 5), 'L': round(o['L'], 5), 'C': round(o['C'], 5),
                           'up95': round(ch['u95'] / base - 1, 5), 'dn95': round(ch['d95'] / base - 1, 5),
                           'up99': round(ch['u99'] / base - 1, 5), 'dn99': round(ch['d99'] / base - 1, 5)})
    b95 = next(b for b in bands if b['p'] == 0.95); b99 = next(b for b in bands if b['p'] == 0.99)
    tomorrow = {'d': nxt.isoformat(), 'b': cl[-1], 'r': reg[0], 'f': 1, 'mt': mt[-1], 'fu': round(fu_now, 3), 'fd': round(fd_now, 3),
                'u95': round(cl[-1] * (1 + b95['up']), 1), 'd95': round(cl[-1] * (1 + b95['dn']), 1),
                'u99': round(cl[-1] * (1 + b99['up']), 1), 'd99': round(cl[-1] * (1 + b99['dn']), 1)}

    def ext(key, best):
        o = best(obs, key=lambda x: x[key])
        return {'v': round(o[key], 5), 'd': o['d'], 'd1': o['d1']}

    def why(items):
        return [{'k': k, 'label': FEAT_LABEL.get(k, k), 'x': round(x, 5), 'c': round(c, 4)}
                for k, c, x in sorted(items, key=lambda t: -abs(t[1]))]

    m_now = mt[-1]
    return {
        'meta': {
            'updated': (today or datetime.now(TPE).date()).isoformat(),
            'date': ds[-1], 'close': cl[-1], 'next': nxt.isoformat(), 'gap': (nxt - last).days, 'regime': reg,
            'sigma': round(s, 5), 'sigmaE': round(s_e, 5), 'sigmaIv': round(iv_now, 5) if iv_now else None, 'lambda': LAMBDA, 'since': ds[0], 'samples': cnt,
            'counts': dict((r, zs[r][0]) for r in regs),
            'mult99': dict((r, [round(zs[r][1][0.99][0], 3), round(zs[r][1][0.99][1], 3)]) for r in regs),
            'limit': LIMIT, 'checkFrom': split, 'checkDays': len(test), 'stressDays': len(stress),
            'source': u'FinMind TaiwanStockPrice TAIEX（加權指數日線）；休市日：證交所 OpenAPI；維持率、漲跌家數：網站籌碼資料',
        },
        'bands': bands,
        'check': check,
        'recent': recent,
        # 通道推移圖：d＝那一天（被預測的日子），b＝前一日收盤，h/l/c＝實際，u95/d95/u99/d99＝當時估的通道（點位），
        # r＝n 一般／w 跨週末／h 連假，fu/fd＝那天的狀態調整係數。最後一列是明天（f＝1，沒有 h/l/c）
        'series': series + [tomorrow],
        # 狀態調整（2026-11-21 IC 研究）：今天的上／下緣係數與各特徵的貢獻（log 尺度，正＝放寬）
        'state': {'fu': round(fu_now, 3), 'fd': round(fd_now, 3), 'whyUp': why(why_u), 'whyDn': why(why_d)},
        # 選擇權隱含波動（臺指 VIX 長期歷史要向期交所申請，改用 atm.json 價平和反推、同一種東西）
        'iv': {'days': len(iv_obs), 'from': min((o['d'] for o in iv_obs), default=None), 'check': iv_check,
               'note': u'σ＝max(EWMA, 價平和隱含)；價平和 ÷ (0.8 × 指數 × √到期交易日)'},
        'maint': {
            'value': m_now, 'date': md[-1], 'thr': MAINT_LOW, 'low': m_now is not None and m_now < MAINT_LOW,
            'lowDays': sum(1 for o in obs if o['low'] and o['reg'] != 'holiday'),
            'below140': {'days': len([o for o in obs if o['m'] is not None and o['m'] < MAINT_CALL]),
                         'avgC': round(sum(o['C'] for o in obs if o['m'] is not None and o['m'] < MAINT_CALL)
                                       / max(1, len([o for o in obs if o['m'] is not None and o['m'] < MAINT_CALL])), 5)},
            'call': MAINT_CALL,
            'source': u'網站籌碼資料 margin.keepHist（大盤融資維持率，證交所口徑：官方＋換算，2009 起）',
        },
        'extremes': {'H': ext('H', max), 'L': ext('L', min), 'Cup': ext('C', max), 'Cdn': ext('C', min)},
    }



def main():
    try:
        rows = load_taiex()
    except Exception as e:                                    # noqa: BLE001
        log(u'⚠ 加權指數日線抓不到（%s），nextday.json 保留前一版' % str(e)[:80])
        return 0
    doc = build(rows, holidays(), iv=load_iv(), chips=load_chips())
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))
    m = doc['meta']
    b99 = next(b for b in doc['bands'] if b['p'] == 0.99)
    log(u'%s：%s 收 %.2f → 下一個交易日 %s（%s，日波動 %.2f%%＝EWMA 與隱含取大）；99%% 最高 %+.2f%%、最低 %+.2f%%；'
        u'樣本外 99%% 突破 上 %.2f%%／下 %.2f%%；狀態調整 上 ×%.2f 下 ×%.2f'
        % (OUT, m['date'], m['close'], m['next'], m['regime'], m['sigma'] * 100, b99['up'] * 100, b99['dn'] * 100,
           doc['check'][2]['up'] * 100, doc['check'][2]['dn'] * 100, doc['state']['fu'], doc['state']['fd']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
