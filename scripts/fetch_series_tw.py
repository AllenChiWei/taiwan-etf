# -*- coding: utf-8 -*-
u"""台股 ETF 的績效曲線，用 FinMind 產生（不動用 FinLab，也不需要加密）。

    python scripts/fetch_series_tw.py [outdir] [--limit N] [--only-missing]

輸出與 fetch_series.py 完全相同的格式，只是市場只有 tw：

    _tw.json      {"market":"tw","dates":["2019-01-02", …]}
    tw/0050.json  {"code":"0050","first":12,"values":[…]}

額度、輪替、日曆合併這些跟市場無關的機制在 `finmind_series.py`，兩個市場共用。
這支只管台股特有的部分：自己接還原股價，以及分割偵測。

## 為什麼要換掉 FinLab

曲線原本來自 FinLab 的 `etl:adj_close`。那是付費訂閱的資料，所以檔案上線前必須加密，
而加密需要 `SITE_PASSWORD` secret —— 沒設定時部署會把曲線整個丟掉，收藏頁的績效比較
就一片空白。實際發生的就是這件事。

改用 FinMind 之後這條鍊子整個不見了：資料來自公開的台灣市場資料，不必加密，
任何人打開收藏頁都看得到曲線，也不再佔用 FinLab 的每日額度。

    finmindtrade.com/robots.txt   User-agent: * / Allow: /
    query1.finance.yahoo.com      User-agent: * / Disallow: /   ← yfinance 打的是這台

## 還原股價自己算

FinMind 的台股資料給的是原始收盤價（美股那邊他們直接給還原價，見 fetch_series_us.py），
所以總報酬要自己接：

    第 t 天的報酬 = (收盤[t] + 當天除息金額) / 收盤[t-1] - 1

也就是把配息在除息日當天以收盤價再投入。配息來自 `dividends.json`（交易所公告為主，
FinMind 回補上櫃的歷史）。最後把整條曲線等比例縮放，讓末值等於實際收盤價 ——
這樣數字看起來還是價格，而圖表本來就只看相對變化。

**配息紀錄不完整的那幾檔，曲線會低估報酬。** 這是誠實的限制：沒有紀錄就等於沒有
再投入。`dividends.json` 的覆蓋率會隨每日累積往上走。

## 分割要另外處理

原始收盤價裡，1 拆 4 看起來就是「一天掉 75%」。0050 在 2025-06-18 分割，不處理的話
近三年報酬會算成 -6%，實際是 +263%（驗算時就是這樣被抓出來的）。

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
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import finmind_series as fm                                   # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'app', 'public', 'data')
OUTDIR, LIMIT, ONLY_MISSING = fm.parse_args(sys.argv, os.path.join(DATA, 'series'))

# 單日跌幅超過這個比例且配息解釋不了時，就懷疑是分割。與 fetch_calc.py 的
# SPLIT_MIN_PCT 同一條線：全市場最大的單日配息落差約 17%，最小的分割是 75%。
SPLIT_DROP = 0.80

log = fm.log
note = fm.note


def fetch_prices(code):
    u"""回傳 [(日期, 收盤價)]，由舊到新；失敗回 None。"""
    data = fm.api_rows('TaiwanStockPrice', code, date.today().isoformat())
    if data is None:
        return None
    rows = []
    for r in data:
        c = r.get('close')
        d = str(r.get('date') or '')
        if d and c and float(c) > 0:
            rows.append((d, float(c)))
    rows.sort()
    return rows


def fetch_splits(code):
    u"""{分割日: 比例}。比例 = 分割前價 / 分割後價（1 拆 4 就是 4）。"""
    data = fm.api_rows('TaiwanStockSplitPrice', code, date.today().isoformat(),
                       tries=2, quiet=True)
    out = {}
    for r in data or []:
        before = r.get('before_price')
        after = r.get('after_price')
        day = str(r.get('date') or '')
        if day and before and after and after > 0:
            out[day] = float(before) / float(after)
    return out


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
    log(fm.quota_line())

    etfs = json.load(io.open(os.path.join(DATA, 'etfs.json'), encoding='utf-8'))
    all_codes = [e['code'] for e in etfs['etfs']]
    coverage = fm.existing_coverage(OUTDIR, 'tw')
    codes = fm.select_codes(all_codes, coverage, LIMIT, ONLY_MISSING)
    if codes is None:
        return 0

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
        except fm.RateLimited as e:
            note(u'FinMind 額度用完（%s），這次抓到 %d 檔就停；下一次會從沒抓到的開始'
                 % (e, len(series)))
            limited = True
            break
        time.sleep(fm.DELAY)
        if not rows or len(rows) < fm.MIN_POINTS:
            continue
        divs = dict((r[0], float(r[1])) for r in (divdoc.get(code) or []))
        # 先偵測再查證：會觸發的只有極少數，所以不會讓請求數翻倍
        odd = suspicious_days(rows, divs)
        splits = {}
        if odd:
            try:
                splits = fetch_splits(code)
            except fm.RateLimited:
                splits = {}                 # 沒查到就不調整，跟查不到分割一樣處理
            time.sleep(fm.DELAY)
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
        adj = total_return(rows, divs, splits)
        series[code] = [(d, v) for (d, _), v in zip(rows, adj)]
        if n % 50 == 0:
            log(u'  %d/%d（已取得 %d 檔）' % (n, len(codes), len(series)))

    if not series:
        # --only-missing 時這不是錯誤：還沒有曲線的往往是剛上市、
        # 交易日還不到 MIN_POINTS 的新 ETF（實測六檔，13～21 天）。
        log(u'一檔都沒拿到，不寫出任何檔案')
        return 0 if ONLY_MISSING else 1

    fm.write_market(OUTDIR, 'tw', series, 'finmind')
    if limited:
        note(u'被 FinMind 擋下來，還有標的沒有曲線；下一次執行會優先補')
    if fm.ERRORS:
        log(u'有 %d 檔抓取失敗' % len(fm.ERRORS))
    return 0


if __name__ == '__main__':
    sys.exit(main())
