# -*- coding: utf-8 -*-
u"""FinMind 績效曲線的共用機制：額度、輪替、日曆、輸出。

`fetch_series_tw.py`（台股，自己接還原股價）與 `fetch_series_us.py`（美股，
FinMind 直接給還原收盤價）兩支都用這裡的東西。會抽出來是因為難的部分不是抓資料，
是三件跟市場無關、而且都各踩過一次的事：

1. **額度**。FinMind 免費層每小時 300 次請求（註冊拿 token 是 600），一輪跑不完
   三百多檔。額度用完時回 HTTP 402，要當場停下來 —— 當成一般錯誤重試三次只會更慢，
   而且把剩下的額度也耗掉。
2. **輪替**。所以每次都從「資料最舊的」開始抓，沒有曲線的排最前。這一輪抓到的照常
   寫出，下一輪接著補。少了這個，每次都從同一個位置開始、每次都在同一個位置被擋，
   尾巴那批永遠輪不到（第一次上線就是這樣缺了 86 檔）。
3. **日曆**。每個市場一份交易日曆，每檔只存 `first` 索引加上連續的數值。因為不是
   每次都會重抓所有標的，日曆必須用**合併**的；而補抓一檔歷史更長的會讓日曆往
   **前面**長，所以沒重抓的檔案要拿日期重新對位 —— 只平移是不夠的，中間也可能
   插進新的交易日。
"""
import io
import json
import os
import time
import urllib.parse
import urllib.request

API = 'https://api.finmindtrade.com/api/v4/data'
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) performance curves')
# 免費註冊就能拿到的 token，把每小時額度從 300 拉到 600 次。沒有也能跑 ——
# 只是一輪跑不完，會分幾次補齊。
TOKEN = os.environ.get('FINMIND_TOKEN', '').strip()

START = '2019-01-01'
DECIMALS = 2
DELAY = 1.5
TIMEOUT = 60
# 資料太短畫不出有意義的曲線，與 fetch_series.py 的門檻一致
MIN_POINTS = 30

ERRORS = []


def log(m):
    print(m, flush=True)


def note(msg):
    log(u'  ⚠ %s' % msg)
    ERRORS.append(msg)


def quota_line():
    return (u'額度：有 FINMIND_TOKEN，每小時 600 次' if TOKEN
            else u'額度：沒有 FINMIND_TOKEN，每小時 300 次')


class RateLimited(Exception):
    u"""FinMind 的每小時額度用完了。這不是可以重試的錯誤 —— 重試只會更慢。"""


def check_limit(err_or_doc):
    u"""FinMind 額度用完時回 HTTP 402，訊息是 Requests reach the upper limit。"""
    code = getattr(err_or_doc, 'code', None)
    if code == 402:
        raise RateLimited('HTTP 402')
    msg = ''
    if isinstance(err_or_doc, dict):
        msg = str(err_or_doc.get('msg') or '')
    elif code is not None:
        try:
            msg = str(err_or_doc.read()[:200])
        except Exception:                                     # noqa: BLE001
            msg = ''
    if 'upper limit' in msg or 'reach the limit' in msg:
        raise RateLimited(msg[:80])


def api_rows(dataset, code, end, tries=3, quiet=False):
    u"""打一次 FinMind，回傳 data 陣列；查無資料回 []，失敗回 None。

    額度用完會丟 RateLimited，由呼叫端決定要停還是略過。
    """
    params = {'dataset': dataset, 'data_id': code,
              'start_date': START, 'end_date': end}
    if TOKEN:
        params['token'] = TOKEN
    url = API + '?' + urllib.parse.urlencode(params)
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            doc = json.loads(urllib.request.urlopen(req, timeout=TIMEOUT)
                             .read().decode('utf-8'))
            check_limit(doc)
            if doc.get('msg') != 'success':
                return None
            return doc.get('data') or []
        except RateLimited:
            raise
        except Exception as e:                                # noqa: BLE001
            check_limit(e)
            if attempt == tries:
                if not quiet:
                    note(u'%s %s 抓取失敗：%s' % (code, dataset, str(e)[:60]))
                return None
            time.sleep(DELAY * attempt)
    return None


def write_json(path, obj):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')))


def existing_dates(outdir, market):
    u"""既有日曆的日期。第一次執行時是空的。"""
    try:
        return json.load(io.open(os.path.join(outdir, '_%s.json' % market),
                                 encoding='utf-8'))['dates']
    except Exception:                                         # noqa: BLE001
        return []


def existing_coverage(outdir, market):
    u"""{代號: 這檔目前資料到哪一天}。沒有檔案的就不在裡面。

    不另外存狀態檔 —— 既有的日曆加上每檔的 first/values 長度，本來就足以回答
    「這檔的資料到哪一天」。
    """
    cal = existing_dates(outdir, market)
    if not cal:
        return {}
    d = os.path.join(outdir, market)
    if not os.path.isdir(d):
        return {}
    out = {}
    for f in os.listdir(d):
        if not f.endswith('.json') or f.startswith('_'):
            continue
        try:
            doc = json.load(io.open(os.path.join(d, f), encoding='utf-8'))
            last = doc['first'] + len(doc['values']) - 1
            if 0 <= last < len(cal):
                out[doc['code']] = cal[last]
        except Exception:                                     # noqa: BLE001
            continue
    return out


def order_by_staleness(codes, coverage):
    u"""資料最舊的排前面，沒有曲線的排最前（空字串比任何日期小）。"""
    return sorted(codes, key=lambda c: (coverage.get(c, ''), c))


def remap_existing(outdir, market, old_dates, new_index, skip):
    u"""把舊日曆寫的檔案改對到新日曆上。回傳處理了幾檔。

    values 是「從 first 起連續的每個交易日」，所以日曆中間插進新的一天時
    單純平移是不夠的 —— 拿 (日期, 數值) 重新鋪一次才正確。
    """
    d = os.path.join(outdir, market)
    if not os.path.isdir(d):
        return 0
    done = 0
    for f in sorted(os.listdir(d)):
        if not f.endswith('.json') or f.startswith('_'):
            continue
        if f[:-5] in skip:
            continue
        try:
            doc = json.load(io.open(os.path.join(d, f), encoding='utf-8'))
            pairs = []
            for i, v in enumerate(doc['values']):
                if v is None:
                    continue
                oi = doc['first'] + i
                if 0 <= oi < len(old_dates):
                    ni = new_index.get(old_dates[oi])
                    if ni is not None:
                        pairs.append((ni, v))
            if not pairs:
                continue
            first = pairs[0][0]
            values = [None] * (pairs[-1][0] - first + 1)
            for ni, v in pairs:
                values[ni - first] = v
            write_json(os.path.join(d, f),
                       {'code': doc['code'], 'first': first, 'values': values})
            done += 1
        except Exception:                                     # noqa: BLE001
            continue
    return done


def write_market(outdir, market, series, source):
    u"""把這一輪抓到的寫出去，並維護日曆與 index.json。

    series: {代號: [(日期, 數值), …]}，數值是要畫在圖上的還原價格。
    回傳 (這次寫出幾檔, 目前總共有幾檔)。
    """
    old_dates = existing_dates(outdir, market)
    fresh = {d for rows in series.values() for d, _ in rows}
    dates = sorted(fresh | set(old_dates))
    index = dict((d, i) for i, d in enumerate(dates))
    log(u'交易日曆 %d 天（%s ~ %s）' % (len(dates), dates[0], dates[-1]))
    write_json(os.path.join(outdir, '_%s.json' % market),
               {'market': market, 'dates': dates})

    if old_dates and old_dates != dates:
        n = remap_existing(outdir, market, old_dates, index, set(series))
        log(u'日曆有變動，重新對位既有的 %d 檔' % n)

    written = 0
    total_bytes = 0
    for code, rows in series.items():
        pos = [index[d] for d, _ in rows]
        first = pos[0]
        values = [None] * (pos[-1] - first + 1)
        for p, (_, v) in zip(pos, rows):
            values[p - first] = round(v, DECIMALS)
        path = os.path.join(outdir, market, '%s.json' % code)
        write_json(path, {'code': code, 'first': first, 'values': values})
        total_bytes += os.path.getsize(path)
        written += 1

    have = len(existing_coverage(outdir, market))

    # index.json 兩個市場共用。這裡只動自己那一格，而且記的是**總共有幾檔曲線**，
    # 不是這次寫了幾檔 —— 只補缺的那種執行只會寫少少幾檔，寫成 written 的話
    # 看起來像是曲線變少了（實際上檔案都還在）。
    idx_path = os.path.join(outdir, 'index.json')
    idx = {'start': START, 'markets': {}}
    if os.path.exists(idx_path):
        try:
            idx = json.load(io.open(idx_path, encoding='utf-8'))
        except Exception:                                     # noqa: BLE001
            pass
    idx.setdefault('markets', {})[market] = have
    idx['%sSource' % market] = source
    write_json(idx_path, idx)

    log(u'這次寫出 %d 檔，共 %.1f MB，平均每檔 %.1f KB'
        % (written, total_bytes / 1e6, total_bytes / max(1, written) / 1024.0))
    log(u'目前總共有曲線的：%d 檔' % have)
    return written, have


def parse_args(argv, default_outdir):
    u"""共用的命令列：[outdir] [--limit N] [--only-missing]。"""
    outdir = (argv[1] if len(argv) > 1 and not argv[1].startswith('--')
              else default_outdir)
    limit = None
    for i, a in enumerate(argv[1:]):
        if a.startswith('--limit'):
            limit = int(a.split('=')[1]) if '=' in a else int(argv[i + 2])
    return outdir, limit, '--only-missing' in argv[1:]


def select_codes(codes, coverage, limit, only_missing):
    u"""決定這一輪要抓誰。回傳 None 表示沒有要抓的，可以直接收工。

    --only-missing 是給「沿用快取」的部署用的：通常一檔都不缺，一個請求都不發
    就結束；缺的時候（上一輪被 FinMind 擋下來）才補上。
    """
    ordered = order_by_staleness(codes, coverage)
    if limit:
        ordered = ordered[:limit]
    stale = [c for c in ordered if not coverage.get(c)]
    if only_missing:
        if not stale:
            log(u'%d 檔都有曲線了，這次不用抓' % len(ordered))
            return None
        log(u'只補沒有曲線的 %d 檔（其餘 %d 檔維持現狀）'
            % (len(stale), len(ordered) - len(stale)))
        return stale
    if stale:
        log(u'%d 檔還沒有曲線，這次優先抓' % len(stale))
    return ordered
