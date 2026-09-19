# -*- coding: utf-8 -*-
u"""Generate per-ETF price series for the comparison chart.

    python scripts/fetch_series.py [outdir]

Writes, by default, into app/public/data/series/:

    _us.json          {"market":"us","dates":["2019-01-02", …]}   交易日曆
    us/SPY.json       {"code":"SPY","first":12,"values":[…]}

**台股那一半已經搬到 `fetch_series_tw.py`**（改用 FinMind，公開資料、不必加密）。
這支現在只產生美股 —— 三千七百檔逐檔請求不可行，所以那一半仍然是 FinLab。

Why a shared calendar: storing "2019-01-02" next to every number costs more than the number
itself. All ETFs in one market trade on the same days, so the dates live in one file and each
ETF is just an array. `first` is the index of that fund's first trading day, so a fund listed
in 2023 does not carry four years of leading nulls.

**These files are not committed.** They total ~10 MB and every one of them changes whenever
prices move, which would add hundreds of MB to the repository over a year. The deploy
workflow regenerates them into the build output instead — see .gitignore and deploy.yml.
"""
import io
import json
import os
import sys
import warnings

warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    ROOT, 'app', 'public', 'data', 'series')

# 起點。2019 讓多數標的有六年以上的歷史，又不會為了少數老基金把檔案撐大。
START = '2019-01-01'
# 小數位數。ETF 價格個位數到數百美元都有，兩位小數足夠畫圖，也讓檔案小一半。
DECIMALS = 2


def log(msg):
    print(msg, flush=True)


def write_json(path, obj):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')))


def dump_market(df, codes, market, outdir):
    u"""df: 日期 x 代號 的還原收盤價。只輸出 codes 裡有資料的標的。"""
    sub = df[[c for c in codes if c in df.columns]].loc[START:]
    sub = sub.dropna(how='all')
    dates = [d.strftime('%Y-%m-%d') for d in sub.index]

    write_json(os.path.join(outdir, '_%s.json' % market),
               {'market': market, 'dates': dates})

    written = skipped = 0
    total_bytes = 0
    for code in sub.columns:
        s = sub[code]
        valid = s.notna()
        if valid.sum() < 30:                 # 資料太短畫不出有意義的曲線
            skipped += 1
            continue
        first = int(valid.values.argmax())   # 第一個有值的位置
        tail = s.iloc[first:]
        values = [None if v != v else round(float(v), DECIMALS) for v in tail]
        payload = {'code': code, 'first': first, 'values': values}
        path = os.path.join(outdir, market, '%s.json' % code)
        write_json(path, payload)
        total_bytes += os.path.getsize(path)
        written += 1

    log('  %s：%d 檔（略過 %d 檔資料過短），%d 個交易日，共 %.1f MB，平均每檔 %.1f KB'
        % (market.upper(), written, skipped, len(dates),
           total_bytes / 1e6, total_bytes / max(1, written) / 1024))
    return written


def existing_tw_count(outdir):
    u"""台股曲線是另一支腳本產的；這裡只是把檔數讀回來填 index.json。"""
    d = os.path.join(outdir, 'tw')
    if not os.path.isdir(d):
        return 0
    return len([f for f in os.listdir(d) if f.endswith('.json')])


def read_codes(path, key='etfs', only_liquid=False):
    doc = json.load(io.open(path, encoding='utf-8'))
    rows = doc[key]
    if only_liquid:
        rows = [r for r in rows if r.get('liquid')]
    return [r['code'] for r in rows]


def main():
    from finlab_client import login
    login()
    from finlab import data

    log('輸出目錄：%s' % OUTDIR)

    us_codes = read_codes(os.path.join(ROOT, 'app', 'public', 'data', 'us_etfs.json'),
                          only_liquid=True)
    log('美股（有流動性）%d 檔' % len(us_codes))

    # 台股曲線已經改由 scripts/fetch_series_tw.py 用 FinMind 產生：那是公開資料，
    # 不必加密，收藏頁不輸密碼也看得到。這裡只剩美股 —— 三千七百檔逐檔請求不可行，
    # 所以那一半還是 FinLab，也還是要加密。
    n_tw = existing_tw_count(OUTDIR)

    log('讀取美股還原收盤價…')
    us = data.get('us_fund_price:adj_close')
    n_us = dump_market(us, us_codes, 'us', OUTDIR)

    # 給前端一份索引，才知道哪些代號有曲線可看
    write_json(os.path.join(OUTDIR, 'index.json'), {
        'start': START,
        'markets': {'tw': n_tw, 'us': n_us},
    })
    log('')
    log('完成：台股 %d 檔、美股 %d 檔' % (n_tw, n_us))


if __name__ == '__main__':
    main()
