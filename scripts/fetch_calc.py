# -*- coding: utf-8 -*-
u"""Monthly price + dividend series for the investment calculator.

    python scripts/fetch_calc.py [outdir]

Writes into app/public/data/calc/:

    index.json        {"months":["2019-01", …], "codes":{"0050":{…摘要…}, …}}
    tw/0050.json      {"code":"0050","first":0,"p":[…],"d":[…],"q":[…],
                       "last":{"date":"2026-09-16","close":58.20},
                       "splits":[{"date":"2025-06-18","ratio":4.0}]}

每個月三個數字：

    p  該月第一個交易日的收盤價 —— 定期定額「月初扣款」買在這裡
    d  該月除息金額合計（每股）
    q  該月最後一次除息之後第一個交易日的收盤價；沒配息就是 null
       —— 「配息後再買進」與股息再投入都買在這裡

**價格只還原分割，不還原配息。** 這是計算機能誠實處理配息的前提：還原股價
（etl:adj_close）已經把配息當成自動再投入了，拿它回測會算不出「領現金」跟
「再投入」的差別，也做不出「當月配息後才買」這種時點選擇。

## 配息怎麼來的

FinLab 沒有 ETF 的配息資料集（dividend_announcement 只有上市公司的董事會決議，
0050、00878 查出來都是空的）。所以從還原股價與原始收盤價的比值回推：

    ratio[t] = adj_close[t] / close[t]

ratio 只在除息或分割當天跳動，且

    ratio[d-1] / ratio[d] = (P[d-1] - D) / P[d-1]

所以 D = P[d-1] * (1 - ratio[d-1]/ratio[d])。

分割會被同一條式子算成一筆巨額「配息」，必須分開：0050 在 2025-06-18 的
1 拆 4 會算出「配息 = 前收的 75%」。真正的配息從來不會接近這個量級 ——
全市場只有 5 筆事件超過前收的 20%，而且五筆都確認是分割（75%～95.8%），
所以 SPLIT_MIN_PCT = 20 這條線兩邊都留了很寬的餘裕。

## 為什麼相信這個回推

拿 MoneyDJ 的殖利率做獨立對照（216 檔有殖利率的標的，回推近 12 個月配息
除以現價）：絕對誤差中位數 0.02pp，84% 落在 0.5pp 以內。0050、0056、00878、
00919、006208、00679B 都對到小數點後兩位。誤差大的清一色是上市不到一年的
主動式 ETF —— 那是 MoneyDJ 把單次配息年化的結果，不是回推失準。

## 為什麼不進版控

跟 series/ 一樣在部署時產生。但這份**不加密**：月頻的收盤價與配息金額本來就是
交易所與投信公開的資訊，這裡只是把它整理成月度摘要，不是那份按日的付費資料集。
不加密才能讓計算機免密碼使用。
"""
import collections
import io
import json
import os
import sys
import warnings

warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    ROOT, 'app', 'public', 'data', 'calc')

# 與 fetch_series.py 一致，讓兩邊的圖表對得上
START = '2019-01-01'
DECIMALS = 4          # 配息常是 0.1x 元，兩位小數會把差異抹掉
PRICE_DECIMALS = 2

# 單日跌幅超過前收這個比例就當成分割而非配息。實測全市場最大的「配息」是
# 前收的 17%（少數一次配很多的高股息 ETF），最小的分割是 75%，中間空得很開。
SPLIT_MIN_PCT = 20.0

# 事件要算數的最小金額。浮點雜訊會在 ratio 上造成 1e-9 等級的抖動。
MIN_DIV = 0.001


def log(msg):
    print(msg, flush=True)


def write_json(path, obj):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')))


def load_official_dividends():
    u"""交易所公告的除息金額 {代號: {日期: 金額}}；沒有檔案就回空的。

    由 fetch_dividends.py 產生。有官方數字就用官方的 —— 從還原股價回推的
    金額只準到「分」，因為除權息參考價本來就依最小跳動單位取整
    （00406A 公告 0.138，參考價 9.82，回推只能得到 0.14）。
    """
    path = os.path.join(ROOT, 'app', 'public', 'data', 'dividends.json')
    if not os.path.exists(path):
        log(u'  找不到 dividends.json，全部改用回推值')
        return {}
    doc = json.load(io.open(path, encoding='utf-8'))
    out = {}
    for code, rows in (doc.get('dividends') or {}).items():
        out[code] = dict((d, float(a)) for d, a in rows)
    log(u'  官方配息：%d 檔、%d 筆' % (len(out), sum(len(v) for v in out.values())))
    return out


def split_adjust(close, adj, official=None):
    u"""-> (只還原分割的收盤價, 除息事件 Series, 分割事件 list, 用了幾筆官方值)

    回傳的配息金額與價格在同一個尺度上（皆為分割還原後），所以模擬時
    「股數 × 每股配息」直接就對，不必再另外處理分割。

    official 是 {日期字串: 官方金額}。有對應日期就用官方金額取代回推值，
    但要乘上分割係數 g 換到同一個尺度。
    """
    import pandas as pd

    idx = close.index.intersection(adj.index)
    c = close.loc[idx].astype(float)
    a = adj.loc[idx].astype(float)
    ok = c.notna() & a.notna() & (c > 0)
    c, a = c[ok], a[ok]
    if len(c) < 2:
        return None, None, None, 0

    ratio = a / c
    f = ratio.shift(1) / ratio          # 事件當天 < 1，其餘 == 1
    drop_pct = (1.0 - f) * 100.0

    is_event = (f < 0.9999) & (c.shift(1) * (1.0 - f) > MIN_DIV)
    is_split = is_event & (drop_pct > SPLIT_MIN_PCT)
    is_div = is_event & ~is_split

    # 分割還原：某天的價格要乘上「它之後所有分割」的 f 連乘積。
    # 反向累乘再往回移一格 —— 分割當天本身已經是新尺度，不該再乘自己。
    g = f.where(is_split, 1.0)[::-1].cumprod()[::-1].shift(-1).fillna(1.0)
    sclose = c * g

    # 除息日 d 的每股配息（分割還原後）= 前一日的分割還原價 × (1 - f)
    divs = (sclose.shift(1) * (1.0 - f))[is_div]
    divs = divs[divs > MIN_DIV]

    # 官方金額覆蓋回推值。官方數字是原始股數的，要乘 g 換到分割還原後的尺度。
    n_official = 0
    if official:
        for d in list(divs.index):
            key = d.strftime('%Y-%m-%d')
            if key in official:
                divs.loc[d] = official[key] * float(g.loc[d])
                n_official += 1

    splits = [{'date': d.strftime('%Y-%m-%d'), 'ratio': round(1.0 / float(f.loc[d]), 4)}
              for d in f.index[is_split]]
    return sclose, divs, splits, n_official


def monthly(sclose, divs, months):
    u"""把日資料壓成每月三個數字。months 是整個市場共用的月份清單。"""
    pos = {m: i for i, m in enumerate(months)}
    n = len(months)
    p = [None] * n
    d = [0.0] * n
    q = [None] * n

    # p：每個月第一個交易日的收盤價
    keys = sclose.index.strftime('%Y-%m')
    seen = set()
    for key, val in zip(keys, sclose.values):
        if key in pos and key not in seen:
            seen.add(key)
            p[pos[key]] = float(val)

    # d / q：除息金額合計，以及該月最後一次除息「當天」的收盤價。
    # 用除息日當天而非前一日 —— 拿到配息的人最快就是用除息後的價格再買進。
    for dt, amt in divs.items():
        key = dt.strftime('%Y-%m')
        if key not in pos:
            continue
        i = pos[key]
        d[i] += float(amt)
        v = sclose.get(dt)
        if v is not None and v == v:
            q[i] = float(v)

    # 有配息卻沒取到當天價（極少見）就退回月初價，不要留 null 讓前端要處理兩種情況
    for i in range(n):
        if d[i] > 0 and q[i] is None:
            q[i] = p[i]

    return p, d, q


def main():
    import pandas as pd
    from finlab_client import login
    login()
    from finlab import data

    log(u'輸出目錄：%s' % OUTDIR)

    doc = json.load(io.open(os.path.join(ROOT, 'app', 'public', 'data', 'etfs.json'),
                            encoding='utf-8'))
    rows = doc['etfs']

    log(u'載入交易所公告的配息…')
    official = load_official_dividends()

    log(u'讀取收盤價與還原收盤價…')
    close = data.get(u'price:收盤價').loc[START:]
    adj = data.get('etl:adj_close').loc[START:]

    months = sorted({d.strftime('%Y-%m') for d in close.index})
    log(u'月份範圍 %s ~ %s（%d 個月）' % (months[0], months[-1], len(months)))

    index = {'months': months, 'codes': {}}
    written = skipped = 0
    total_bytes = 0
    src_count = collections.Counter()

    for r in rows:
        code = r['code']
        if code not in close.columns:
            skipped += 1
            continue
        sclose, divs, splits, n_official = split_adjust(
            close[code].dropna(), adj[code].dropna(), official.get(code))
        if sclose is None or len(sclose) < 60:      # 不到三個月，回測沒有意義
            skipped += 1
            continue

        p, d, q = monthly(sclose, divs, months)
        have = [i for i, v in enumerate(p) if v is not None]
        if not have:
            skipped += 1
            continue
        first, last_i = have[0], have[-1]

        payload = {
            'code': code,
            'name': r['name'],
            'freq': r.get('freq', u'—'),
            'first': first,
            'p': [None if v is None else round(v, PRICE_DECIMALS)
                  for v in p[first:last_i + 1]],
            'd': [round(v, DECIMALS) for v in d[first:last_i + 1]],
            'q': [None if v is None else round(v, PRICE_DECIMALS)
                  for v in q[first:last_i + 1]],
            'last': {'date': sclose.index[-1].strftime('%Y-%m-%d'),
                     'close': round(float(sclose.iloc[-1]), PRICE_DECIMALS)},
            'splits': splits,
            # 配息金額的來源：official 全部來自交易所公告、derived 全部是回推的、
            # mixed 兩者都有（櫃買沒有歷史資料，所以債券 ETF 多半是 derived）
            'divSource': ('official' if n_official and n_official == len(divs)
                          else 'derived' if not n_official else 'mixed'),
        }
        src_count[payload['divSource']] += 1
        path = os.path.join(OUTDIR, 'tw', '%s.json' % code)
        write_json(path, payload)
        total_bytes += os.path.getsize(path)
        written += 1

        # 索引只放前端「選標的」時要用的摘要，不必先下載整份序列
        cut = sclose.index[-1] - pd.Timedelta(days=365)
        ttm = float(divs[divs.index > cut].sum()) if len(divs) else 0.0
        px = float(sclose.iloc[-1])
        index['codes'][code] = {
            'first': months[first],
            'ttmYield': round(ttm / px * 100.0, 2) if px else None,
            'payouts': int((divs.index > cut).sum()) if len(divs) else 0,
        }

    write_json(os.path.join(OUTDIR, 'index.json'), index)
    log(u'  台股 %d 檔（略過 %d 檔資料過短或無報價），共 %.1f MB，平均每檔 %.1f KB'
        % (written, skipped, total_bytes / 1e6, total_bytes / max(1, written) / 1024))
    log(u'  配息來源：官方 %d 檔、混合 %d 檔、回推 %d 檔'
        % (src_count.get('official', 0), src_count.get('mixed', 0),
           src_count.get('derived', 0)))

    check_against_moneydj(rows, index)
    log(u'完成')


# 回推配息的把關。誤差容許值訂在「實測中位數 0.02pp」的兩個數量級之上：
# 正常狀況離這條線非常遠，真的撞到就代表資料的語意變了，不是抖動。
MAX_MEDIAN_ERROR_PP = 1.0


def check_against_moneydj(rows, index):
    u"""用 MoneyDJ 的殖利率驗證回推出來的配息。

    這是整份資料唯一有獨立對照的地方。回推的前提是 etl:adj_close 只為了配息與
    分割做還原 —— 哪天 FinLab 改了語意（例如改成不還原、或連手續費都算進去），
    回推出來的配息會整批偏掉，而畫面上不會有任何異狀：曲線照樣漂亮，只是數字是錯的。
    所以在這裡擋下來，讓部署失敗，而不是讓使用者拿錯的數字做決定。

    比的是「近 12 個月配息合計 ÷ 現價」對上 MoneyDJ 的殖利率。上市不到一年的
    標的要排除：MoneyDJ 會把單次配息年化，我們算的是實際發生額，兩者本來就不同。
    """
    import pandas as pd

    diffs = []
    for r in rows:
        info = index['codes'].get(r['code'])
        if not info or info['ttmYield'] is None:
            continue
        try:
            theirs = float(r.get('yield'))
        except (TypeError, ValueError):
            continue
        # 近一年配息次數為 0 的（還沒配過）沒得比；上市未滿一年的也跳過
        if info['payouts'] == 0:
            continue
        months_listed = len(index['months']) - index['months'].index(info['first'])
        if months_listed < 13:
            continue
        diffs.append(abs(info['ttmYield'] - theirs))

    if len(diffs) < 50:
        log(u'  配息對照：可比對的標的只有 %d 檔，樣本太少，略過把關' % len(diffs))
        return

    diffs.sort()
    median = diffs[len(diffs) // 2]
    within = sum(1 for d in diffs if d < 0.5) * 100.0 / len(diffs)
    log(u'  配息對照 MoneyDJ 殖利率：%d 檔，絕對誤差中位數 %.3fpp，%.0f%% 在 0.5pp 內'
        % (len(diffs), median, within))

    if median > MAX_MEDIAN_ERROR_PP:
        sys.exit(
            u'配息回推與 MoneyDJ 的殖利率對不上（中位數誤差 %.2fpp > %.2fpp）。\n'
            u'多半是 etl:adj_close 的還原方式變了，回推出來的配息不能用。\n'
            u'先用 price:收盤價 與 etl:adj_close 的比值檢查幾檔已知的標的再繼續。'
            % (median, MAX_MEDIAN_ERROR_PP))


main()
