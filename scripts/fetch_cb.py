# -*- coding: utf-8 -*-
u"""可轉債：行情、轉換價、溢價率、待發行、籌備中、市場溫度計歷史、每檔走勢（部署時產生，不進版控）。

    python scripts/fetch_cb.py                    # 部署：cb.json、cb_market.json、cb_series/<代號>.json
    python scripts/fetch_cb.py --seed 2017-03-01  # 本機一次性：回補市場溫度計歷史 → scripts/data/cb_market_seed.json

## 來源：櫃買中心三份，加兩家交易所的股票收盤價與重大訊息，全是官方免費端點

    櫃買  storage/bond_zone/tradeinfo/cb/…/RSta0113.<日>-C.csv   轉(交)換公司債買賣斷交易行情表（收市、成交、明日參價）
    櫃買  storage/bond_zone/tradeinfo/cb/…/RSdrs001.<日>-C.csv   轉換公司債資訊看板（轉換價、賣回、贖回、餘額、當天參考價與標的股價）
    櫃買  openapi/v1/bond_ISSBD5_data                             轉(交)換債發行資料（到期日、擔保、待發行）
    證交所 exchangeReport/STOCK_DAY_ALL、櫃買 tpex_mainboard_daily_close_quotes   標的股票收盤價
    證交所 t187ap04_L、櫃買 mopsfin_t187ap04_O                   重大訊息（「籌備中」：董事會決議發行可轉債）

兩份 CSV 是櫃買「轉(交)換債日統計報表」頁的下載檔（那頁呼叫 /www/zh-tw/bond/cbDaily 列出檔名，
路徑規則固定，所以直接組網址）。檔案是 **cp950**。行情表每檔兩列（等價、議價），只取等價。
資訊看板從 **2017 年 3 月**起有檔案，比行情晚一天公布（傍晚只有前一交易日）。

## 歷史怎麼來

- **市場溫度計**（每天一列統計）：`scripts/data/cb_market_seed.json` 是本機用 `--seed` 從 2017 回補的
  （兩千多個檔案，部署時不可能每次重抓），加上快取裡最近幾年的每日快照算出來的，合併成 cb_market.json。
- **每檔走勢**：`.cache/cb_store.json`（Actions 快取，跟個股籌碼同一種作法）存每天的資訊看板快照
  {日期: {代號: [參考價, 標的股價, 轉換價]}}。每次部署把缺的交易日補抓（快取不見時最多往回補
  GAP_DAYS 天，約六分鐘，只有那一次），留 KEEP_DAYS 天。
- 歷史一律用**資訊看板當天的參考價與標的股價**（參考價＝當天收市，沒成交沿用前一個參考價），
  跟頁面「全部（沒成交用參考價）」同一個口徑。

## 幾個口徑，畫面上都要講清楚

- **價格**：當天有成交用收市價，沒成交用櫃買的「明日參價」（參考價）。XQ 那類看板用委買價，
  官方免費資料沒有委買，所以不是同一個數字。
- **轉換價值** ＝ 100 × 標的股價 ÷ 轉換價；**溢價率** ＝ 可轉債價格 ÷ 轉換價值 − 1。
- **看板的轉換價是「下次生效日之後」的轉換價**（櫃買註 2），生效日一起存。
- 交換債（標的不是發行公司自己）：今天收盤與看板的標的股價差 > 15% 時改用看板股價。

待發行：發行資料裡發行日或上櫃日在行情日之後、公開募集（OfferingMethod=7）。私募（=8）不列。
籌備中：重大訊息主旨提到轉換公司債（董事會決議、申報生效、訂定發行條件…），累積在快取裡一年；
同一家公司之後真的發了新債（發行日晚於公告日）就移掉。
"""
import argparse
import csv
import io
import json
import os
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_stocks import (                                     # noqa: E402
    DATA, HISTORY, ROOT, TPE, ERRORS, fetch, load_json, log, note, num, pick, write_json)

UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) convertible bonds')
STORAGE = 'https://www.tpex.org.tw/storage/bond_zone/tradeinfo/cb/%s/%s/%s.%s-C.csv'
ISSUE = 'https://www.tpex.org.tw/openapi/v1/bond_ISSBD5_data'
TWSE_DAY = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
TPEX_DAY = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'
OUT = os.path.join(DATA, 'cb.json')
MARKET_OUT = os.path.join(DATA, 'cb_market.json')
SERIES_DIR = os.path.join(DATA, 'cb_series')
CONV_OUT = os.path.join(DATA, 'cb_conv.json')
SEED = os.path.join(ROOT, 'scripts', 'data', 'cb_market_seed.json')
# 2026-11-05 轉換分析（XQ 有）：每檔每月底餘額（張）。種子 `--seed-out 2017-03` 本機回補，之後部署時從當天看板接著記
OUT_SEED = os.path.join(ROOT, 'scripts', 'data', 'cb_out_seed.json')
# 看板的「上月底發行餘額」每月前幾天陸續更新（2026-10 實測：1～6 日在變、7 日起不動），6 日以後的看板才當上個月的數字
OUT_FROM_DAY = 6
STORE = os.path.join(ROOT, '.cache', 'cb_store.json')
# 少於這麼多檔多半是檔案只下載了一部分，寧可不寫、讓網站沿用上一版（平常約 380 檔）
MIN_ROWS = 200
# 往回找最近一份的天數（連假最長約 9 天）
LOOKBACK = 12
# 快取不見時往回補幾個日曆天（約 280 個平日、280 個請求）；之後每次只補缺的那一兩天
GAP_DAYS = 400
# 每檔走勢留幾個日曆天（約三年；目前掛牌的可轉債多半是三年期）
KEEP_DAYS = 1100
# 籌備中的公告留多久
PLANNED_DAYS = 365
PLANNED_RE = re.compile(u'轉換公司債')
# 要是「準備發新債」的公告：董事會決議發行、募集、申報生效、承銷／競價拍賣、訂定發行條件…
PLANNED_YES = re.compile(u'發行|募集|私募|申報|生效|承銷|競價|詢價|訂定')
# 已經在外流通的債的例行公告不算（轉換成普通股的增資基準日、轉換價格調整、賣回、贖回、終止櫃買…）
PLANNED_NO = re.compile(u'轉換普通股|轉換為普通股|增資基準日|轉換價格|賣回|贖回|終止|停止|到期|還本|換發|轉換股份|發行新股')

# 跟 app/src/lib/cb.ts 的 BUCKETS／HIGH_BUCKETS 一致（tests/cb.test.ts 用同一份規則）
EDGES = [95, 100, 105, 110, 120]
MARKET_COLS = ['d', 'n', 'avg', 'pr75', 'pr90', 'b95', 'b100', 'b105', 'b110', 'b120', 'b120p',
               'h150', 'h150p', 'cv', 'prem', 'premItm', 'cv100', 'cv120', 'p0', 'p50', 'p100']


def get_csv(kind, day, pause=1.0):
    u"""一份櫃買 CSV；不存在（假日、還沒公布）回 None。"""
    url = STORAGE % (day[:4], day[:6], kind, day)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        raw = urllib.request.urlopen(req, timeout=60).read()
    except Exception:                                         # noqa: BLE001
        return None
    finally:
        time.sleep(pause)
    text = raw.decode('cp950', 'replace')
    if 'HEADER' not in text:                                  # 沒有那天的檔案時回的是一頁 HTML
        return None
    head, body = None, []
    for row in csv.reader(io.StringIO(text)):
        if not row:
            continue
        if row[0] == 'HEADER':
            head = [c.strip() for c in row[1:]]
        elif row[0] == 'BODY' and head:
            body.append(dict(zip(head, [c.strip() for c in row[1:]])))
    return body or None


def latest_csv(kind, start):
    u"""從 start 往回找最近一份。回 (日期 YYYY-MM-DD, 列)。"""
    d = start
    for _ in range(LOOKBACK):
        rows = get_csv(kind, d.strftime('%Y%m%d'))
        if rows:
            return d.strftime('%Y-%m-%d'), rows
        d -= timedelta(days=1)
    return None, []


def ymd(s):
    u"""'2029/12/10'、'20291210' -> '2029-12-10'；空白回 None。"""
    s = (s or '').replace('/', '').strip()
    return '%s-%s-%s' % (s[:4], s[4:6], s[6:8]) if len(s) == 8 and s.isdigit() else None


def r1(v):
    return None if v is None else round(v, 1)


def r2(v):
    return None if v is None else round(v, 2)


def snapshot(board):
    u"""資訊看板 → {代號: [參考價, 標的股價, 轉換價]}（歷史與走勢用的口徑）。"""
    out = {}
    for b in board:
        code = b.get(u'債券代碼')
        px = num(b.get(u'轉債參考價格'))
        if code and px:
            out[code] = [px, num(b.get(u'轉換標的股票價格')), num(b.get(u'轉換價格'))]
    return out


def percentile(values, p):
    u"""等同 Excel PERCENTILE.INC（跟 lib/cb.ts 的 percentile 一樣）。"""
    if not values:
        return None
    v = sorted(values)
    rank = p / 100.0 * (len(v) - 1)
    lo, hi = int(rank), min(int(rank) + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (rank - lo)


def day_stats(day, snap):
    u"""一天的市場溫度計：一列，欄位見 MARKET_COLS（跟頁面統計看板同一套定義）。"""
    px = [v[0] for v in snap.values()]
    n = len(px)
    if not n:
        return None
    cnt = [0] * 6
    for p in px:
        i = 0
        while i < len(EDGES) and p >= EDGES[i]:
            i += 1
        cnt[i] += 1
    h150 = sum(1 for p in px if 120 <= p < 150)
    h150p = sum(1 for p in px if p >= 150)
    cvp = [(100 * s / c, p / (100 * s / c) * 100 - 100)
           for p, s, c in snap.values() if s and c]
    itm = [pr for cv, pr in cvp if cv >= 100]
    mean = lambda xs: sum(xs) / len(xs) if xs else None  # noqa: E731
    return [day, n, r1(mean(px)), r1(percentile(px, 75)), r1(percentile(px, 90))] + cnt + [h150, h150p] + [
        r1(mean([c for c, _ in cvp])), r1(mean([p for _, p in cvp])), r1(mean(itm)),
        sum(1 for c, _ in cvp if c >= 100), sum(1 for c, _ in cvp if c >= 120),
        sum(1 for _, p in cvp if p > 0), sum(1 for _, p in cvp if p >= 50), sum(1 for _, p in cvp if p >= 100)]


def weekdays(start, end):
    d = start
    while d <= end:
        if d.weekday() < 5:
            yield d
        d += timedelta(days=1)


def stock_closes():
    u"""上市＋上櫃的最新收盤價。"""
    out = {}
    for url, label in ((TWSE_DAY, u'上市收盤價'), (TPEX_DAY, u'上櫃收盤價')):
        for r in fetch(url, label) or []:
            code = str(pick(r, 'Code', 'SecuritiesCompanyCode') or '').strip()
            p = num(pick(r, 'ClosingPrice', 'Close'))
            if code and p:
                out[code] = p
    return out


def update_store(store, board_day, board):
    u"""把今天的看板放進快取，並補抓缺的交易日。回補抓了幾天。"""
    days = store.setdefault('days', {})
    days[board_day] = snapshot(board)
    end = datetime.strptime(board_day, '%Y-%m-%d').date() - timedelta(days=1)
    have = sorted(d for d in days if d < board_day)
    start = (datetime.strptime(have[-1], '%Y-%m-%d').date() + timedelta(days=1)) if have \
        else end - timedelta(days=GAP_DAYS)
    start = max(start, end - timedelta(days=GAP_DAYS))
    todo = [d for d in weekdays(start, end) if d.isoformat() not in days]
    filled = 0
    for d in todo:
        rows = get_csv('RSdrs001', d.strftime('%Y%m%d'), pause=0.6)
        if rows:
            days[d.isoformat()] = snapshot(rows)
            filled += 1
    cut = (datetime.strptime(board_day, '%Y-%m-%d').date() - timedelta(days=KEEP_DAYS)).isoformat()
    for d in [d for d in days if d < cut]:
        del days[d]
    return filled


def prev_month(day):
    u"""'2026-11-08' -> '2026-10'（看板「上月底」是哪個月）。"""
    y, m = int(day[:4]), int(day[5:7])
    return '%04d-%02d' % ((y, m - 1) if m > 1 else (y - 1, 12))


def month_outs(board):
    u"""看板 → {代號: 上月底餘額（張，面額十萬一張）}。"""
    out = {}
    for b in board:
        code, v = b.get(u'債券代碼'), num(b.get(u'上月底發行餘額'))
        if code and v is not None:
            out[code] = int(round(v / 1e5))
    return out


def record_outs(store, board_day, board):
    u"""6 日以後的看板：記成上個月底的餘額（同一個月之後的看板會蓋掉，以最後一份為準）。"""
    if int(board_day[8:10]) >= OUT_FROM_DAY:
        store.setdefault('out', {})[prev_month(board_day)] = month_outs(board)


def conv_history(store, codes):
    u"""種子＋快取 → {代號: [[月, 餘額張], …]}（只留目前掛牌的；同一個月以快取為準）。"""
    months = dict((load_json(OUT_SEED, {}) or {}).get('m') or {})
    months.update(store.get('out') or {})
    out = {}
    for mth in sorted(months):
        for code, v in months[mth].items():
            if code in codes:
                out.setdefault(code, []).append([mth, v])
    return out


def month_gap(a, b):
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


def conv_recent(rows, k):
    u"""最近 k 個月餘額減少幾張（多半是轉換成股票；賣回那個月也會算進來）。月份不連續或資料不夠回 None。"""
    if len(rows) < k + 1 or month_gap(rows[-k - 1][0], rows[-1][0]) != k:
        return None
    return max(0, rows[-k - 1][1] - rows[-1][1])


def market_history(store):
    u"""種子（2017 起）＋快取每天的統計，同一天以快取為準。"""
    seed = load_json(SEED, {}) or {}
    rows = {r[0]: r for r in seed.get('rows') or []}
    for d, snap in store.get('days', {}).items():
        s = day_stats(d, snap)
        if s:
            rows[d] = s
    return {'cols': MARKET_COLS, 'rows': [rows[d] for d in sorted(rows)]}


def write_series(store, codes):
    u"""每檔一個小檔：[[日期, 價格, 標的股價, 溢價率], …]，只寫目前掛牌的。"""
    if not os.path.isdir(SERIES_DIR):
        os.makedirs(SERIES_DIR)
    days = store.get('days', {})
    order = sorted(days)
    n = 0
    for code in codes:
        pts = []
        for d in order:
            v = days[d].get(code)
            if not v:
                continue
            px, sp, cp = v
            prem = r1((px / (100 * sp / cp) - 1) * 100) if sp and cp else None
            pts.append([d, px, sp, prem])
        if pts:
            with io.open(os.path.join(SERIES_DIR, '%s.json' % code), 'w', encoding='utf-8') as fh:
                fh.write(json.dumps(pts, separators=(',', ':')))
            n += 1
    return n


def is_planned(subject):
    u"""重大訊息主旨是不是「準備發行可轉債」。"""
    return bool(PLANNED_RE.search(subject) and PLANNED_YES.search(subject) and not PLANNED_NO.search(subject))


def update_planned(store, info, issued, today):
    u"""重大訊息裡提到轉換公司債的 → 籌備中（累積一年；公司之後發了新債就移掉）。"""
    try:
        from fetch_news import filings
        found = filings(set())
    except Exception as e:                                    # noqa: BLE001
        note(u'重大訊息：%s' % str(e)[:70])
        found = []
    plan = {(p['s'], p['subject']): p for p in store.get('planned', [])}
    for f in found:
        if not is_planned(f['subject']):
            continue
        key = (f['code'], f['subject'])
        if key not in plan:
            plan[key] = {
                's': f['code'], 'name': f['name'] or (info.get(f['code']) or {}).get('name') or f['code'],
                'ind': (info.get(f['code']) or {}).get('industry') or u'其他',
                'subject': f['subject'], 'd': (f['at'] or today)[:10], 'u': f['u'],
            }
    cut = (datetime.strptime(today, '%Y-%m-%d').date() - timedelta(days=PLANNED_DAYS)).isoformat()
    keep = []
    for p in plan.values():
        if p['d'] < cut or not is_planned(p['subject']):         # 舊快取裡規則收緊前收進來的也一起濾掉
            continue
        # 公告之後這家公司發了新債（發行日 ≥ 公告日）＝已經發了，不再算籌備中
        if any(i >= p['d'] for i in issued.get(p['s'], [])):
            continue
        keep.append(p)
    keep.sort(key=lambda p: p['d'], reverse=True)
    store['planned'] = keep
    return keep


def build(today, store):
    quote_day, quotes = latest_csv('RSta0113', today)
    if not quotes:
        note(u'找不到最近 %d 天的可轉債行情表' % LOOKBACK)
        return None
    board_day, board = latest_csv('RSdrs001', datetime.strptime(quote_day, '%Y-%m-%d'))
    if not board:
        note(u'找不到可轉債資訊看板')
        return None
    log(u'  行情 %s %d 列、看板 %s %d 列' % (quote_day, len(quotes), board_day, len(board)))

    info = (load_json(HISTORY, {}) or {}).get('info') or {}
    issues, issued = {}, {}
    upcoming = []
    for r in fetch(ISSUE, u'轉(交)換債發行資料') or []:
        if r.get('OfferingMethod') != '7':                    # 私募不在櫃買交易
            continue
        code = (r.get('BondCode') or '').strip()
        item = {
            'c': code, 'n': (r.get('ShortName') or '').strip(), 'issuer': (r.get('IssuerName') or '').strip(),
            's': (r.get('IssuerCode') or '').strip().lstrip('0')[:6],
            'issue': ymd(r.get('IssueDate')), 'list': ymd(r.get('ListingDate')),
            'mat': ymd(r.get('MaturityDate')),
            'amt': num(r.get('IssueAmount')),
            'cp': num(r.get('Conversion/ExchangePriceAtIssuance')),
            'g': {'1': u'有擔保', '2': u'無擔保'}.get(r.get('Guaranteed'), u'其他'),
            'y': num(r.get('TenorYear')),
        }
        item['ind'] = (info.get(item['s']) or {}).get('industry') or u'其他'
        if item['issue']:
            issued.setdefault(item['s'], []).append(item['issue'])
        if code:
            issues[code] = item
        if max(item['issue'] or '', item['list'] or '') > quote_day:
            upcoming.append(item)
    upcoming.sort(key=lambda x: x['list'] or x['issue'] or '')

    closes = stock_closes()
    bq = {}
    for r in quotes:
        code = r.get(u'代號')
        if code and r.get(u'交易') == u'等價':
            bq[code] = r

    rows = []
    for b in board:
        code = b.get(u'債券代碼')
        if not code:
            continue
        q = bq.get(code, {})
        close = num(q.get(u'收市'))
        ref = num(q.get(u'明日參價')) or num(b.get(u'轉債參考價格'))
        px = close or ref
        cp = num(b.get(u'轉換價格'))
        stock = code[:4]
        bs = num(b.get(u'轉換標的股票價格'))
        sp = closes.get(stock)
        exch = False
        if bs and (not sp or abs(sp / bs - 1) > 0.15):        # 交換債，或今天抓不到收盤
            exch = bool(sp)
            sp = bs
        cv = 100 * sp / cp if sp and cp else None
        prem = (px / cv - 1) * 100 if px and cv else None
        iss = issues.get(code, {})
        meta = info.get(stock) or {}
        rows.append({
            'c': code, 'n': b.get(u'債券簡稱') or q.get(u'名稱') or code,
            's': stock, 'sn': meta.get('name') or '', 'ind': meta.get('industry') or u'其他',
            'mk': meta.get('market') or '',
            'px': r2(px), 'close': r2(close), 'chg': num(q.get(u'漲跌')),
            'vol': num(q.get(u'單位')), 'val': num(q.get(u'金額')),
            'cp': cp, 'cpEff': ymd(b.get(u'下次轉換價格生效日期')),
            'sp': sp, 'exch': exch, 'cv': r2(cv), 'prem': r2(prem),
            'convS': ymd(b.get(u'轉換起日')), 'convE': ymd(b.get(u'轉換迄日')),
            'putS': ymd(b.get(u'最近賣回權起日')), 'putE': ymd(b.get(u'最近賣回權迄日')),
            'putP': num(b.get(u'最近賣回權價格')) or None,
            'callS': ymd(b.get(u'強制贖回起日')), 'callP': num(b.get(u'強制贖回價格')) or None,
            'end': ymd(b.get(u'終止櫃檯買賣日')),
            'halt': ymd(b.get(u'停止交易起日')),
            'tot': num(b.get(u'原始發行總額')), 'out': num(b.get(u'上月底發行餘額')),
            'coupon': num(b.get(u'票面利率')),
            'issue': iss.get('issue'), 'mat': iss.get('mat'), 'g': iss.get('g'),
        })

    record_outs(store, board_day, board)
    filled = update_store(store, board_day, board)
    log(u'  走勢快取 %d 天（這次補抓 %d 天）' % (len(store.get('days', {})), filled))
    planned = update_planned(store, info, issued, quote_day)
    return {
        'meta': {
            'date': quote_day, 'board': board_day,
            'updated': datetime.now(TPE).strftime('%Y-%m-%d %H:%M'),
            'count': len(rows), 'traded': sum(1 for r in rows if r['close']),
            'source': u'櫃買中心 轉(交)換公司債買賣斷交易行情表、轉換公司債資訊看板、轉(交)換債發行資料；'
                      u'證交所／櫃買股票收盤價與重大訊息',
            'errors': ERRORS,
        },
        'bonds': rows,
        'upcoming': upcoming,
        'planned': planned,
    }


def seed(start):
    u"""本機一次性：從 start 起每個平日抓資訊看板，算市場溫度計，寫種子。可中斷續跑。"""
    have = {r[0]: r for r in (load_json(SEED, {}) or {}).get('rows') or []}
    end = datetime.now(TPE).date() - timedelta(days=1)
    todo = [d for d in weekdays(start, end) if d.isoformat() not in have]
    log(u'回補市場溫度計：%s ～ %s，還要抓 %d 天' % (start, end, len(todo)))
    for i, d in enumerate(todo, 1):
        rows = get_csv('RSdrs001', d.strftime('%Y%m%d'), pause=0.8)
        if rows:
            s = day_stats(d.isoformat(), snapshot(rows))
            if s:
                have[s[0]] = s
        if i % 50 == 0 or i == len(todo):
            write_json(SEED, {'cols': MARKET_COLS, 'rows': [have[k] for k in sorted(have)]})
            log(u'  %d/%d（%s）共 %d 天' % (i, len(todo), d, len(have)))
    return 0


def seed_out(start):
    u"""本機一次性：每個月取下個月 OUT_FROM_DAY 日起第一份看板的「上月底發行餘額」，寫 OUT_SEED（只留最新看板還掛牌的）。可中斷續跑。"""
    have = dict((load_json(OUT_SEED, {}) or {}).get('m') or {})
    today = datetime.now(TPE).date()
    y, m = int(start[:4]), int(start[5:7])
    todo = []
    while (y, m) < (today.year, today.month):
        todo.append('%04d-%02d' % (y, m))
        y, m = (y, m + 1) if m < 12 else (y + 1, 1)
    todo = [t for t in todo if t not in have]
    log(u'回補每月底餘額：還要抓 %d 個月' % len(todo))
    for i, mth in enumerate(todo, 1):
        y, m = int(mth[:4]), int(mth[5:7])
        first = datetime(y + (m == 12), m % 12 + 1, OUT_FROM_DAY).date()
        for d in [first + timedelta(days=k) for k in range(10)]:
            if d > today or d.weekday() >= 5:
                continue
            rows = get_csv('RSdrs001', d.strftime('%Y%m%d'), pause=0.8)
            if rows:
                have[mth] = month_outs(rows)
                break
        if i % 12 == 0 or i == len(todo):
            write_json(OUT_SEED, {'m': have})
            log(u'  %d/%d（%s）' % (i, len(todo), mth))
    _, latest = latest_csv('RSdrs001', datetime.now(TPE).replace(tzinfo=None))
    live = set(month_outs(latest or []))
    if live:
        have = {k: {c: v for c, v in row.items() if c in live} for k, row in have.items()}
    write_json(OUT_SEED, {'m': {k: have[k] for k in sorted(have)}})
    log(u'  共 %d 個月、掛牌中 %d 檔' % (len(have), len(live)))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out', nargs='?', default=OUT)
    ap.add_argument('--seed', help=u'本機回補市場溫度計的起日 YYYY-MM-DD')
    ap.add_argument('--seed-out', help=u'本機回補每月底餘額（轉換分析）的起月 YYYY-MM')
    a = ap.parse_args()
    if a.seed:
        return seed(datetime.strptime(a.seed, '%Y-%m-%d').date())
    if a.seed_out:
        return seed_out(a.seed_out)

    log(u'可轉債：櫃買行情＋資訊看板＋發行資料')
    store = load_json(STORE, {}) or {}
    d = build(datetime.now(TPE).replace(tzinfo=None), store)
    if not d or len(d['bonds']) < MIN_ROWS:
        log(u'  只有 %d 檔，少於 %d，不寫檔' % (len(d['bonds']) if d else 0, MIN_ROWS))
        return 1
    conv = conv_history(store, {b['c'] for b in d['bonds']})
    for b in d['bonds']:
        rows = conv.get(b['c']) or []
        b['cv1'], b['cv3'] = conv_recent(rows, 1), conv_recent(rows, 3)
        b['cvM'] = rows[-1][0] if rows else None
    write_json(CONV_OUT, conv)
    write_json(STORE, store)
    write_json(a.out, d)
    market = market_history(store)
    write_json(MARKET_OUT, market)
    n = write_series(store, [b['c'] for b in d['bonds']])
    m = d['meta']
    log(u'  %d 檔（今天有成交 %d）、待發行 %d、籌備中 %d、溫度計 %d 天、走勢檔 %d 個 → %s' % (
        m['count'], m['traded'], len(d['upcoming']), len(d['planned']), len(market['rows']), n, a.out))
    return 0


if __name__ == '__main__':
    sys.exit(main())
