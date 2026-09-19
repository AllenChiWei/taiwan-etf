# -*- coding: utf-8 -*-
u"""用 FinMind 回補除息紀錄，把 dividends.json 的覆蓋率補起來。

    python scripts/fetch_dividends_finmind.py [--limit 50] [--only-missing]

## 為什麼需要這一支

`fetch_dividends.py` 的兩個來源涵蓋範圍不對稱：證交所（上市）可以一年一次請求回補
歷史，櫃買（上櫃）只公佈**當天**的除權息清單，歷史要靠每天累積。結果是上櫃的債券
ETF 幾乎沒有紀錄 —— 實測 359 檔 ETF 裡只有 116 檔（32%）有配息資料。

沒有配息紀錄就算不出殖利率，只能繼續向 MoneyDJ 要。補起來之後，殖利率可以自己算
（近 12 個月配息 ÷ 收盤價），MoneyDJ 的請求量才真的降得下來。

## 為什麼是 FinMind 而不是別的免費來源

    finmindtrade.com/robots.txt      User-agent: * / Allow: /     ← 可以
    query1.finance.yahoo.com         User-agent: * / Disallow: /  ← yfinance 打的就是這台
    stooq.com                        只開放 Bingbot 與 Googlebot

yfinance 底下打的是 Yahoo 那台被 robots 全面禁止的主機，所以本專案不用它 ——
這與先前排除富邦 PCF、排除奇摩新聞是同一條線。FinMind 本專案本來就在用
（ETF 名單的補漏），是台灣公開資料的整理者，且明確歡迎程式取用。

## 資料怎麼對齊

FinMind 的 `TaiwanStockDividendResult` 是除權息結果表：`stock_and_cache_dividend`
是當次的配息金額，`stock_or_cache_dividend` 標明「息」「權」或「權息」。這裡只收
純現金（息），權值的那幾筆跳過 —— 與 fetch_dividends.py 對股票股利的處理一致。

實測與交易所公告對得上：0056 在 2026-07-21 兩邊都是 1.35。

免費層一次只能查一檔（不帶 data_id 的全市場查詢需要付費層），所以請求數等於檔數，
腳本會自己放慢。這支是**回補用**的，不進每日流程 —— 每天的新資料由交易所那兩個
官方端點提供。
"""
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'dividends.json')

API = 'https://api.finmindtrade.com/api/v4/data'
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) dividend history backfill')
START = '2019-01-01'

# 免費層的節流。實測連打八次沒有被擋，但這支會跑幾百檔，慢一點比較禮貌。
DELAY = 2.0
TIMEOUT = 60

LIMIT = None
ONLY_MISSING = '--only-missing' in sys.argv
for i, a in enumerate(sys.argv[1:]):
    if a.startswith('--limit'):
        LIMIT = int(a.split('=')[1]) if '=' in a else int(sys.argv[i + 2])


def log(m):
    print(m, flush=True)


def fetch(code, tries=3):
    params = {'dataset': 'TaiwanStockDividendResult', 'data_id': code,
              'start_date': START, 'end_date': date.today().isoformat()}
    url = API + '?' + urllib.parse.urlencode(params)
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            raw = urllib.request.urlopen(req, timeout=TIMEOUT).read()
            doc = json.loads(raw.decode('utf-8'))
            if doc.get('msg') != 'success':
                return None, str(doc.get('msg'))[:60]
            return doc.get('data') or [], None
        except Exception as e:                                # noqa: BLE001
            if attempt == tries:
                return None, str(e)[:60]
            time.sleep(DELAY * attempt)
    return None, 'unreachable'


def main():
    doc = json.load(io.open(OUT, encoding='utf-8'))
    dividends = doc.setdefault('dividends', {})
    stock_only = doc.get('stockOnly') or {}

    etfs = json.load(io.open(os.path.join(ROOT, 'app', 'public', 'data', 'etfs.json'),
                             encoding='utf-8'))
    codes = [e['code'] for e in etfs['etfs']]
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        from etfdata import EXTRA_STOCKS
        codes += list(EXTRA_STOCKS)
    except Exception:                                         # noqa: BLE001
        pass

    if ONLY_MISSING:
        codes = [c for c in codes if c not in dividends]
    if LIMIT:
        codes = codes[:LIMIT]

    log(u'要查 %d 檔（%s）' % (len(codes),
                             u'只補沒有紀錄的' if ONLY_MISSING else u'全部'))

    added = skipped_rights = 0
    touched = failed = 0
    for n, code in enumerate(codes, 1):
        rows, err = fetch(code)
        if rows is None:
            failed += 1
            log(u'  %s 失敗：%s' % (code, err))
            time.sleep(DELAY)
            continue
        lst = dividends.setdefault(code, [])
        have = set(r[0] for r in lst)
        new = 0
        for r in rows:
            iso = str(r.get('date') or '').strip()
            amount = r.get('stock_and_cache_dividend')
            kind = str(r.get('stock_or_cache_dividend') or '')
            if not iso or not amount or amount <= 0:
                continue
            # 只收純現金。含「權」的那幾筆金額混著股票股利，拆不出現金部分 ——
            # 與 fetch_dividends.py 對股票股利的處理一致。
            if u'權' in kind:
                skipped_rights += 1
                stock_only.setdefault(code, [])
                if iso not in stock_only[code]:
                    stock_only[code].append(iso)
                continue
            if iso in have:
                continue
            lst.append([iso, round(float(amount), 6), 1])
            have.add(iso)
            new += 1
        if new:
            lst.sort()
            added += new
            touched += 1
        if n % 25 == 0:
            log(u'  %d/%d（新增 %d 筆 / %d 檔）' % (n, len(codes), added, touched))
        time.sleep(DELAY)

    if not dividends:
        log(u'什麼都沒拿到，不覆寫既有檔案')
        return 1

    doc['stockOnly'] = stock_only
    doc['meta'] = dict(doc.get('meta') or {}, **{
        'updated': date.today().isoformat(),
        'codes': len(dividends),
        'records': sum(len(v) for v in dividends.values()),
        'finmindBackfill': date.today().isoformat(),
    })
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))

    log(u'完成：新增 %d 筆、涵蓋 %d 檔（原本 %d 檔），跳過含權值 %d 筆，失敗 %d 檔'
        % (added, len(dividends), len(dividends) - touched, skipped_rights, failed))
    log(u'      %s（%.0f KB）' % (OUT, os.path.getsize(OUT) / 1024.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
