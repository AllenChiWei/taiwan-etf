# -*- coding: utf-8 -*-
u"""台股 ETF 的績效曲線，改用 FinMind 產生（不動用 FinLab，也不需要加密）。

    python scripts/fetch_series_tw.py [outdir] [--limit N]

輸出與 fetch_series.py 完全相同的格式，只是市場只有 tw：

    _tw.json      {"market":"tw","dates":["2019-01-02", …]}
    tw/0050.json  {"code":"0050","first":12,"values":[…]}

## 為什麼要換掉 FinLab

曲線原本來自 FinLab 的 `etl:adj_close`。那是付費訂閱的資料，所以檔案上線前必須加密，
而加密需要 `SITE_PASSWORD` secret —— 沒設定時部署會把曲線整個丟掉，收藏頁的績效比較
就一片空白。實際發生的就是這件事。

改用 FinMind 之後這條鍊子整個不見了：資料來自公開的台灣市場資料，不必加密，
任何人打開收藏頁都看得到曲線，也不再佔用 FinLab 的每日額度。

    finmindtrade.com/robots.txt   User-agent: * / Allow: /
    query1.finance.yahoo.com      User-agent: * / Disallow: /   ← yfinance 打的是這台

美股曲線仍然來自 FinLab（三千七百檔逐檔請求不可行），所以那一份繼續加密。

## 還原股價自己算

FinMind 給的是原始收盤價，所以總報酬要自己接：

    第 t 天的報酬 = (收盤[t] + 當天除息金額) / 收盤[t-1] - 1

也就是把配息在除息日當天以收盤價再投入。配息來自 `dividends.json`（交易所公告為主，
FinMind 回補上櫃的歷史）。最後把整條曲線等比例縮放，讓末值等於實際收盤價 ——
這樣數字看起來還是價格，而圖表本來就只看相對變化。

**配息紀錄不完整的那幾檔，曲線會低估報酬。** 這是誠實的限制：沒有紀錄就等於沒有
再投入。`dividends.json` 的覆蓋率會隨每日累積往上走。

## 分割要另外處理

FinMind 給的是原始收盤價，所以 1 拆 4 在資料上就是「一天掉 75%」。0050 在
2025-06-18 分割，不處理的話近三年報酬會算成 -6%，實際是 +263%（驗算時就是這樣被
抓出來的）。

做法是「先偵測、再查證」：單日跌幅超過 20% 且無法用當天的配息解釋時，才去查 FinMind
的 `TaiwanStockSplitPrice` 拿到 before/after 價格，比值就是分割比例。這樣每檔不必多打
一次請求 —— 會觸發的只有極少數。查不到分割紀錄就**不調整**，只記一筆警告：
那可能是真的暴跌，硬調整反而會把真實的虧損抹掉。
"""
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'app', 'public', 'data')
OUTDIR = (sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--')
          else os.path.join(DATA, 'series'))

LIMIT = None
for i, a in enumerate(sys.argv[1:]):
    if a.startswith('--limit'):
        LIMIT = int(a.split('=')[1]) if '=' in a else int(sys.argv[i + 2])
# 只補「完全沒有曲線」的那幾檔。沿用快取的部署用這個模式：通常一檔都不缺，
# 於是一個請求都不發就結束；缺的時候（上次被 FinMind 擋下來）才補上。
ONLY_MISSING = '--only-missing' in sys.argv[1:]

API = 'https://api.finmindtrade.com/api/v4/data'
# 免費註冊就能拿到的 token，把每小時額度從 300 拉到 600 次。沒有也能跑 ——
# 只是一次執行跑不完三百多檔，會分兩天補齊（見 main() 裡的排序）。
TOKEN = os.environ.get('FINMIND_TOKEN', '').strip()
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) performance curves')
START = '2019-01-01'
DECIMALS = 2
TPE = timezone(timedelta(hours=8))

# 免費層的節流。三百多檔跑完約十分鐘，一天一次。
DELAY = 1.5
TIMEOUT = 60
# 資料太短畫不出有意義的曲線，與 fetch_series.py 的門檻一致
MIN_POINTS = 30
# 單日跌幅超過這個比例且配息解釋不了時，就懷疑是分割。與 fetch_calc.py 的
# SPLIT_MIN_PCT 同一條線：全市場最大的單日配息落差約 17%，最小的分割是 75%。
SPLIT_DROP = 0.80

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


class RateLimited(Exception):
    u"""FinMind 的每小時額度用完了。這不是可以重試的錯誤 —— 重試只會更慢。"""


def _check_limit(err_or_doc):
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


def remap_existing(outdir, old_dates, new_index, skip):
    u"""把舊日曆寫的檔案改對到新日曆上。回傳處理了幾檔。

    values 是「從 first 起連續的每個交易日」，所以日曆中間插進新的一天時
    單純平移是不夠的 —— 拿 (日期, 數值) 重新鋪一次才正確。
    """
    d = os.path.join(outdir, 'tw')
    if not os.path.isdir(d):
        return 0
    done = 0
    for f in sorted(os.listdir(d)):
        if not f.endswith('.json') or f.startswith('_'):
            continue
        code = f[:-5]
        if code in skip:
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


def existing_dates(outdir):
    u"""既有日曆的日期。第一次執行時是空的。"""
    try:
        return json.load(io.open(os.path.join(outdir, '_tw.json'),
                                 encoding='utf-8'))['dates']
    except Exception:                                         # noqa: BLE001
        return []


def existing_coverage(outdir):
    u"""{代號: 這檔目前資料到哪一天}。沒有檔案的就不在裡面。

    不另外存狀態檔 —— 既有的 `_tw.json` 日曆加上每檔的 first/values 長度，
    本來就足以回答「這檔的資料到哪一天」。
    """
    cal = existing_dates(outdir)
    if not cal:
        return {}
    d = os.path.join(outdir, 'tw')
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


def fetch_prices(code, tries=3):
    u"""回傳 [(日期, 收盤價)]，由舊到新；失敗回 None。"""
    params = {'dataset': 'TaiwanStockPrice', 'data_id': code,
              'start_date': START, 'end_date': date.today().isoformat()}
    if TOKEN:
        params['token'] = TOKEN
    url = API + '?' + urllib.parse.urlencode(params)
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            raw = urllib.request.urlopen(req, timeout=TIMEOUT).read()
            doc = json.loads(raw.decode('utf-8'))
            _check_limit(doc)
            if doc.get('msg') != 'success':
                return None
            rows = []
            for r in doc.get('data') or []:
                c = r.get('close')
                d = str(r.get('date') or '')
                if d and c and float(c) > 0:
                    rows.append((d, float(c)))
            rows.sort()
            return rows
        except RateLimited:
            raise
        except Exception as e:                                # noqa: BLE001
            _check_limit(e)
            if attempt == tries:
                note(u'%s 價格抓取失敗：%s' % (code, str(e)[:60]))
                return None
            time.sleep(DELAY * attempt)
    return None


def fetch_splits(code, tries=2):
    u"""{分割日: 比例}。比例 = 分割前價 / 分割後價（1 拆 4 就是 4）。"""
    params = {'dataset': 'TaiwanStockSplitPrice', 'data_id': code,
              'start_date': START, 'end_date': date.today().isoformat()}
    if TOKEN:
        params['token'] = TOKEN
    url = API + '?' + urllib.parse.urlencode(params)
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            doc = json.loads(urllib.request.urlopen(req, timeout=TIMEOUT).read()
                             .decode('utf-8'))
            _check_limit(doc)
            if doc.get('msg') != 'success':
                return {}
            out = {}
            for r in doc.get('data') or []:
                before = r.get('before_price')
                after = r.get('after_price')
                day = str(r.get('date') or '')
                if day and before and after and after > 0:
                    out[day] = float(before) / float(after)
            return out
        except RateLimited:
            raise
        except Exception as e:                                # noqa: BLE001
            _check_limit(e)
            if attempt == tries:
                return {}
            time.sleep(DELAY)
    return {}


def suspicious_days(rows, divs):
    u"""配息解釋不了的單日暴跌。這些日子才值得去查有沒有分割。"""
    out = []
    for i in range(1, len(rows)):
        prev, cur = rows[i - 1][1], rows[i][1]
        d = divs.get(rows[i][0], 0.0)
        if prev > 0 and (cur + d) / prev < SPLIT_DROP:
            out.append(rows[i][0])
    return out


def total_return(rows, divs, splits=None):
    u"""原始收盤價 + 除息金額 -> 還原收盤價（末值等於實際收盤價）。

    divs 是 {除息日: 每股配息}。除息當天把配息以當天收盤價再投入 ——
    這是總報酬曲線的標準接法，與台股頁報酬率「含息」的定義一致。

    splits 是 {分割日: 比例}；分割當天的價格要先乘回比例，否則 1 拆 4 會被當成
    一天跌掉 75%。
    """
    if not rows:
        return []
    splits = splits or {}
    factors = [1.0]
    for i in range(1, len(rows)):
        prev = rows[i - 1][1]
        cur = rows[i][1] * splits.get(rows[i][0], 1.0)
        d = divs.get(rows[i][0], 0.0)
        step = (cur + d) / prev if prev > 0 else 1.0
        factors.append(factors[-1] * step)
    last_close = rows[-1][1]
    scale = last_close / factors[-1] if factors[-1] > 0 else 1.0
    return [f * scale for f in factors]


def main():
    log(u'台股曲線：FinMind 價格 + 交易所公告配息（不使用 FinLab）')
    log(u'額度：%s' % (u'有 FINMIND_TOKEN，每小時 600 次'
                       if TOKEN else u'沒有 FINMIND_TOKEN，每小時 300 次'))

    etfs = json.load(io.open(os.path.join(DATA, 'etfs.json'), encoding='utf-8'))
    codes = [e['code'] for e in etfs['etfs']]

    # **順序是有意義的。** FinMind 的免費額度是以小時計的，一次執行不一定跑得完
    # 三百多檔 —— 第一次上線就在第 293 檔被擋下來，尾巴剛好是槓桿／反向／期貨與
    # 幾檔新債券 ETF（它們排在 etfs.json 最後面），結果那 60 檔整批沒有曲線。
    # 所以每次都從「資料最舊的」開始抓：沒有檔案的排最前，其餘按最後一天排序。
    # 被擋下來時已經抓到的照常寫出，下一次執行接著補完。
    coverage = existing_coverage(OUTDIR)
    codes.sort(key=lambda c: (coverage.get(c, ''), c))
    if LIMIT:
        codes = codes[:LIMIT]
    stale = [c for c in codes if not coverage.get(c)]
    if ONLY_MISSING:
        if not stale:
            log(u'%d 檔都有曲線了，這次不用抓' % len(codes))
            return 0
        log(u'只補沒有曲線的 %d 檔（其餘 %d 檔維持現狀）'
            % (len(stale), len(codes) - len(stale)))
        codes = stale
    elif stale:
        log(u'%d 檔還沒有曲線，這次優先抓' % len(stale))

    try:
        divdoc = json.load(io.open(os.path.join(DATA, 'dividends.json'),
                                   encoding='utf-8'))['dividends']
    except Exception as e:                                    # noqa: BLE001
        note(u'讀不到 dividends.json（%s），曲線會是未還原的價格' % str(e)[:50])
        divdoc = {}

    log(u'%d 檔，開始抓價格…' % len(codes))
    series = {}
    limited = False
    for n, code in enumerate(codes, 1):
        try:
            rows = fetch_prices(code)
        except RateLimited as e:
            note(u'FinMind 額度用完（%s），這次抓到 %d 檔就停；下一次會從沒抓到的開始'
                 % (e, len(series)))
            limited = True
            break
        time.sleep(DELAY)
        if not rows or len(rows) < MIN_POINTS:
            continue
        divs = dict((r[0], float(r[1])) for r in (divdoc.get(code) or []))
        # 先偵測再查證：會觸發的只有極少數，所以不會讓請求數翻倍
        odd = suspicious_days(rows, divs)
        splits = {}
        if odd:
            try:
                splits = fetch_splits(code)
            except RateLimited:
                splits = {}                 # 沒查到就不調整，跟查不到分割一樣處理
            time.sleep(DELAY)
            unexplained = [d for d in odd if d not in splits]
            if unexplained:
                # 查不到分割就不調整 —— 那可能是真的暴跌，硬調會抹掉真實虧損
                note(u'%s 在 %s 單日暴跌但查不到分割紀錄，未調整'
                     % (code, u'、'.join(unexplained[:3])))
            if splits:
                log(u'  %s 有 %d 次分割（%s）'
                    % (code, len(splits),
                       u'、'.join(u'%s×%.2g' % (d, r) for d, r in
                                  sorted(splits.items())[:3])))
        series[code] = (rows, total_return(rows, divs, splits), len(divs))
        if n % 50 == 0:
            log(u'  %d/%d（已取得 %d 檔）' % (n, len(codes), len(series)))

    if not series:
        # --only-missing 時這不是錯誤：還沒有曲線的往往是剛上市、
        # 交易日還不到 MIN_POINTS 的新 ETF（實測六檔，13～21 天）。
        log(u'一檔都沒拿到，不寫出任何檔案')
        return 0 if ONLY_MISSING else 1

    # 共用的交易日曆：所有標的的日期取聯集。
    #
    # **要跟既有的那份合併，不能直接覆蓋**，因為不是每次執行都會重抓所有標的
    # （被 FinMind 擋下來時只抓到一部分）。沒重抓的檔案，它們的 first 是對著
    # 舊日曆的索引，日曆一變它們就整條位移。
    old_dates = existing_dates(OUTDIR)
    fresh = {d for rows, _, _ in series.values() for d, _ in rows}
    dates = sorted(fresh | set(old_dates))
    index = dict((d, i) for i, d in enumerate(dates))
    log(u'交易日曆 %d 天（%s ~ %s）' % (len(dates), dates[0], dates[-1]))
    write_json(os.path.join(OUTDIR, '_tw.json'), {'market': 'tw', 'dates': dates})

    # 補抓一檔歷史更長的，日曆會往**前面**長，不是只在後面接 —— 所以不能只算位移，
    # 要拿日期重新對位。沒重抓的檔案才需要處理，這次寫出的下面本來就會覆蓋。
    if old_dates and old_dates != dates:
        n = remap_existing(OUTDIR, old_dates, index, set(series))
        log(u'日曆有變動，重新對位既有的 %d 檔' % n)

    written = 0
    total_bytes = 0
    with_div = 0
    for code, (rows, adj, ndiv) in series.items():
        pos = [index[d] for d, _ in rows]
        first = pos[0]
        values = [None] * (pos[-1] - first + 1)
        for p, v in zip(pos, adj):
            values[p - first] = round(v, DECIMALS)
        write_json(os.path.join(OUTDIR, 'tw', '%s.json' % code),
                   {'code': code, 'first': first, 'values': values})
        total_bytes += os.path.getsize(os.path.join(OUTDIR, 'tw', '%s.json' % code))
        written += 1
        with_div += 1 if ndiv else 0

    have = len(existing_coverage(OUTDIR))

    # index.json 與 fetch_series.py 共用：美股那一半由它填，這裡只更新 tw
    idx_path = os.path.join(OUTDIR, 'index.json')
    idx = {'start': START, 'markets': {}}
    if os.path.exists(idx_path):
        try:
            idx = json.load(io.open(idx_path, encoding='utf-8'))
        except Exception:                                     # noqa: BLE001
            pass
    # 這裡要記**總共有幾檔曲線**，不是這次寫了幾檔 —— 只補缺的那種執行只會寫
    # 少少幾檔，寫成 written 的話線上看起來像是曲線變少了（實際上檔案都還在）。
    idx.setdefault('markets', {})['tw'] = have
    idx['twSource'] = 'finmind'
    write_json(idx_path, idx)

    log(u'完成：這次寫出 %d 檔（%d 檔有配息紀錄可還原），共 %.1f MB，平均每檔 %.1f KB'
        % (written, with_div, total_bytes / 1e6,
           total_bytes / max(1, written) / 1024.0))
    log(u'目前總共有曲線的：%d 檔' % have)
    if limited:
        note(u'被 FinMind 擋下來，還有標的沒有曲線；下一次執行會優先補')
    if ERRORS:
        log(u'有 %d 檔抓取失敗' % len(ERRORS))
    return 0


if __name__ == '__main__':
    sys.exit(main())
