# -*- coding: utf-8 -*-
u"""創新高／新低與漲跌幅：每檔個股與 ETF 的位階與各期間報酬。

    python scripts/fetch_highs.py [outfile]

預設寫到 app/public/data/highs.json（不進版控，部署時產生）。

## 為什麼這支不會多花 FinLab 流量

它用的 `etl:adj_close` 與 `price:收盤價` 正是 `fetch_calc.py` 抓過的那兩份。同一次部署裡兩支
腳本共用 `.cache/finlab_db`（見 finlab_client.py），所以第二次讀是讀本機檔案，
不再向伺服器要 —— 前提是**跟 fetch_calc.py 在同一次執行裡跑**。單獨執行它會
真的下載一次，那就要算進當天的額度。

## 為什麼不從交易所抓

交易所的每日收盤行情要一天一個請求：回補 200 個交易日就是 200 次請求、
好幾百 MB 的流量，對他們不禮貌，而 FinLab 那份已經在手上了。

## 為什麼用還原股價算高低點

未還原的收盤價會讓除權息與分割看起來像暴跌：00631L 那類做過分割的標的，
用原始價算會顯示「距高點 -93%」，但那是分割不是下跌。所以高低點與「是否創新高」
一律用 `etl:adj_close`（它也是 fetch_calc.py 抓過的那一份），而畫面上顯示的
收盤價則是原始價 —— 使用者要看的是現在多少錢，不是還原後的數字。

## 產出的是統計，不是資料集本身

只寫出「最新收盤、期間高低、距高點幾 %、是不是新高」這種每檔幾個數字的摘要 ——
與台股頁的報酬率同一類的衍生統計，不是那份按日的價格序列，所以不加密。
"""
import io
import json
import os
import sys
import warnings
from datetime import datetime, timedelta, timezone

warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = (sys.argv[1] if len(sys.argv) > 1
       else os.path.join(ROOT, 'app', 'public', 'data', 'highs.json'))

TPE = timezone(timedelta(hours=8))

# 三個常用的窗口。150 約七個月、200 約十個月、250 約一年。
WINDOWS = (150, 200, 250)
# 預設顯示哪一個（前端的初始值也用它）
DEFAULT_WINDOW = 200

# 漲跌幅的期間，以交易日計：一週、一月、一季、半年。
# 用交易日而不是日曆日，才不會因為連假讓不同標的的期間長度不一樣。
RETURN_DAYS = [('r5', 5), ('r20', 20), ('r60', 60), ('r120', 120)]
# 低於這個成交價的不收：一兩元的雞蛋水餃股，百分比變動沒有參考意義
MIN_PRICE = 1.0


def log(m):
    print(m, flush=True)


def write_json(path, obj):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')))


def load_names():
    u"""代號 -> (名稱, 市場／類別)。個股取自 fin_history，ETF 取自 etfs.json。"""
    names = {}
    data = os.path.join(ROOT, 'app', 'public', 'data')
    try:
        hist = json.load(io.open(os.path.join(data, 'fin_history.json'),
                                 encoding='utf-8'))
        for code, meta in (hist.get('info') or {}).items():
            names[code] = (meta.get('name') or code, meta.get('market') or u'個股')
    except Exception as e:                                    # noqa: BLE001
        log(u'  讀不到 fin_history.json（%s），個股名稱會缺' % str(e)[:60])
    try:
        etfs = json.load(io.open(os.path.join(data, 'etfs.json'), encoding='utf-8'))
        for r in etfs.get('etfs') or []:
            names[r['code']] = (r['name'], 'ETF')
    except Exception as e:                                    # noqa: BLE001
        log(u'  讀不到 etfs.json（%s），ETF 名稱會缺' % str(e)[:60])
    return names


def main():
    from finlab_client import login
    login()
    from finlab import data

    names = load_names()
    log(u'名稱對照 %d 檔' % len(names))

    log(u'讀取還原股價與收盤價（與 fetch_calc.py 共用同一份，不會重複下載）…')
    adj = data.get('etl:adj_close')
    close = data.get(u'price:收盤價')
    # 取最長的窗口就夠：150 與 200 都是它的尾段
    span = max(max(WINDOWS), max(d for _, d in RETURN_DAYS))
    window = adj.tail(span)
    asof = window.index[-1]
    log(u'  %d 個交易日，最新 %s，%d 檔有報價'
        % (len(window), asof.date().isoformat(), window.shape[1]))

    rows = []
    counts = dict((w, {'high': 0, 'low': 0}) for w in WINDOWS)
    for code in window.columns:
        if code not in names:
            continue                                   # 權證、受益證券之類的不收
        series = window[code].dropna()
        if len(series) < 20:                           # 上市不到一個月，位階沒有意義
            continue
        last = float(series.iloc[-1])                  # 還原價，只用來比較
        # 畫面上要顯示的是原始收盤價 —— 使用者看的是現在多少錢
        raw = close[code].dropna() if code in close.columns else None
        shown = float(raw.iloc[-1]) if raw is not None and len(raw) else last
        if shown < MIN_PRICE:
            continue

        # 每個窗口一組：高、低（換算成原始價的尺度）、距高點 %、距低點 %
        wins = {}
        for w in WINDOWS:
            seg = series.tail(w)
            if len(seg) < min(20, w):
                continue
            high = float(seg.max())
            low = float(seg.min())
            if not high or not low:
                continue
            is_high = last >= high - 1e-9
            is_low = last <= low + 1e-9
            counts[w]['high'] += 1 if is_high else 0
            counts[w]['low'] += 1 if is_low else 0
            wins[str(w)] = {
                'h': round(high / last * shown, 2),
                'l': round(low / last * shown, 2),
                'fh': round((last / high - 1) * 100, 2),
                'fl': round((last / low - 1) * 100, 2),
                'nh': 1 if is_high else 0,
                'nl': 1 if is_low else 0,
                'days': len(seg),
            }
        if not wins:
            continue

        # 漲跌幅用還原股價 —— 不然除息當天會變成「大跌」。與台股頁的報酬率同一套算法。
        rets = {}
        for key, days in RETURN_DAYS:
            if len(series) <= days:
                rets[key] = None
                continue
            base = float(series.iloc[-(days + 1)])
            rets[key] = round((last / base - 1) * 100, 2) if base else None

        name, kind = names[code]
        row = {'c': code, 'n': name, 'k': kind, 'p': round(shown, 2),
               'days': len(series), 'w': wins}
        row.update(rets)
        rows.append(row)

    # 預設窗口的創新高排前面，其餘照「離高點多近」排 —— fh 是負數，由大到小才是由近到遠。
    # 第一版寫成由小到大，結果排在最前面的是距高點 -96% 的那些，剛好相反。
    def sort_key(r):
        w = r['w'].get(str(DEFAULT_WINDOW)) or {}
        return (-(w.get('nh') or 0), -(w.get('fh') if w.get('fh') is not None else -999))
    rows.sort(key=sort_key)

    payload = {
        'meta': {
            'date': asof.date().isoformat(),
            'updated': datetime.now(TPE).date().isoformat(),
            'windows': list(WINDOWS),
            'defaultWindow': DEFAULT_WINDOW,
            'returns': [k for k, _ in RETURN_DAYS],
            'count': len(rows),
            # 每個窗口各自的家數
            'newHighs': dict((str(w), counts[w]['high']) for w in WINDOWS),
            'newLows': dict((str(w), counts[w]['low']) for w in WINDOWS),
            'source': u'依還原股價計算（FinLab etl:adj_close），為衍生統計',
            'note': (u'創 N 日新高是指最新收盤價等於近 N 個交易日的最高收盤價。'
                     u'以還原股價計算（避免除權息與分割造成假性創低），不看盤中高低；'
                     u'漲跌幅同樣以還原股價計算，期間以交易日計（一週 5 日、一月 20 日、'
                     u'一季 60 日、半年 120 日）。顯示的股價則是原始收盤價。'),
        },
        'rows': rows,
    }
    write_json(OUT, payload)
    log(u'完成：%s（%.0f KB）' % (OUT, os.path.getsize(OUT) / 1024.0))
    for w in WINDOWS:
        log(u'  %d 日：創新高 %d 檔、創新低 %d 檔'
            % (w, counts[w]['high'], counts[w]['low']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
