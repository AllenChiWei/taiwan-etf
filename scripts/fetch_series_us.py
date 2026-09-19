# -*- coding: utf-8 -*-
u"""美股 ETF 的績效曲線，用 FinMind 產生（不動用 FinLab，也不需要加密）。

    python scripts/fetch_series_us.py [outdir] [--limit N] [--only-missing]

    _us.json      {"market":"us","dates":["2019-01-02", …]}
    us/SPY.json   {"code":"SPY","first":0,"values":[…]}

額度、輪替、日曆合併在 `finmind_series.py`，跟台股共用同一套機制與同一個額度池。

## 為什麼換掉 FinLab：兩個問題一起解決

**密碼。** FinLab 的 `us_fund_price` 是付費訂閱資料，整份要加密才能上線，而加密要
`SITE_PASSWORD` secret；沒設定時部署會把曲線丟掉，收藏頁就一片空白。台股先換走了，
美股跟著換之後，整個網站不再有任何需要密碼的資料。

**配息。** 更重要的是數字本身。FinLab 的 `us_fund_price:adj_close` 只還原分割、
不還原配息，所以高配息標的的曲線是錯的方向 —— FinMind 的 `USStockPrice` 直接給
含息還原的 `Adj_Close`。2019-01 至 2026-09 實測：

        含息      純價格    差
    SPY  240.3%   204.5%    36 個百分點
    QYLD 117.2%   -13.0%   130 個百分點   ← 十年配息被當成不存在
    SCHD 179.7%   115.1%    65 個百分點
    VOO  242.8%   205.1%    38 個百分點

所以這不只是換來源，是把一條長期在誤導人的曲線修正成含息總報酬，與台股那半一致。

## 只畫有流動性的那些

`us_etfs.json` 有三千七百檔，逐檔請求撐不住（FinMind 免費層每小時 300 次、
註冊 600 次）。`liquid` 那 712 檔才產生曲線 —— 這跟原本 fetch_series.py 的做法一致，
沒有流動性的標的畫出來也只是一條階梯。抽樣 10 檔（含 FBL、JNUG、NVDY、JMUB 這種
冷門的）FinMind 都有資料。

**報酬率表格仍然來自 FinLab**（`fetch_us_etfs.py`）：那是三千七百檔的排行，
逐檔請求不可行。所以表格是價格報酬、曲線是含息報酬，UI 上兩邊都有標。

## 資料來源的注意事項

FinMind 沒有在文件上載明美股資料的上游是誰（台股那半是交易所公開資料，很清楚）。
我們用的是他們公開的 API、robots.txt 是 `Allow: /`、這個資料集列在免費層 ——
就我們自己這一端而言沒有繞過任何規則。但「上游是誰」這件事文件沒寫，就別當成寫了。
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

log = fm.log
note = fm.note


def fetch_adjusted(code):
    u"""回傳 [(日期, 還原收盤價)]，由舊到新；失敗回 None。

    Adj_Close 已經含息還原，所以這裡不必像台股那樣自己接 —— 也因此不需要
    配息紀錄，不需要分割偵測。
    """
    data = fm.api_rows('USStockPrice', code, date.today().isoformat())
    if data is None:
        return None
    rows = []
    for r in data:
        v = r.get('Adj_Close')
        d = str(r.get('date') or '')
        if d and v and float(v) > 0:
            rows.append((d, float(v)))
    rows.sort()
    return rows


def main():
    log(u'美股曲線：FinMind 含息還原收盤價（不使用 FinLab）')
    log(fm.quota_line())

    doc = json.load(io.open(os.path.join(DATA, 'us_etfs.json'), encoding='utf-8'))
    # 只畫有流動性的：三千七百檔逐檔請求撐不住，而且沒量的畫出來是階梯。
    # **按成交金額由大到小**：一輪抓不完時，先有曲線的會是 SPY、QQQ 這些真的
    # 會被拿來比較的（order_by_staleness 對同樣新舊的維持這個順序）。
    liquid = [r for r in doc['etfs'] if r.get('liquid')]
    liquid.sort(key=lambda r: -(r.get('adv') or 0))
    all_codes = [r['code'] for r in liquid]
    log(u'清單 %d 檔，其中有流動性的 %d 檔' % (len(doc['etfs']), len(all_codes)))

    coverage = fm.existing_coverage(OUTDIR, 'us')
    codes = fm.select_codes(all_codes, coverage, LIMIT, ONLY_MISSING)
    if codes is None:
        return 0

    log(u'%d 檔，開始抓還原收盤價…' % len(codes))
    series = {}
    limited = False
    for n, code in enumerate(codes, 1):
        try:
            rows = fetch_adjusted(code)
        except fm.RateLimited as e:
            note(u'FinMind 額度用完（%s），這次抓到 %d 檔就停；下一次會從沒抓到的開始'
                 % (e, len(series)))
            limited = True
            break
        time.sleep(fm.DELAY)
        if not rows or len(rows) < fm.MIN_POINTS:
            continue
        series[code] = rows
        if n % 50 == 0:
            log(u'  %d/%d（已取得 %d 檔）' % (n, len(codes), len(series)))

    if not series:
        log(u'一檔都沒拿到，不寫出任何檔案')
        return 0 if ONLY_MISSING else 1

    fm.write_market(OUTDIR, 'us', series, 'finmind')
    if limited:
        note(u'被 FinMind 擋下來，還有標的沒有曲線；下一次執行會優先補')
    if fm.ERRORS:
        log(u'有 %d 檔抓取失敗' % len(fm.ERRORS))
    return 0


if __name__ == '__main__':
    sys.exit(main())
