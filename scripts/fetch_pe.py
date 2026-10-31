# -*- coding: utf-8 -*-
u"""低本益比篩選用的一份：全市場每檔的本益比、收盤價與近 3 個月營收。

    python scripts/fetch_pe.py

產出 `app/public/data/stocks/pe.json`（不進版控，部署時產生）。

## 來源：四個官方端點，不動用 FinLab／FinMind 額度

    TWSE  exchangeReport/BWIBBU_ALL            上市每日本益比、殖利率、淨值比
    TWSE  exchangeReport/STOCK_DAY_ALL         上市每日收盤價與成交金額
    TPEx  tpex_mainboard_peratio_analysis      上櫃的本益比、殖利率、淨值比
    TPEx  tpex_mainboard_daily_close_quotes    上櫃的收盤價與成交金額

月營收不另外抓：用 `fin_history.json`（fetch_stocks.py 累積的那份），所以要排在它後面跑。

## 預估本益比在前端算，這裡只給原料

個股頁的「營收推估」是 lib/valuation.ts 的 `revenueEstimate()`：近 3 個月營收合計
÷ 去年同期，套到近四季 EPS。篩選頁要跟個股頁顯示同一個數字，所以兩邊共用那一支函式，
這裡不重寫一份 —— 只把它會用到的月份（近 3 個「可用」月份，判斷規則跟它一樣）放進來。

交易所在近四季 EPS ≤ 0 時本益比是空的，那些公司沒有本益比可篩，不列。
"""
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_stocks import (                                     # noqa: E402
    HISTORY, OUTDIR, TPE, ERRORS, fetch, load_json, log, num, pick, write_json)

TWSE_PE = 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL'
TWSE_DAY = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
TPEX_PE = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis'
TPEX_DAY = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'

# 跟 revenueEstimate() 的 n 一樣
MONTHS = 3
# 少於這麼多檔多半是端點只回了一部分，寧可不寫、讓網站沿用上一版
MIN_ROWS = 500


def roc_date(s):
    u"""'1151030' -> '2026-10-30'。"""
    s = str(s or '').strip()
    if not re.match(r'^\d{7}$', s):
        return None
    return '%d-%s-%s' % (int(s[:3]) + 1911, s[3:5], s[5:])


def usable_months(rows):
    u"""revenueEstimate() 會用到的那幾個月：營收 > 0、年增率有值且 > -100%。"""
    ok = [r for r in rows
          if (r.get('rev') or 0) > 0 and r.get('yoy') is not None and r['yoy'] > -100]
    ok.sort(key=lambda r: r['p'])
    return [[r['p'], r['rev'], r['yoy']] for r in ok[-MONTHS:]]


def market_rows(pe_url, day_url, market):
    u"""一個市場：代號 -> (本益比、淨值比、殖利率、收盤、成交金額)，以及資料日期。"""
    pe_rows = fetch(pe_url, u'%s本益比' % market)
    day_rows = fetch(day_url, u'%s收盤價' % market) or []
    if not pe_rows:
        return {}, None
    days = {}
    for r in day_rows:
        code = str(pick(r, 'Code', 'SecuritiesCompanyCode') or '').strip()
        days[code] = (num(pick(r, 'ClosingPrice', 'Close')),
                      num(pick(r, 'TradeValue', 'TransactionAmount')))
    out, date = {}, None
    for r in pe_rows:
        code = str(pick(r, 'Code', 'SecuritiesCompanyCode') or '').strip()
        date = date or roc_date(r.get('Date'))
        close, value = days.get(code, (None, None))
        out[code] = {
            'pe': num(pick(r, 'PEratio', 'PriceEarningRatio')),
            'pb': num(pick(r, 'PBratio', 'PriceBookRatio')),
            'y': num(pick(r, 'DividendYield', 'YieldRatio')),
            'p': close, 'v': value,
        }
    log(u'  %s %d 檔（%s）' % (market, len(out), date))
    return out, date


def main():
    log(u'低本益比篩選：交易所本益比＋月營收')
    history = load_json(HISTORY, {})
    info, months = history.get('info') or {}, history.get('m') or {}
    if not info:
        log(u'  沒有 fin_history.json 的公司資料，不產生')
        return 1

    twse, twse_date = market_rows(TWSE_PE, TWSE_DAY, u'上市')
    tpex, tpex_date = market_rows(TPEX_PE, TPEX_DAY, u'上櫃')

    rows = []
    for code, q in sorted(list(twse.items()) + list(tpex.items())):
        meta = info.get(code)
        if not meta or not (q['pe'] or 0) > 0 or not (q['p'] or 0) > 0:
            continue                              # 不是公司（ETF、特別股）、虧損、或沒收盤價
        rows.append({
            'c': code, 'n': meta.get('name') or code,
            'm': meta.get('market'), 'i': meta.get('industry') or '',
            'p': q['p'], 'pe': q['pe'], 'pb': q['pb'], 'y': q['y'], 'v': q['v'],
            'r': usable_months(months.get(code) or []),
        })

    if len(rows) < MIN_ROWS:
        log(u'  只有 %d 檔，少於 %d，不寫檔' % (len(rows), MIN_ROWS))
        return 1

    periods = sorted({r[0] for row in rows for r in row['r']})
    write_json(os.path.join(OUTDIR, 'pe.json'), {
        'meta': {
            'date': twse_date or tpex_date, 'dates': {u'上市': twse_date, u'上櫃': tpex_date},
            'months': periods, 'count': len(rows),
            'updated': datetime.now(TPE).date().isoformat(),
            'source': u'證交所 BWIBBU_ALL／STOCK_DAY_ALL、櫃買本益比與收盤行情、公開資訊觀測站月營收',
            'errors': ERRORS,
        },
        'rows': rows,
    })
    log(u'  %d 檔有本益比，月營收 %s' % (len(rows), u'、'.join(periods) or u'—'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
