# -*- coding: utf-8 -*-
u"""台股行事曆：除權息預告與股東會日期。

    python scripts/fetch_calendar.py [outfile]

預設寫到 app/public/data/calendar.json（部署時產生，不進版控）。

## 來源（全部是交易所官方的公開端點）

    除權息預告   證交所 rwd/zh/exRight/TWT48U（上市，含 ETF）
                 櫃買 openapi tpex_exright_prepost（上櫃，含 ETF）
    股東會       證交所 openapi t187ap41_L、櫃買 openapi t187ap41_O
                 （召開股東常（臨時）會日期、地點及採用電子投票情形）

財報與月營收的**法定期限**、期貨結算日不需要抓，前端依規則算（`lib/calendar.ts`）。

## 刻意沒有的：法說會

官方的「法人說明會一覽表」只在舊版公開資訊觀測站（mopsov.twse.com.tw），它的
robots.txt 是 `User-Agent: * / Disallow: /`（只開放 bingbot）；新版觀測站的同一頁也是
轉呼叫舊站的 ajax_t100sb02_1。本專案不繞過 robots、不換 host，所以法說會不做。
2026-09-27 查過。

## 日期

兩個交易所都給民國年：證交所「115年10月08日」、櫃買與 openapi「1151008」。
全部轉成 ISO 8601。只留今天（含）以後 `HORIZON_DAYS` 天內的事件。
"""
import io
import json
import os
import re
import sys
import time
import urllib.request
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'calendar.json')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
if args:
    OUT = args[0]

UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) market calendar')
DELAY = 1.5
TIMEOUT = 40
HORIZON_DAYS = 120

TWSE_EXDIV = 'https://www.twse.com.tw/rwd/zh/exRight/TWT48U?response=json'
TPEX_EXDIV = 'https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost'
TWSE_MEETING = 'https://openapi.twse.com.tw/v1/opendata/t187ap41_L'
TPEX_MEETING = 'https://www.tpex.org.tw/openapi/v1/t187ap41_O'


def log(m):
    print(m, flush=True)


def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    last = None
    for attempt in range(3):
        try:
            raw = urllib.request.urlopen(req, timeout=TIMEOUT).read()
            time.sleep(DELAY)
            return json.loads(raw.decode('utf-8'))
        except Exception as e:                                # noqa: BLE001
            last = e
            time.sleep(5 * (attempt + 1))
    raise last


def roc_date(s):
    u"""「115年10月08日」或「1151008」-> '2026-10-08'；看不懂回 None。"""
    s = (s or '').strip()
    m = re.match(r'^(\d{2,3})年(\d{1,2})月(\d{1,2})日$', s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    elif re.match(r'^\d{7}$', s):
        y, mo, d = int(s[:3]), int(s[3:5]), int(s[5:7])
    else:
        return None
    try:
        return date(y + 1911, mo, d).isoformat()
    except ValueError:
        return None


def num(s):
    try:
        return float(str(s).replace(',', '').strip())
    except ValueError:
        return None


def cash_of(raw):
    u"""現金股利欄位。證交所 ETF 還沒公告金額時會寫一段 HTML「待公告實際收益分配金額」。"""
    v = num(re.sub(r'<[^>]+>', '', str(raw)))
    return v if v and v > 0 else None


def twse_exdiv():
    doc = fetch_json(TWSE_EXDIV)
    if doc.get('stat') != 'OK':
        raise ValueError(u'TWT48U 回應 %s' % doc.get('stat'))
    f = doc['fields']
    i_date, i_code, i_name, i_kind = (f.index(u'除權除息日期'), f.index(u'股票代號'),
                                      f.index(u'名稱'), f.index(u'除權息'))
    i_cash, i_stock = f.index(u'現金股利'), f.index(u'無償配股率')
    out = []
    for r in doc.get('data', []):
        day = roc_date(r[i_date])
        if not day:
            continue
        out.append({'d': day, 'code': r[i_code].strip(), 'name': r[i_name].strip(),
                    'k': r[i_kind].strip(), 'cash': cash_of(r[i_cash]),
                    'stock': (num(r[i_stock]) or None), 'm': 'twse'})
    return out


def tpex_exdiv():
    out = []
    for r in fetch_json(TPEX_EXDIV):
        day = roc_date(r.get('ExRrightsExDividendDate'))
        if not day:
            continue
        kind = (r.get('ExRrightsExDividend') or '').replace(u'除', '')   # 除息 -> 息
        out.append({'d': day, 'code': (r.get('SecuritiesCompanyCode') or '').strip(),
                    'name': (r.get('CompanyName') or '').strip(), 'k': kind,
                    'cash': cash_of(r.get('CashDividend')),
                    'stock': (num(r.get('StockDividendRatio')) or None), 'm': 'tpex'})
    return out


def meetings(url, market):
    out = []
    for r in fetch_json(url):
        day = roc_date(r.get(u'開會日期'))
        if not day:
            continue
        out.append({'d': day, 'code': (r.get(u'公司代號') or '').strip(),
                    'name': (r.get(u'公司名稱') or '').strip(),
                    'k': (r.get(u'股東常(臨時)會') or '').strip(),
                    'elect': (r.get(u'是否改選董監') or '').strip() == u'是',
                    'place': (r.get(u'開會地點') or '').strip()[:60], 'm': market})
    return out


# ── ETF 收益分配：投信的公告（比交易所的預告表早有金額）與發放日 ──────────────
#
# 交易所的除權除息預告表對 ETF 常寫「待公告實際收益分配金額」，要等投信公布實際金額
# 之後才填。投信依規定在收益評價後就會發一則「收益分配評價結果」公告（多半附上
# 預估配發金額），之後再發「實際配發金額」。這兩種公告都轉載在證交所 e添富的
# 「ETF 相關公告」（announcementList?type=distribution），所有投信都有，格式固定：
#
#     2.每受益權單位配發金額:新臺幣0.815元      ← 實際（確定）金額
#     …預估配發金額為新臺幣0.138元               ← 評價結果公告裡的預估值
#     6.除息交易日:115/10/05   7.收益分配發放日:115/11/02
#
# 一頁最多 10 則、一個月約 70 則，只能從最新往回翻；內文一則一個請求，所以解析過的
# 存在 .cache/etf_notices.json（部署流程用 actions/cache 保留），每次只抓新的。
# 發放日另外從 e添富 dividendList 一次取得，已除息、還沒發錢的也有。
# www.twse.com.tw 的 robots.txt 只擋 /epaper/ 與 /FTSE/。

NOTICE_LIST = ('https://www.twse.com.tw/zh/ETFortune/announcementList'
               '?max=10&offset=%d&type=distribution')
NOTICE_BASE = 'https://www.twse.com.tw'
DIVIDEND_LIST = 'https://www.twse.com.tw/zh/ETFortune/dividendList'
NOTICE_CACHE = os.path.join(ROOT, '.cache', 'etf_notices.json')
NOTICE_DAYS = 45            # 往回翻多久的公告；評價日到除息日通常兩三週
NOTICE_MAX_NEW = 90         # 一次最多抓幾則內文（快取是空的那一次）
PAY_BACK_DAYS = 75          # 發放日往回留多久：除息後一個月左右才發錢


def fetch_html(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    last = None
    for attempt in range(3):
        try:
            raw = urllib.request.urlopen(req, timeout=TIMEOUT).read()
            time.sleep(2)                     # 證交所擋太快的請求（回 307），放慢一點
            return raw.decode('utf-8', 'replace')
        except Exception as e:                                # noqa: BLE001
            last = e
            time.sleep(5 * (attempt + 1))
    raise last


def plain(s):
    import html as _html
    return re.sub(r'\s+', ' ', _html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()


ROC_SLASH = r'(\d{2,3})\s*/\s*(\d{1,2})\s*/\s*(\d{1,2})'


def roc_slash(m):
    try:
        return date(int(m.group(1)) + 1911, int(m.group(2)), int(m.group(3))).isoformat()
    except ValueError:
        return None


def parse_notice(title, body):
    u"""公告內文 -> {ex, pay, cash, ck}。ck：'final' 實際金額、'est' 預估、'none' 不分配。"""
    ex = re.search(u'除息交易日\\s*[:：]\\s*' + ROC_SLASH, body)
    pay = re.search(u'收益分配發放日\\s*[:：]\\s*' + ROC_SLASH, body)
    out = {'ex': roc_slash(ex) if ex else None, 'pay': roc_slash(pay) if pay else None,
           'cash': None, 'ck': None}
    final = re.search(u'每受益權單位配發金額\\s*[:：]\\s*(?:新臺幣)?\\s*([\\d.]+)', body)
    est = re.search(u'(?:預估|預計)配發金額(?:每受益權單位)?(?:為)?\\s*新臺幣\\s*([\\d.]+)', body)
    if final:
        out['cash'], out['ck'] = float(final.group(1)), 'final'
    elif est:
        out['cash'], out['ck'] = float(est.group(1)), 'est'
    elif re.search(u'不予分配|不分配', title + body[:200]):
        out['cash'], out['ck'] = 0.0, 'none'
    return out


def etf_notices(today):
    u"""近 NOTICE_DAYS 天的收益分配公告，同一檔同一個除息日取最好的一則（實際 > 預估，新 > 舊）。"""
    try:
        cache = json.load(io.open(NOTICE_CACHE, encoding='utf-8'))
    except Exception:                                         # noqa: BLE001
        cache = {}
    cutoff = (date.fromisoformat(today) - timedelta(days=NOTICE_DAYS)).isoformat()
    items = []
    for page in range(40):
        html_ = fetch_html(NOTICE_LIST % (page * 10))
        rows = re.findall(u'發言日期</div><div class="content">([0-9.]+)</div></td>\\s*'
                          u'<td><div class="title">消息標題</div><a href="([^"]+)"[^>]*>(.*?)</a>',
                          html_, re.S)
        if not rows:
            break
        for d, href, title in rows:
            import html as _html
            href = _html.unescape(href)
            fund = re.search(r'fund=([0-9A-Z]+)', href)
            items.append({'nd': d.replace('.', '-'), 'u': href, 'f': fund.group(1) if fund else '',
                          't': plain(title)})
        if items[-1]['nd'] < cutoff:
            break
    items = [x for x in items if x['nd'] >= cutoff and x['f']]

    fetched = 0
    for x in items:
        if x['u'] in cache or fetched >= NOTICE_MAX_NEW:
            continue
        try:
            page = plain(fetch_html(NOTICE_BASE + x['u']))
        except Exception as e:                                # noqa: BLE001
            log(u'  公告內文 %s 失敗：%s' % (x['f'], str(e)[:60]))
            continue
        a, b = page.find(u'說明'), page.find(u'以上資料均由')
        parsed = parse_notice(x['t'], page[a:b] if a >= 0 else page)
        parsed.update({'code': x['f'], 'nd': x['nd']})
        cache[x['u']] = parsed
        fetched += 1

    # 快取只留還用得到的（公告日在 90 天內）
    keep_from = (date.fromisoformat(today) - timedelta(days=90)).isoformat()
    cache = dict((u, v) for u, v in cache.items() if v.get('nd', '') >= keep_from)
    d = os.path.dirname(NOTICE_CACHE)
    if not os.path.isdir(d):
        os.makedirs(d)
    with io.open(NOTICE_CACHE, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(cache, ensure_ascii=False))

    rank = {'final': 2, 'est': 1, 'none': 0}
    best = {}
    for u, v in cache.items():
        if not v.get('ex') or v.get('ck') is None:
            continue
        key = (v['code'], v['ex'])
        cur = best.get(key)
        cand = (rank[v['ck']], v['nd'])
        if cur is None or cand > (rank[cur['ck']], cur['nd']):
            best[key] = dict(v, u=NOTICE_BASE + u)
    out = [{'code': v['code'], 'ex': v['ex'], 'pay': v.get('pay'), 'cash': v['cash'],
            'ck': v['ck'], 'nd': v['nd'], 'u': v['u']}
           for v in best.values()]
    log(u'ETF 收益分配公告：%d 則（新抓 %d 則），整理出 %d 檔次' % (len(items), fetched, len(out)))
    return sorted(out, key=lambda r: (r['ex'], r['code']))


def etf_pay_dates(today, until):
    u"""e添富 dividendList -> {'代號|除息日': 發放日}。"""
    html_ = fetch_html(DIVIDEND_LIST)
    since = (date.fromisoformat(today) - timedelta(days=PAY_BACK_DAYS)).isoformat()
    out = {}
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', html_, re.S):
        cells = [plain(c) for c in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
        if len(cells) < 5:
            continue
        ex, pay = roc_date(cells[2]), roc_date(cells[4])
        if ex and pay and since <= ex <= until:
            out['%s|%s' % (cells[0], ex)] = pay
    log(u'e添富發放日：%d 筆' % len(out))
    return out


def main():
    today = date.today().isoformat()
    until = (date.today() + timedelta(days=HORIZON_DAYS)).isoformat()
    errors = []

    def collect(fn, *a):
        try:
            rows = fn(*a)
        except Exception as e:                                # noqa: BLE001
            name = getattr(fn, '__name__', 'fetch')
            errors.append(u'%s：%s' % (name, str(e)[:80]))
            log(u'  %s 失敗：%s' % (name, str(e)[:80]))
            return []
        return [r for r in rows if today <= r['d'] <= until]

    exdiv = collect(twse_exdiv) + collect(tpex_exdiv)
    meets = collect(meetings, TWSE_MEETING, 'twse') + collect(meetings, TPEX_MEETING, 'tpex')

    # 同一檔同一天只留一筆（交易所偶爾重複列）
    def dedupe(rows):
        seen, out = set(), []
        for r in sorted(rows, key=lambda x: (x['d'], x['code'])):
            key = (r['d'], r['code'], r['k'])
            if key not in seen:
                seen.add(key)
                out.append(r)
        return out

    exdiv, meets = dedupe(exdiv), dedupe(meets)
    log(u'除權息預告 %d 筆、股東會 %d 筆（%s ～ %s）' % (len(exdiv), len(meets), today, until))
    if not exdiv and not meets:
        log(u'兩份都是空的，不寫出')
        sys.exit(1)

    # ETF：發放日，以及交易所還沒填金額時用投信公告的金額（標明是預估還是實際）
    try:
        pay = etf_pay_dates(today, until)
    except Exception as e:                                    # noqa: BLE001
        errors.append(u'e添富發放日：%s' % str(e)[:80])
        pay = {}
    try:
        notices = etf_notices(today)
    except Exception as e:                                    # noqa: BLE001
        errors.append(u'ETF 收益分配公告：%s' % str(e)[:80])
        notices = []
    by_key = dict(('%s|%s' % (n['code'], n['ex']), n) for n in notices)
    filled = 0
    for r in exdiv:
        key = '%s|%s' % (r['code'], r['d'])
        n = by_key.get(key)
        r['pay'] = pay.get(key) or (n or {}).get('pay')
        if r['cash'] is None and n and n['ck'] in ('final', 'est') and n['cash']:
            r['cash'], r['ck'], r['nu'] = n['cash'], n['ck'], n['u']
            filled += 1
    log(u'交易所還沒填金額、用投信公告補上：%d 筆' % filled)

    doc = {
        'meta': {'updated': today, 'until': until,
                 'source': u'臺灣證券交易所、證券櫃檯買賣中心（除權除息預告表、股東會資料彙總表）；'
                           u'ETF 收益分配公告與發放日取自證交所 e添富',
                 'errors': errors},
        'exdiv': exdiv,
        'meetings': meets,
        # 前端的 ETF 除息分頁也要：已經除息、還沒發錢的發放日，以及預告表還沒列出的公告
        'pay': pay,
        'notices': notices,
    }
    d = os.path.dirname(OUT)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))
    log(u'寫出 %s' % OUT)


if __name__ == '__main__':
    main()
