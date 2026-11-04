# -*- coding: utf-8 -*-
u"""可轉債：行情、轉換價、溢價率、待發行 → app/public/data/cb.json（不進版控，部署時產生）。

    python scripts/fetch_cb.py [輸出路徑]

## 來源：櫃買中心三份，加兩家交易所的股票收盤價，全是官方免費端點

    櫃買  storage/bond_zone/tradeinfo/cb/…/RSta0113.<日>-C.csv   轉(交)換公司債買賣斷交易行情表（收市、成交、明日參價）
    櫃買  storage/bond_zone/tradeinfo/cb/…/RSdrs001.<日>-C.csv   轉換公司債資訊看板（轉換價、賣回、贖回、發行餘額）
    櫃買  openapi/v1/bond_ISSBD5_data                             轉(交)換債發行資料（到期日、擔保、待發行）
    證交所 exchangeReport/STOCK_DAY_ALL、櫃買 tpex_mainboard_daily_close_quotes   標的股票收盤價

兩份 CSV 是櫃買「轉(交)換債日統計報表」頁的下載檔（那頁呼叫 /www/zh-tw/bond/cbDaily 列出檔名，
路徑規則固定，所以直接組網址）。檔案是 **cp950**。行情表每檔兩列（等價、議價），只取等價。

## 幾個口徑，畫面上都要講清楚

- **價格**：當天有成交用收市價，沒成交用櫃買的「明日參價」（參考價）。XQ 那類看板用委買價，
  官方免費資料沒有委買，所以不是同一個數字 —— 冷門的債參考價可能好幾天沒動。
- **轉換價值** ＝ 100 × 標的股價 ÷ 轉換價；**溢價率** ＝ 可轉債價格 ÷ 轉換價值 − 1。
- **看板的轉換價是「下次生效日之後」的轉換價**（櫃買註 2），生效日還沒到的那幾檔，
  今天實際適用的可能還是舊的。生效日一起存，畫面標出來。
- 看板比行情晚一天公布（傍晚看是前一交易日），轉換價很少天天變，用最近一份。
- 交換債（標的不是發行公司自己）：代號前四碼不是標的，股價改用看板的「轉換標的股票價格」。
  判斷方式是兩個股價差太多（> 15%）。

待發行：發行資料裡發行日或上櫃日在行情日之後、公開募集（OfferingMethod=7）的那幾檔。
私募（=8）不能在櫃買交易，不列。
"""
import csv
import io
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_stocks import (                                     # noqa: E402
    DATA, HISTORY, TPE, ERRORS, fetch, load_json, log, note, num, pick, write_json)

UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) convertible bonds')
STORAGE = 'https://www.tpex.org.tw/storage/bond_zone/tradeinfo/cb/%s/%s/%s.%s-C.csv'
ISSUE = 'https://www.tpex.org.tw/openapi/v1/bond_ISSBD5_data'
TWSE_DAY = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
TPEX_DAY = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'
OUT = os.path.join(DATA, 'cb.json')
# 少於這麼多檔多半是檔案只下載了一部分，寧可不寫、讓網站沿用上一版（平常約 380 檔）
MIN_ROWS = 200
# 往回找幾天（連假最長約 9 天）
LOOKBACK = 12


def get_csv(kind, day):
    u"""一份櫃買 CSV；不存在（假日、還沒公布）回 None。"""
    url = STORAGE % (day[:4], day[:6], kind, day)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        raw = urllib.request.urlopen(req, timeout=60).read()
    except Exception:                                         # noqa: BLE001
        return None
    finally:
        time.sleep(1.0)
    text = raw.decode('cp950', 'replace')
    if 'HEADER' not in text:                                  # 沒有那天的檔案時回的是一頁 HTML
        return None
    head, body = None, []
    for row in csv.reader(io.StringIO(text)):
        if not row:
            continue
        if row[0] == 'HEADER':
            head = [c.strip() for c in row[1:]]
        elif row[0] == 'BODY' and head:
            body.append(dict(zip(head, [c.strip() for c in row[1:]])))
    return body or None


def latest_csv(kind, start):
    u"""從 start 往回找最近一份。回 (日期 YYYY-MM-DD, 列)。"""
    d = start
    for _ in range(LOOKBACK):
        key = d.strftime('%Y%m%d')
        rows = get_csv(kind, key)
        if rows:
            return d.strftime('%Y-%m-%d'), rows
        d -= timedelta(days=1)
    return None, []


def ymd(s):
    u"""'2029/12/10'、'20291210' -> '2029-12-10'；空白回 None。"""
    s = (s or '').replace('/', '').strip()
    return '%s-%s-%s' % (s[:4], s[4:6], s[6:8]) if len(s) == 8 and s.isdigit() else None


def stock_closes():
    u"""上市＋上櫃的最新收盤價。"""
    out = {}
    for url, label in ((TWSE_DAY, u'上市收盤價'), (TPEX_DAY, u'上櫃收盤價')):
        for r in fetch(url, label) or []:
            code = str(pick(r, 'Code', 'SecuritiesCompanyCode') or '').strip()
            p = num(pick(r, 'ClosingPrice', 'Close'))
            if code and p:
                out[code] = p
    return out


def r2(v, n=2):
    return None if v is None else round(v, n)


def build(today):
    quote_day, quotes = latest_csv('RSta0113', today)
    if not quotes:
        note(u'找不到最近 %d 天的可轉債行情表' % LOOKBACK)
        return None
    board_day, board = latest_csv('RSdrs001', datetime.strptime(quote_day, '%Y-%m-%d'))
    if not board:
        note(u'找不到可轉債資訊看板')
        return None
    log(u'  行情 %s %d 列、看板 %s %d 列' % (quote_day, len(quotes), board_day, len(board)))

    info = (load_json(HISTORY, {}) or {}).get('info') or {}
    issues = {}
    upcoming = []
    for r in fetch(ISSUE, u'轉(交)換債發行資料') or []:
        if r.get('OfferingMethod') != '7':                    # 私募不在櫃買交易
            continue
        code = (r.get('BondCode') or '').strip()
        item = {
            'c': code, 'n': (r.get('ShortName') or '').strip(), 'issuer': (r.get('IssuerName') or '').strip(),
            's': (r.get('IssuerCode') or '').strip().lstrip('0')[:6],
            'issue': ymd(r.get('IssueDate')), 'list': ymd(r.get('ListingDate')),
            'mat': ymd(r.get('MaturityDate')),
            'amt': num(r.get('IssueAmount')),
            'cp': num(r.get('Conversion/ExchangePriceAtIssuance')),
            'g': {'1': u'有擔保', '2': u'無擔保'}.get(r.get('Guaranteed'), u'其他'),
            'y': num(r.get('TenorYear')),
        }
        item['ind'] = (info.get(item['s']) or {}).get('industry') or u'其他'
        if code:
            issues[code] = item
        if max(item['issue'] or '', item['list'] or '') > quote_day:
            upcoming.append(item)
    upcoming.sort(key=lambda x: x['list'] or x['issue'] or '')

    closes = stock_closes()

    bq = {}
    for r in quotes:
        code = r.get(u'代號')
        if code and r.get(u'交易') == u'等價':
            bq[code] = r

    rows = []
    for b in board:
        code = b.get(u'債券代碼')
        if not code:
            continue
        q = bq.get(code, {})
        close = num(q.get(u'收市'))
        ref = num(q.get(u'明日參價')) or num(b.get(u'轉債參考價格'))
        px = close or ref
        cp = num(b.get(u'轉換價格'))
        stock = code[:4]
        bs = num(b.get(u'轉換標的股票價格'))
        sp = closes.get(stock)
        exch = False
        if bs and (not sp or abs(sp / bs - 1) > 0.15):        # 交換債，或今天抓不到收盤
            exch = bool(sp)
            sp = bs
        cv = 100 * sp / cp if sp and cp else None
        prem = (px / cv - 1) * 100 if px and cv else None
        iss = issues.get(code, {})
        meta = info.get(stock) or {}
        out_amt = num(b.get(u'上月底發行餘額'))
        tot = num(b.get(u'原始發行總額'))
        rows.append({
            'c': code, 'n': b.get(u'債券簡稱') or q.get(u'名稱') or code,
            's': stock, 'sn': meta.get('name') or '', 'ind': meta.get('industry') or u'其他',
            'mk': meta.get('market') or '',
            'px': r2(px), 'close': r2(close), 'chg': num(q.get(u'漲跌')),
            'vol': num(q.get(u'單位')), 'val': num(q.get(u'金額')),
            'cp': cp, 'cpEff': ymd(b.get(u'下次轉換價格生效日期')),
            'sp': sp, 'exch': exch, 'cv': r2(cv), 'prem': r2(prem),
            'convS': ymd(b.get(u'轉換起日')), 'convE': ymd(b.get(u'轉換迄日')),
            'putS': ymd(b.get(u'最近賣回權起日')), 'putE': ymd(b.get(u'最近賣回權迄日')),
            'putP': num(b.get(u'最近賣回權價格')) or None,
            'callS': ymd(b.get(u'強制贖回起日')), 'callP': num(b.get(u'強制贖回價格')) or None,
            'end': ymd(b.get(u'終止櫃檯買賣日')),
            'halt': ymd(b.get(u'停止交易起日')),
            'tot': tot, 'out': out_amt,
            'coupon': num(b.get(u'票面利率')),
            'issue': iss.get('issue'), 'mat': iss.get('mat'), 'g': iss.get('g'),
        })
    return {
        'meta': {
            'date': quote_day, 'board': board_day,
            'updated': datetime.now(TPE).strftime('%Y-%m-%d %H:%M'),
            'count': len(rows), 'traded': sum(1 for r in rows if r['close']),
            'source': u'櫃買中心 轉(交)換公司債買賣斷交易行情表、轉換公司債資訊看板、轉(交)換債發行資料；'
                      u'證交所／櫃買股票收盤價',
            'errors': ERRORS,
        },
        'bonds': rows,
        'upcoming': upcoming,
    }


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else OUT
    log(u'可轉債：櫃買行情＋資訊看板＋發行資料')
    d = build(datetime.now(TPE).replace(tzinfo=None))
    if not d or len(d['bonds']) < MIN_ROWS:
        log(u'  只有 %d 檔，少於 %d，不寫檔' % (len(d['bonds']) if d else 0, MIN_ROWS))
        return 1
    write_json(out, d)
    m = d['meta']
    log(u'  %d 檔（今天有成交 %d）、待發行 %d → %s' % (m['count'], m['traded'], len(d['upcoming']), out))
    return 0


if __name__ == '__main__':
    sys.exit(main())
