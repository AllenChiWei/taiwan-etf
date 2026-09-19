# -*- coding: utf-8 -*-
u"""台指選擇權週選的價平和（ATM straddle），逐日累積。

    python scripts/fetch_atm.py [--backfill 90] [--date 2026/09/17]

寫到 app/public/data/atm.json，**進版控**（每天兩列，一年不到 60 KB）。

## 定義

    價平履約價 = 同一到期合約中，|Call 收盤 − Put 收盤| 最小的那個履約價
    價平和     = 該履約價的 Call 收盤 + Put 收盤

用「|C−P| 最小」而不是「離現貨最近」：選擇權的價平是由買賣權平價關係決定的，
這個定義不需要另外取得指數收盤價，也不會因為現貨與期貨的價差而偏掉。

一律取**一般交易時段**（日盤 08:45–13:45）的收盤價；沒有成交價時退回結算價。
所以每一列的意思是「該交易日收盤的價平和」，也就是**隔一個交易日開盤前**看到的數字。

期交所 CSV 裡的「盤後」是前一交易日 15:00 開始的夜盤，比同一份檔案的「一般」還舊，
而且流動性低到 |C−P| 最小的判定會偏掉 —— 所以不用它。

## 週三與週五兩個系列

合約代號的系列才是可靠的分類依據：

    202609W4   W 系列 = 週三到期的週選
    202609F3   F 系列 = 週五到期的週選
    202609     月選 = 該月第三個週三到期

**不要用「到期日是星期幾」分類。** 遇到連假會錯：202609F4 的到期日是 2026-09-29
（星期二），因為原本的 09-25 星期五是中秋連假。系列名稱不受影響。

月選算進**週三系列**：它到期的那一週沒有 W 合約（九月只有 W1、W2、W4、W5），
那一週的「週三到期合約」就是月選本身。

每個交易日、每個系列記**兩口**：最近到期（r=0）與第二近（r=1）。

為什麼要第二口：到期當日最近的那口只剩幾小時，價平和趨近 0，而那天早上交易者
看的其實是換倉後的下一口。只記最近一口的話，「週四早上的週三系列價平和」會變成
沒有樣本 —— 因為週三收盤時最近的那口正好就是當天到期的。前端排除到期當日時，
會自動退到第二口，那才是盤前真正在看的數字。
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'atm.json')

TPE = timezone(timedelta(hours=8))
UA = {
    'User-Agent': ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
                   '+https://allenchiwei.github.io/taiwan-etf/) TXO ATM straddle'),
    'Referer': 'https://www.taifex.com.tw/cht/3/dlOptDailyMarketView',
    'Content-Type': 'application/x-www-form-urlencoded',
}
URL = 'https://www.taifex.com.tw/cht/3/dlOptDataDown'

DELAY = 2.0
TIMEOUT = 180
# 一次查幾個日曆天。13 個交易日的回應約 7 MB，再大就容易逾時。
CHUNK_DAYS = 14
# 沒有既有資料時預設回補幾個日曆天（約 60 個交易日，每個星期各 12 個以上樣本）
DEFAULT_BACKFILL = 90

# CSV 欄位索引（期交所每日選擇權行情）
COL_DATE, COL_CONTRACT, COL_STRIKE, COL_CP = 0, 2, 3, 4
COL_CLOSE, COL_SETTLE, COL_SESSION, COL_EXPIRY = 8, 10, 17, 20

# 加權指數收盤。價平和是「市場對接下來會走多少的定價」，要判斷這個定價準不準，
# 就得有事後實際走了多少 —— 那需要每個交易日的指數收盤價。
#
# 兩個來源各有用途：OpenAPI 那個一次給整個月（當月），每天跑就順便把當月補齊；
# 舊月份只能一天一個請求（MI_INDEX），所以只在缺的時候補，而且一次最多補 60 天。
TWSE_MONTH = 'https://openapi.twse.com.tw/v1/indicesReport/MI_5MINS_HIST'
TWSE_DAY = ('https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX'
            '?date=%s&type=IND&response=json')
TAIEX_NAME = u'發行量加權股價指數'
# 證交所擋太快的請求時回 307（不是 429，也沒有 Retry-After），而且擋住之後連
# 原本查得到的日期也一起擋。實測一次跑 50 個請求就會踩到，所以一次只補 20 天 ——
# 反正每天都會跑，缺的幾天過兩天就補齊了。
TAIEX_BACKFILL_LIMIT = 20

# 配對履約價少於這個數量時，|C−P| 最小的判定可能嚴重偏離（夜盤常見）。
# 標記起來讓前端可以排除，而不是直接丟掉 —— 丟掉就看不出那天資料有問題。
MIN_PAIRS = 20

ERRORS = []


def log(m):
    print(m, flush=True)


def note(msg):
    log(u'  ⚠ %s' % msg)
    ERRORS.append(msg)


def write_json(path, obj):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')))


def fetch(start, end, tries=3):
    u"""下載一段日期的 TXO 全合約行情，回傳 Big5 原始 bytes。"""
    body = urllib.parse.urlencode({
        'down_type': '1',
        'queryStartDate': start,
        'queryEndDate': end,
        'commodity_id': 'TXO    ',          # 七字元，含尾隨空白，少一格就查不到
    }).encode()
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(URL, data=body, headers=UA)
            raw = urllib.request.urlopen(req, timeout=TIMEOUT).read()
            time.sleep(DELAY)
            return raw
        except Exception as e:                                # noqa: BLE001
            if attempt == tries:
                note(u'期交所 %s~%s：%s' % (start, end, str(e)[:70]))
                return b''
            log(u'  %s~%s 第 %d 次失敗（%s），重試' % (start, end, attempt, str(e)[:40]))
            time.sleep(DELAY * attempt)
    return b''


def price(parts):
    u"""收盤價優先，無成交（'-'）時退回結算價。"""
    for idx in (COL_CLOSE, COL_SETTLE):
        try:
            v = float(parts[idx].strip())
            if v > 0:
                return v
        except (ValueError, IndexError):
            continue
    return None


def parse(raw):
    u"""解析 CSV -> {交易日: {合約: {'expiry':…, 'strikes': {履約價: {call,put}}}}}。

    只留一般交易時段。夜盤（盤後）比同一份檔案的日盤還舊，見模組說明。
    """
    out = {}
    if not raw:
        return out
    for line in raw.decode('big5', errors='replace').splitlines():
        parts = line.split(',')
        if len(parts) <= COL_EXPIRY or not parts[COL_DATE].startswith('20'):
            continue
        if parts[COL_SESSION].strip() != u'一般':
            continue
        cp = parts[COL_CP].strip()
        if cp not in (u'買權', u'賣權'):
            continue
        try:
            strike = float(parts[COL_STRIKE])
        except ValueError:
            continue
        p = price(parts)
        if p is None:
            continue
        day = parts[COL_DATE].strip().replace('/', '-')
        contract = parts[COL_CONTRACT].strip()
        entry = out.setdefault(day, {}).setdefault(
            contract, {'expiry': parts[COL_EXPIRY].strip(), 'strikes': {}})
        entry['strikes'].setdefault(strike, {})[
            'call' if cp == u'買權' else 'put'] = p
    return out


def calc_atm(strikes):
    u"""|Call−Put| 最小的履約價。回傳 None 代表沒有任何可配對的買賣權。"""
    pairs = [(k, v['call'], v['put']) for k, v in strikes.items()
             if 'call' in v and 'put' in v]
    if not pairs:
        return None
    strike, call, put = min(pairs, key=lambda x: abs(x[1] - x[2]))
    return {
        'k': int(strike),
        'call': round(call, 2),
        'put': round(put, 2),
        'diff': round(abs(call - put), 2),
        'sum': round(call + put, 2),
        'pairs': len(pairs),
        'thin': 1 if len(pairs) < MIN_PAIRS else 0,
    }


def series_of(contract):
    u"""合約代號 -> 'wed'（週三系列與月選）或 'fri'（週五系列）。

    看系列字母而不是到期日的星期：連假會讓到期日移位（202609F4 落在星期二），
    但系列不會變。純數字的代號是月選，到期在該月第三個週三。
    """
    m = re.match(r'^\d{6}([A-Z])(\d)?$', contract)
    if not m:
        return 'wed' if re.match(r'^\d{6}$', contract) else None
    letter = m.group(1)
    if letter == 'W':
        return 'wed'
    if letter == 'F':
        return 'fri'
    return None


# 每個系列記幾口。2 = 最近到期與第二近（換倉後那一口）。
CONTRACTS_PER_SERIES = 2


def front_contracts(day, contracts):
    u"""某個交易日、兩個系列各自由近到遠的前幾口合約。

    回傳 {系列: [(合約, 資料), …]}，依到期日排序。
    到期日必須 >= 交易日；到期當日本身仍然算（剩餘 0 天），因為那天盤前它還在。
    """
    buckets = {}
    compact = day.replace('-', '')
    for contract, entry in contracts.items():
        s = series_of(contract)
        if s is None:
            continue
        expiry = entry['expiry']
        if not re.match(r'^\d{8}$', expiry) or expiry < compact:
            continue
        buckets.setdefault(s, []).append((contract, entry))
    for s in buckets:
        buckets[s].sort(key=lambda ce: ce[1]['expiry'])
        buckets[s] = buckets[s][:CONTRACTS_PER_SERIES]
    return buckets


def rows_for_day(day, contracts):
    out = []
    for s, items in sorted(front_contracts(day, contracts).items()):
        for rank, (contract, entry) in enumerate(items):
            atm = calc_atm(entry['strikes'])
            if not atm:
                # 第二口在到期日前幾天才掛牌，沒有報價是正常的，不用叫
                if rank == 0:
                    note(u'%s %s 沒有可配對的買賣權' % (day, contract))
                continue
            expiry = entry['expiry']
            exp_iso = '%s-%s-%s' % (expiry[:4], expiry[4:6], expiry[6:])
            row = {
                'd': day,
                's': s,
                # 0 = 最近到期，1 = 第二近（換倉後那一口）
                'r': rank,
                'c': contract,
                'e': exp_iso,
                # 剩餘日曆天數。0 = 到期當日
                'dte': (datetime.strptime(expiry, '%Y%m%d').date()
                        - datetime.strptime(day, '%Y-%m-%d').date()).days,
            }
            row.update(atm)
            out.append(row)
    return out


def _get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA['User-Agent']})
    return json.loads(urllib.request.urlopen(req, timeout=60).read().decode('utf-8'))


def taiex_this_month():
    u"""{日期: 收盤指數}，當月。一個請求就給整個月。"""
    out = {}
    try:
        for r in _get_json(TWSE_MONTH):
            roc = str(r.get('Date') or '')          # 民國：1150918
            close = str(r.get('ClosingIndex') or '').replace(',', '')
            if len(roc) == 7 and close:
                day = '%d-%s-%s' % (int(roc[:3]) + 1911, roc[3:5], roc[5:7])
                out[day] = float(close)
    except Exception as e:                                    # noqa: BLE001
        note(u'當月加權指數抓取失敗：%s' % str(e)[:60])
    return out


def taiex_one_day(day, tries=3):
    u"""某一天的收盤指數；查無資料（假日）回 None。

    證交所擋太快的請求時回 307 而不是 429，所以重試要拉長間隔 —— 一秒一發會
    連續吃到 307（回補時實測）。
    """
    for attempt in range(1, tries + 1):
        try:
            doc = _get_json(TWSE_DAY % day.replace('-', ''))
            if doc.get('stat') != 'OK':
                return None
            for t in doc.get('tables') or []:
                for row in t.get('data') or []:
                    if row and row[0].strip() == TAIEX_NAME:
                        return float(str(row[1]).replace(',', ''))
            return None
        except Exception as e:                                # noqa: BLE001
            if attempt == tries:
                note(u'%s 加權指數抓取失敗：%s' % (day, str(e)[:50]))
                return None
            time.sleep(DELAY * attempt)
    return None


def fill_taiex(taiex, days):
    u"""補齊這些交易日的收盤指數。回傳補了幾天。

    days 是 atm.json 裡出現過的交易日 —— 只補這些，因為對照只需要這些。
    """
    added = 0
    month = taiex_this_month()
    for day, close in month.items():
        if day not in taiex:
            taiex[day] = close
            added += 1
    missing = sorted(d for d in days if d not in taiex)
    if missing:
        log(u'還有 %d 個交易日沒有指數收盤，這次補 %d 天'
            % (len(missing), min(len(missing), TAIEX_BACKFILL_LIMIT)))
    for day in missing[:TAIEX_BACKFILL_LIMIT]:
        v = taiex_one_day(day)
        if v is not None:
            taiex[day] = v
            added += 1
        time.sleep(DELAY)
    return added


def windows(start_date, end_date, step):
    out = []
    cur = start_date
    while cur <= end_date:
        stop = min(cur + timedelta(days=step - 1), end_date)
        out.append((cur.strftime('%Y/%m/%d'), stop.strftime('%Y/%m/%d')))
        cur = stop + timedelta(days=1)
    return out


def main():
    args = sys.argv[1:]
    backfill = None
    only_date = None
    for i, a in enumerate(args):
        if a.startswith('--backfill'):
            backfill = int(a.split('=')[1]) if '=' in a else DEFAULT_BACKFILL
        elif a == '--date' and i + 1 < len(args):
            only_date = args[i + 1].replace('-', '/')

    doc = {}
    if os.path.exists(OUT):
        try:
            doc = json.load(io.open(OUT, encoding='utf-8'))
        except Exception as e:                                # noqa: BLE001
            note(u'既有的 atm.json 讀不起來（%s），這次重建' % str(e)[:60])
            doc = {}
    rows = doc.get('rows') or []
    have = set((r['d'], r['s'], r.get('r', 0)) for r in rows)
    today = datetime.now(TPE).date()

    if only_date:
        spans = [(only_date, only_date)]
    else:
        days = backfill if backfill is not None else (
            DEFAULT_BACKFILL if not rows else None)
        if days is None:
            # 從最後一筆的隔天補到今天。多抓幾天不要緊，重複的會被跳過。
            last = max(r['d'] for r in rows)
            start = datetime.strptime(last, '%Y-%m-%d').date() + timedelta(days=1)
            if start > today:
                log(u'已經是最新（最後一筆 %s），沒有要補的' % last)
                start = today
        else:
            start = today - timedelta(days=days)
            log(u'回補最近 %d 天' % days)
        spans = windows(start, today, CHUNK_DAYS)

    added = 0
    for a, b in spans:
        log(u'下載 %s ~ %s…' % (a, b))
        data = parse(fetch(a, b))
        if not data:
            continue
        log(u'  %d 個交易日' % len(data))
        for day in sorted(data):
            for row in rows_for_day(day, data[day]):
                if (row['d'], row['s'], row['r']) in have:
                    continue
                rows.append(row)
                have.add((row['d'], row['s'], row['r']))
                added += 1

    rows.sort(key=lambda r: (r['d'], r['s'], r.get('r', 0)))

    # 指數收盤：價平和只有跟「後來實際走了多少」放在一起才說得出準不準
    taiex = dict(doc.get('taiex') or {})
    n_idx = fill_taiex(taiex, set(r['d'] for r in rows))
    by_series = {}
    for r in rows:
        if r.get('r', 0) == 0:
            by_series[r['s']] = by_series.get(r['s'], 0) + 1

    payload = {
        'meta': {
            'updated': datetime.now(TPE).date().isoformat(),
            'latest': rows[-1]['d'] if rows else None,
            'days': len(set(r['d'] for r in rows)),
            'counts': by_series,
            'minPairs': MIN_PAIRS,
            'ranks': CONTRACTS_PER_SERIES,
            'source': u'臺灣期貨交易所每日選擇權行情（一般交易時段收盤價）',
            'note': (u'價平履約價為 |Call−Put| 最小者，價平和為該履約價的 Call+Put。'
                     u'每一列是該交易日收盤的數字，也就是隔一個交易日開盤前看到的值。'
                     u'週三系列含月選（月選到期那一週沒有 W 合約）。'
                     u'每個系列記兩口：r=0 最近到期、r=1 換倉後那一口。'),
            'taiexDays': len(taiex),
            'taiexSource': u'證交所 每日收盤行情－發行量加權股價指數',
            'errors': ERRORS,
        },
        'rows': rows,
        # {日期: 收盤指數}。跟 rows 分開存，因為它是每天一個值，不分系列。
        'taiex': dict(sorted(taiex.items())),
    }
    write_json(OUT, payload)
    log(u'完成：%s（新增 %d 列，共 %d 列 / %d 個交易日；指數收盤 +%d 天、共 %d 天；%.0f KB）'
        % (OUT, added, len(rows), payload['meta']['days'],
           n_idx, len(taiex), os.path.getsize(OUT) / 1024.0))
    return 0 if rows else 1


if __name__ == '__main__':
    sys.exit(main())
