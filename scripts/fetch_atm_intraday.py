# -*- coding: utf-8 -*-
u"""台指選擇權週選的**盤中**價平和（每 15 分鐘），從期交所逐筆成交資料算。

    python scripts/fetch_atm_intraday.py            補齊期交所還提供的日子（最多前 30 個交易日）
    python scripts/fetch_atm_intraday.py --date 2026-10-02

輸出（**進版控**，每天一個小檔、寫好就不再改，所以 Git 歷史每天只多約 8 KB）：

    app/public/data/atm_intraday/YYYY-MM-DD.json   一個交易日（含前一晚的夜盤）
    app/public/data/atm_intraday/index.json        只列有哪些日期

統計（各時段的消耗、星期幾、剩幾天）由前端讀最近 N 天的日檔即時算，
不另外存一份每天重寫的大檔 —— 那種檔每天整份重寫，Git 歷史會一年長好幾百 MB。

## 資料來源與時段

期交所「選擇權每筆成交資料」：OptionsDaily_YYYY_MM_DD.zip（Big5，約 2 MB，解壓 120 MB），
只保留前 30 個交易日，所以每天都要抓，晚了就補不回來。

**D 日的檔案 = D 的前一晚夜盤（D−1 15:00 ～ D 05:00）＋ D 日盤（08:45 ～ 13:45）**，
和期交所「夜盤屬於下一個交易日」的慣例一致（2026-10-02 的檔案實測：成交日期 20261001
的時間全落在 15:00～23:59，20261002 的落在 00:00～05:00 與 08:45～13:45）。

## 定義（與 fetch_atm.py 相同，只是改成每個時間點）

    每 15 分鐘的時間點 T：每個履約價取「T 以前、同一盤別、30 分鐘內」最後一筆 Call／Put 成交價
    價平履約價 = |Call − Put| 最小者（至少 5 個履約價兩邊都有成交才算）
    價平和     = Call + Put
    合成期貨   = 履約價 + Call − Put（買賣權平價，不用另外抓期貨）

系列與合約排序沿用 fetch_atm.py：W 系列與月選＝週三系列，F 系列＝週五系列，
每個系列記最近到期（r=0）與第二近（r=1）。到期日優先查 atm.json，查不到才用規則推算。
"""
import io
import json
import os
import re
import sys
import tempfile
import time
import urllib.request
import zipfile
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_atm import series_of  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'app', 'public', 'data', 'atm_intraday')
ATM_JSON = os.path.join(ROOT, 'app', 'public', 'data', 'atm.json')
LIST_URL = 'https://www.taifex.com.tw/cht/3/dlOptPrevious30DaysSalesData'
ZIP_URL = ('https://www.taifex.com.tw/file/taifex/Dailydownload/OptionsDailydownload/'
           'OptionsDaily_%s.zip')
UA = {'User-Agent': ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
                     '+https://allenchiwei.github.io/taiwan-etf/) TXO intraday ATM')}
STEP = 15            # 分鐘
STALE = 30           # 成交超過幾分鐘就不算「現在的價格」
MIN_PAIRS = 5
DELAY = 2.0
ERRORS = []


def log(m):
    print(m, flush=True)


def note(m):
    log(u'  ⚠ ' + m)
    ERRORS.append(m)


def buckets():
    u"""時間點（分鐘，夜盤 15:15 起算到隔天 05:00，再接日盤 09:00～13:45），依時間先後。"""
    night = list(range(15 * 60 + STEP, 24 * 60 + 5 * 60 + 1, STEP))       # 915 … 1740（=05:00 隔天）
    day = list(range(9 * 60, 13 * 60 + 45 + 1, STEP))                      # 540 … 825
    return [('N', m) for m in night] + [('D', 24 * 60 + 5 * 60 + 1 + m) for m in day]


def label(sess, m):
    if sess == 'D':
        m -= 24 * 60 + 5 * 60 + 1
    m %= 24 * 60
    return '%02d:%02d' % (m // 60, m % 60)


def tick_minute(trade_date, hhmmss, d):
    u"""逐筆時間 → (盤別, 自 D−1 00:00 起算的分鐘，日盤另外平移到夜盤之後)。不在交易時段回傳 None。"""
    hh, mm, ss = hhmmss // 10000, hhmmss // 100 % 100, hhmmss % 100
    t = hh * 60 + mm + ss / 60.0
    if trade_date < d:                         # 前一晚 15:00～24:00
        return ('N', t) if t >= 15 * 60 else None
    if t <= 5 * 60:                            # 凌晨 00:00～05:00
        return ('N', 24 * 60 + t)
    if 8 * 60 + 45 <= t <= 13 * 60 + 45:       # 日盤
        return ('D', 24 * 60 + 5 * 60 + 1 + t)
    return None


def nth_weekday(y, mth, wd, n):
    first = date(y, mth, 1)
    off = (wd - first.weekday()) % 7
    return first + timedelta(days=off + 7 * (n - 1))


def guess_expiry(contract):
    u"""查不到 atm.json 時的推算（不處理連假移位）：W n＝第 n 個週三、F n＝第 n 個週五、月選＝第三個週三。"""
    m = re.match(r'^(\d{4})(\d{2})(?:([WF])(\d))?$', contract)
    if not m:
        return None
    y, mth = int(m.group(1)), int(m.group(2))
    if not m.group(3):
        return nth_weekday(y, mth, 2, 3)
    return nth_weekday(y, mth, 2 if m.group(3) == 'W' else 4, int(m.group(4)))


def expiry_map():
    out = {}
    try:
        for r in json.load(io.open(ATM_JSON, encoding='utf-8')).get('rows') or []:
            out[r['c']] = r['e']
    except Exception as e:                                    # noqa: BLE001
        note(u'atm.json 讀不起來（%s），到期日全部用規則推算' % str(e)[:50])
    return out


def available_dates():
    u"""期交所目前還提供哪些日期（前 30 個交易日）。"""
    req = urllib.request.Request(LIST_URL, headers=UA)
    html = urllib.request.urlopen(req, timeout=60).read().decode('utf-8', errors='replace')
    days = sorted(set(re.findall(r'OptionsDaily_(\d{4})_(\d{2})_(\d{2})\.zip', html)))
    return ['%s-%s-%s' % d for d in days]


def download(day, tmp):
    path = os.path.join(tmp, 'OptionsDaily_%s.zip' % day.replace('-', '_'))
    for attempt in range(1, 4):
        try:
            req = urllib.request.Request(ZIP_URL % day.replace('-', '_'), headers=UA)
            raw = urllib.request.urlopen(req, timeout=180).read()
            if raw[:2] != b'PK':
                raise ValueError(u'不是 zip（%d bytes）' % len(raw))
            with open(path, 'wb') as fh:
                fh.write(raw)
            time.sleep(DELAY)
            return path
        except Exception as e:                                # noqa: BLE001
            if attempt == 3:
                note(u'%s 下載失敗：%s' % (day, str(e)[:60]))
                return None
            time.sleep(DELAY * attempt)
    return None


def parse_ticks(path, d):
    u"""-> {合約: [(盤別, 分鐘, 履約價, 'C'/'P', 價格)]}，只留 TXO、依時間排序。"""
    dd = int(d.replace('-', ''))
    out = {}
    with zipfile.ZipFile(path) as z:
        with z.open(z.namelist()[0]) as fh:
            for raw in io.TextIOWrapper(fh, encoding='big5', errors='replace'):
                if 'TXO' not in raw:
                    continue
                p = [x.strip() for x in raw.split(',')]
                if len(p) < 7 or p[1] != 'TXO':
                    continue
                try:
                    td, k, t, px = int(p[0]), int(float(p[2])), int(p[5]), float(p[6])
                except ValueError:
                    continue
                if px <= 0 or p[4] not in ('C', 'P'):
                    continue
                tm = tick_minute(td, t, dd)
                if tm is None:
                    continue
                out.setdefault(p[3], []).append((tm[0], tm[1], k, p[4], px))
    for v in out.values():
        v.sort(key=lambda x: x[1])
    return out


def series_rows(ticks, bks):
    u"""一口合約 → 每個時間點的 (履約價, Call, Put)。"""
    last = {}            # (履約價, C/P) -> (分鐘, 價格, 盤別)
    i, n = 0, len(ticks)
    ks, cs, ps = [], [], []
    for sess, end in bks:
        while i < n and ticks[i][1] <= end:
            s, m, k, cp, px = ticks[i]
            last[(k, cp)] = (m, px, s)
            i += 1
        pairs = []
        for (k, cp), (m, px, s) in last.items():
            if cp != 'C' or s != sess or end - m > STALE:
                continue
            q = last.get((k, 'P'))
            if q and q[2] == sess and end - q[0] <= STALE:
                pairs.append((k, px, q[1]))
        if len(pairs) < MIN_PAIRS:
            ks.append(None), cs.append(None), ps.append(None)
            continue
        k, c, p = min(pairs, key=lambda x: (abs(x[1] - x[2]), x[0]))
        ks.append(k), cs.append(round(c, 1)), ps.append(round(p, 1))
    return ks, cs, ps


def build_day(d, path, expiries):
    bks = buckets()
    by_contract = parse_ticks(path, d)
    dd = datetime.strptime(d, '%Y-%m-%d').date()
    groups = {}
    for c in by_contract:
        s = series_of(c)
        if s is None:
            continue
        e = expiries.get(c)
        e = datetime.strptime(e, '%Y-%m-%d').date() if e else guess_expiry(c)
        if e is None or e < dd:
            continue
        groups.setdefault(s, []).append((e, c))
    rows = []
    for s in sorted(groups):
        for r, (e, c) in enumerate(sorted(groups[s])[:2]):
            ks, cs, ps = series_rows(by_contract[c], bks)
            if not any(k is not None for k in ks):
                continue
            rows.append({'s': s, 'r': r, 'c': c, 'e': e.isoformat(), 'dte': (e - dd).days,
                         'k': ks, 'call': cs, 'put': ps})
    return {'d': d, 'step': STEP, 'sess': [b[0] for b in bks], 't': [label(*b) for b in bks], 'rows': rows}


def complete(path):
    u"""日檔裡有沒有任何日盤的價平和。"""
    try:
        doc = json.load(io.open(path, encoding='utf-8'))
    except Exception:                                         # noqa: BLE001
        return False
    day = [i for i, s in enumerate(doc.get('sess') or []) if s == 'D']
    return any(r['call'][i] is not None for r in doc.get('rows') or [] for i in day)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')))


def main():
    args = sys.argv[1:]
    only = args[args.index('--date') + 1] if '--date' in args else None
    have = set(f[:-5] for f in os.listdir(OUT_DIR) if re.match(r'^\d{4}-\d{2}-\d{2}\.json$', f)) \
        if os.path.isdir(OUT_DIR) else set()
    # 只有夜盤的日檔還沒完成：期交所週末就先公布「週五夜盤」（歸屬下週一），
    # 日盤要等那天收盤後才有。這種檔下次要重抓，否則日盤永遠補不進來。
    partial = set(d for d in have if not complete(os.path.join(OUT_DIR, d + '.json')))
    try:
        avail = [only] if only else available_dates()
    except Exception as e:                                    # noqa: BLE001
        note(u'讀不到期交所的日期清單：%s' % str(e)[:60])
        avail = []
    todo = [d for d in avail if only or d not in have or d in partial]
    log(u'期交所提供 %d 天，已有 %d 天（%d 天只有夜盤），這次要做 %d 天'
        % (len(avail), len(have), len(partial), len(todo)))
    expiries = expiry_map()
    with tempfile.TemporaryDirectory(prefix='atm_intraday_') as tmp:
        for d in todo:
            path = download(d, tmp)
            if not path:
                continue
            doc = build_day(d, path, expiries)
            os.remove(path)
            if not doc['rows']:
                note(u'%s 沒有可用的週選價平和' % d)
                continue
            write_json(os.path.join(OUT_DIR, d + '.json'), doc)
            have.add(d)
            log(u'%s：%s' % (d, '、'.join('%s r%d %s' % (r['s'], r['r'], r['c']) for r in doc['rows'])))
    write_json(os.path.join(OUT_DIR, 'index.json'), {'dates': sorted(have), 'step': STEP,
                                                     'source': u'期交所選擇權每筆成交資料'})
    if ERRORS:
        log(u'完成，但有 %d 個警告' % len(ERRORS))
    return 0


if __name__ == '__main__':
    sys.exit(main())
