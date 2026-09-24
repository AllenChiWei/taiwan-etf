# -*- coding: utf-8 -*-
u"""全部上市櫃個股的現金股利與收盤價，給配息試算用。逐日累積。

    python scripts/fetch_stock_dividends.py [--years 4] [--budget 250]

寫到 app/public/data/stock_dividends.json，**進版控**。ETF 不在這裡（那些在
dividends.json 與 calc/ 的試算資料裡）。

## 來源與涵蓋

**上市（約 1,000 檔）**：證交所 `TWT49U` 除權除息計算結果表，一個請求一整年、全市場。
第一次跑回補 --years 年，之後每天只查今年與去年（兩個請求）。
「權息」那種是權值與息值合併計價、拆不出現金，用證交所 t187ap45_L（最近一次宣告的
現金股利）補；補不到的標 exact=0（數字會高估）。純「權」（股票股利）不收 —— 沒有現金。

**上櫃（約 800 檔）**：櫃買**只提供今天的除權息清單**，沒有歷史端點（查過 OpenAPI 的
tpex_exright_daily 只有當天、tpex_exright_prepost 只有預告、mopsfin_t187ap39_O 停在
110 年）。所以：
  * 每天：櫃買當天的除息清單累積進來（跟 fetch_dividends.py 同一個端點）。
  * 歷史：FinMind `TaiwanStockDividend` 一檔一個請求（有每股現金股利與除息交易日）。
    免費層一小時 300 次，一次跑不完，所以每次最多 --budget 檔，做過的記在
    meta.backfilled，下次接著補。碰到額度上限（HTTP 402）就停，不重試。

**名稱與收盤價**：證交所 `STOCK_DAY_ALL`、櫃買 `tpex_mainboard_daily_close_quotes`。

只收 4 碼、非 0 開頭的普通股（`^[1-9]\\d{3}$`）—— ETF、權證、特別股不在這裡。

## 產出

    {"meta": {..., "backfilled": [...]},
     "stocks": {"2330": {"n": "台積電", "m": "twse", "c": 1480.0,
                         "ev": [["2026-06-12", 5.0, 1], ...]}}}      ev = [除息日, 每股現金, 是否精確]
"""
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_dividends as fd                                  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'stock_dividends.json')
TPE = timezone(timedelta(hours=8))
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; +https://allenchiwei.github.io/taiwan-etf/) '
      'stock dividends for a dividend planner')
# 普通股，加上特別股（2887E、2881A 這種四位數字後面一個英文字母）——
# 特別股多半是為了固定股息買的，配息試算本來就該算得到
STOCK = re.compile(r'^[1-9]\d{3}[A-Z]?$')
FINMIND_API = 'https://api.finmindtrade.com/api/v4/data'
FINMIND_TOKEN = os.environ.get('FINMIND_TOKEN', '').strip()
# 保留幾年的配息紀錄。試算只看最近 12 個月，多留一些是為了推配息頻率與月份
KEEP_YEARS = 4

ERRORS = []


def log(m):
    print(m, flush=True)


def note(m):
    log(u'  ⚠ %s' % m)
    ERRORS.append(m)


def get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=60).read().decode('utf-8'))


def num(s):
    try:
        return float(str(s).replace(',', '').strip())
    except (TypeError, ValueError):
        return None


def universe():
    u"""{代號: {n, m, c}}：上市櫃普通股的名稱、市場與最新收盤價。"""
    out = {}
    try:
        for r in get_json('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'):
            code = str(r.get('Code') or '').strip()
            if STOCK.match(code):
                out[code] = {'n': str(r.get('Name') or '').strip(), 'm': 'twse',
                             'c': num(r.get('ClosingPrice'))}
    except Exception as e:                                    # noqa: BLE001
        note(u'證交所收盤行情：%s' % str(e)[:60])
    time.sleep(2)
    try:
        for r in get_json('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'):
            code = str(r.get('SecuritiesCompanyCode') or '').strip()
            if STOCK.match(code):
                out[code] = {'n': str(r.get('CompanyName') or '').strip().rstrip('*'), 'm': 'tpex',
                             'c': num(r.get('Close'))}
    except Exception as e:                                    # noqa: BLE001
        note(u'櫃買收盤行情：%s' % str(e)[:60])
    return out


def finmind_dividends(code, start):
    u"""FinMind 公告的股利 -> [(除息日, 每股現金)]。額度用完時拋 QuotaError。"""
    params = {'dataset': 'TaiwanStockDividend', 'data_id': code, 'start_date': start}
    if FINMIND_TOKEN:
        params['token'] = FINMIND_TOKEN
    try:
        doc = get_json(FINMIND_API + '?' + urllib.parse.urlencode(params))
    except urllib.error.HTTPError as e:
        if e.code == 402:
            raise QuotaError()
        raise
    if doc.get('msg') != 'success':
        if 'upper limit' in str(doc.get('msg')):
            raise QuotaError()
        raise RuntimeError(str(doc.get('msg'))[:60])
    out = []
    for r in doc.get('data') or []:
        day = str(r.get('CashExDividendTradingDate') or '').strip()
        cash = (num(r.get('CashEarningsDistribution')) or 0) + (num(r.get('CashStatutorySurplus')) or 0)
        if re.match(r'^\d{4}-\d{2}-\d{2}$', day) and cash > 0:
            out.append((day, round(cash, 6)))
    return out


class QuotaError(Exception):
    pass


FIXED = []


def merge(events, new, code=''):
    u"""events: {除息日: [日, 金額, 精確]}。精確的不被約略的覆蓋。

    **官方數字有變就更新**（站主要求，2026-09-24）：新的是精確值、金額跟既有的
    不同時也換掉，記進 FIXED 印在最後 —— 原本只在「既有的不精確」時才換，
    交易所事後更正金額就會一直留著舊的。
    """
    for day, amt, exact in new:
        # 取到小數第四位：證交所的「權值+息值」有計算誤差（台積電 4.5 元寫成 4.50002）
        amt = round(amt, 4)
        cur = events.get(day)
        if cur is None:
            events[day] = [day, amt, 1 if exact else 0]
        elif exact and (not cur[2] or abs(cur[1] - amt) > 1e-6):
            if cur[2]:
                FIXED.append(u'%s %s：%s -> %s' % (code, day, cur[1], amt))
            events[day] = [day, amt, 1]


def main():
    args = sys.argv[1:]
    years = int(next((a.split('=')[1] for a in args if a.startswith('--years=')), '0') or 0)
    budget = int(next((a.split('=')[1] for a in args if a.startswith('--budget=')),
                      os.environ.get('FINMIND_BUDGET_STOCKS', '250')))

    doc = {}
    if os.path.exists(OUT):
        try:
            doc = json.load(io.open(OUT, encoding='utf-8'))
        except Exception as e:                                # noqa: BLE001
            note(u'既有的 stock_dividends.json 讀不起來（%s），這次重建' % str(e)[:60])
    stocks = doc.get('stocks') or {}
    backfilled = set((doc.get('meta') or {}).get('backfilled') or [])
    today = datetime.now(TPE).date()
    ev = dict((c, dict((e[0], e) for e in s.get('ev') or [])) for c, s in stocks.items())

    uni = universe()
    log(u'上市櫃普通股 %d 檔（上市 %d、上櫃 %d）' % (
        len(uni), sum(1 for v in uni.values() if v['m'] == 'twse'),
        sum(1 for v in uni.values() if v['m'] == 'tpex')))

    # ── 上市：TWT49U 整年 ──
    n_years = years or (KEEP_YEARS if not stocks else 2)
    try:
        declared = fd.fetch_declared()
    except Exception as e:                                    # noqa: BLE001
        note(u'證交所股利分派情形：%s' % str(e)[:60])
        declared = {}
    for y in range(today.year - n_years + 1, today.year + 1):
        try:
            rows = fd.fetch_twse(y)
        except Exception as e:                                # noqa: BLE001
            note(u'證交所 %d 年除權息：%s' % (y, str(e)[:60]))
            continue
        latest_both = {}
        for code, day, amt, kind in rows:
            if code not in uni or kind == fd.KIND_STOCK:
                continue
            if kind == fd.KIND_CASH:
                merge(ev.setdefault(code, {}), [(day, amt, True)], code)
            else:                                   # 權息：合併計價，拆不出現金
                latest_both[code] = max(latest_both.get(code, ''), day)
                merge(ev.setdefault(code, {}), [(day, amt, False)], code)
        # 權息那筆若是最近一次，就用宣告的現金股利換掉合併計價的數字
        for code, day in latest_both.items():
            if code in declared and day in ev.get(code, {}):
                ev[code][day] = [day, round(declared[code], 6), 1]
        log(u'  證交所 %d 年：%d 筆' % (y, len(rows)))

    # ── 上櫃：今天的除息清單 ──
    try:
        for code, day, amt, _ in fd.fetch_tpex():
            if code in uni:
                merge(ev.setdefault(code, {}), [(day, amt, True)], code)
    except Exception as e:                                    # noqa: BLE001
        note(u'櫃買今天的除息：%s' % str(e)[:60])

    # ── 上櫃：FinMind 回補歷史（分批） ──
    todo = sorted(c for c, v in uni.items() if v['m'] == 'tpex' and c not in backfilled)
    start = '%d-01-01' % (today.year - KEEP_YEARS + 1)
    done = 0
    for code in todo[:budget]:
        try:
            got = finmind_dividends(code, start)
        except QuotaError:
            log(u'  FinMind 額度用完，剩下的下次接著補')
            break
        except Exception as e:                                # noqa: BLE001
            note(u'FinMind %s：%s' % (code, str(e)[:50]))
            continue
        merge(ev.setdefault(code, {}), [(d, a, True) for d, a in got], code)
        backfilled.add(code)
        done += 1
        time.sleep(1.2)
    log(u'  上櫃回補：這次 %d 檔，累計 %d / %d' % (
        done, len(backfilled & set(c for c, v in uni.items() if v['m'] == 'tpex')),
        sum(1 for v in uni.values() if v['m'] == 'tpex')))

    # ── 組合輸出：全部普通股都留，沒配過息的 ev 是空的 ──
    # 配息試算要能先把「還沒配息」的持股記下來（站主要求），等之後有除息紀錄
    # 自動算進去；只留有紀錄的話，那些股票連選單都進不去，也拿不到收盤價。
    cutoff = '%d-01-01' % (today.year - KEEP_YEARS + 1)
    out = {}
    for code, info in sorted(uni.items()):
        events = sorted(e for e in ev.get(code, {}).values() if cutoff <= e[0] <= today.isoformat())
        out[code] = {'n': info['n'], 'm': info['m'], 'c': info['c'], 'ev': events}
    payload = {
        'meta': {
            'updated': today.isoformat(),
            'source': u'證交所除權除息計算結果表（上市）；櫃買除息清單與 FinMind（上櫃）；兩家交易所收盤行情',
            'note': u'ev 每筆是 [除息日, 每股現金股利, 是否精確]；精確=0 是「權息」合併計價、拆不出現金，數字會高估。',
            'backfilled': sorted(backfilled),
            'errors': ERRORS,
        },
        'stocks': out,
    }
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    for f in FIXED:
        log(u'  更正 ' + f)
    log(u'官方數字更正 %d 筆' % len(FIXED))
    log(u'完成：%s（%d 檔，其中 %d 檔有配息紀錄，%.0f KB）' % (
        OUT, len(out), sum(1 for v in out.values() if v['ev']), os.path.getsize(OUT) / 1024.0))
    return 0 if any(v['ev'] for v in out.values()) else 1


if __name__ == '__main__':
    sys.exit(main())
