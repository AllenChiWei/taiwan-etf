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

「除權」不一定是配股：現金增資的認購權也會讓股票除權（例：2026-10-07 永豐金，無償配股率 0、
現金增資配股率 0.0433、認購價 35.15）。所以另外帶 cap（現金增資配股率，每股可認購股數）與
capPx（認購價），前端據此標成「除權（現金增資）」。

## 法說會：從重大訊息累積

官方的「法人說明會一覽表」只在舊版公開資訊觀測站（mopsov.twse.com.tw），它的
robots.txt 是 `User-Agent: * / Disallow: /`（只開放 bingbot）；新版觀測站的同一頁也是
轉呼叫舊站的 ajax_t100sb02_1。本專案不繞過 robots、不換 host，所以不抓那一頁。

改用重大訊息：公司召開或受邀參加法說會時，依「重大訊息處理程序」第四條第 12 款
要發重大訊息，內文格式固定（召開法人說明會之日期／時間／地點／擇要訊息）。
證交所 openapi t187ap04_L、櫃買 mopsfin_t187ap04_O 就是這份（新聞頁也在用），
但只給最近一天的重大訊息，所以要**累積**：每次部署把線上已發布的 calendar.json 的
calls 抓回來，再併入當天的。漏掉某天部署就漏掉那天公告的法說會（多半是當天或幾天後
召開的），所以這份清單不保證完整。2026-10-08 加入。

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
TWSE_FILINGS = 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L'
TPEX_FILINGS = 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O'
# 上一次發布的行事曆（法說會要累積）；SITE_URL 可改成別的部署位置
PUBLISHED = (os.environ.get('SITE_URL') or 'https://allenchiwei.github.io/taiwan-etf/').rstrip('/') \
    + '/data/calendar.json'


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
    i_cap, i_cap_px = f.index(u'現金增資配股率'), f.index(u'現金增資認購價')
    out = []
    for r in doc.get('data', []):
        day = roc_date(r[i_date])
        if not day:
            continue
        out.append({'d': day, 'code': r[i_code].strip(), 'name': r[i_name].strip(),
                    'k': r[i_kind].strip(), 'cash': cash_of(r[i_cash]),
                    'stock': (num(r[i_stock]) or None), 'm': 'twse',
                    'cap': (num(r[i_cap]) or None), 'capPx': (num(r[i_cap_px]) or None)})
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
                    'stock': (num(r.get('StockDividendRatio')) or None), 'm': 'tpex',
                    'cap': (num(r.get('SubscriptionRatioToNewSharesIssued')) or None),
                    'capPx': (num(r.get('SubscriptionPricePerShare')) or None)})
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


# ── 法說會（重大訊息第 12 款）─────────────────────────────────────────────
#
#     符合條款第四條第XX款：12
#     1.召開法人說明會之日期：115/10/15          ← 也可能是區間「115/10/13 ~ 115/10/20」（NDR）
#     2.召開法人說明會之時間：14 時 00 分
#     3.召開法人說明會之地點：…
#     4.法人說明會擇要訊息：…
#     5.其他應敘明事項：…

def _field(row, name):
    u"""欄位名稱有時帶空白（證交所的「主旨 」），比對時去掉。"""
    for k, v in row.items():
        if k.strip() == name:
            return v
    return None


def _line(body, label):
    m = re.search(label + u'\\s*[:：]\\s*([^\\r\\n]*)', body)
    return m.group(1).strip() if m else ''


def parse_call(row, market):
    u"""一則重大訊息 -> 法說會（不是第 12 款或看不懂日期就回 None）。"""
    if not re.search(u'第\\s*12\\s*款', _field(row, u'符合條款') or ''):
        return None
    body = _field(row, u'說明') or ''
    days = re.findall(ROC_SLASH, _line(body, u'召開法人說明會之日期'))
    start = roc_slash_t(days[0]) if days else None
    if not start:
        return None
    end = roc_slash_t(days[1]) if len(days) > 1 else None
    tm = re.match(u'(\\d{1,2})\\s*時\\s*(\\d{1,2})\\s*分', _line(body, u'召開法人說明會之時間'))
    code = (_field(row, u'公司代號') or _field(row, 'SecuritiesCompanyCode') or '').strip()
    name = (_field(row, u'公司名稱') or _field(row, 'CompanyName') or '').strip()
    said = (_field(row, u'發言日期') or '').strip() + (_field(row, u'發言時間') or '').strip().zfill(6)
    out = {'d': start, 'code': code, 'name': name, 'm': market,
           't': '%02d:%02d' % (int(tm.group(1)), int(tm.group(2))) if tm else None,
           'place': plain(_line(body, u'召開法人說明會之地點'))[:60],
           'topic': plain(_line(body, u'法人說明會擇要訊息') or _field(row, u'主旨') or '')[:120],
           'said': said}
    if end and end > start:
        out['end'] = end
    return out if code else None


def roc_slash_t(t):
    u"""re.findall 的 (年, 月, 日) -> ISO；不合法回 None。"""
    try:
        return date(int(t[0]) + 1911, int(t[1]), int(t[2])).isoformat()
    except ValueError:
        return None


def earnings_calls(today):
    u"""上次發布的 calls ＋ 今天的重大訊息。同一家同一天只留最新發言的一則（更正公告會蓋掉舊的）。"""
    rows, errors = [], []
    try:
        req = urllib.request.Request(PUBLISHED, headers={'User-Agent': UA})
        prev = json.loads(urllib.request.urlopen(req, timeout=TIMEOUT).read().decode('utf-8'))
        rows += prev.get('calls') or []
        log(u'上次發布的法說會：%d 筆' % len(prev.get('calls') or []))
    except Exception as e:                                    # noqa: BLE001
        errors.append(u'上次發布的法說會：%s' % str(e)[:80])
        log(u'  上次發布的法說會讀不到（%s），這次只有今天的重大訊息' % str(e)[:60])
    if os.path.isfile(OUT):                                   # 本機重跑時也接得上
        try:
            rows += json.load(io.open(OUT, encoding='utf-8')).get('calls') or []
        except Exception:                                     # noqa: BLE001
            pass
    new = 0
    for url, market in ((TWSE_FILINGS, 'twse'), (TPEX_FILINGS, 'tpex')):
        try:
            for r in fetch_json(url):
                c = parse_call(r, market)
                if c:
                    rows.append(c)
                    new += 1
        except Exception as e:                                # noqa: BLE001
            errors.append(u'重大訊息（%s）：%s' % (market, str(e)[:80]))
            log(u'  重大訊息 %s 失敗：%s' % (market, str(e)[:60]))
    best = {}
    for c in rows:
        if (c.get('end') or c['d']) < today:
            continue
        key = (c['code'], c['d'])
        if key not in best or c.get('said', '') >= best[key].get('said', ''):
            best[key] = c
    out = sorted(best.values(), key=lambda c: (c['d'], c.get('t') or '', c['code']))
    log(u'法說會：今天的重大訊息 %d 則，合併後 %d 筆' % (new, len(out)))
    return out, errors


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
#
# 上櫃的 ETF（大部分債券 ETF）不在 e添富，要另外看櫃買「ETF 訊息中心」的收益分配公告：
#   列表 POST https://info.tpex.org.tw/api/etfMaInfo        type=distribution（一次回全部歷史，含 fund 代號）
#   內文 POST https://info.tpex.org.tw/api/etfMaInfoDetail  （列表的 params 原樣送）→ description
# 格式與證交所轉載的相同（除息交易日、預估配發金額為新臺幣…元、每受益權單位配發金額）。
# info.tpex.org.tw 沒有 robots.txt（2026-10-07 查過，轉到首頁）。

TPEX_NOTICE_LIST = 'https://info.tpex.org.tw/api/etfMaInfo'
TPEX_NOTICE_DETAIL = 'https://info.tpex.org.tw/api/etfMaInfoDetail'
TPEX_NOTICE_PAGE = 'https://info.tpex.org.tw/ETF/zh/announcement-detail.html?'
TPEX_MAX_NEW = 150

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


def post_json(url, data):
    import urllib.parse
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers={'User-Agent': UA})
    last = None
    for attempt in range(3):
        try:
            raw = urllib.request.urlopen(req, timeout=TIMEOUT).read()
            time.sleep(1)
            return json.loads(raw.decode('utf-8'))
        except Exception as e:                                # noqa: BLE001
            last = e
            time.sleep(5 * (attempt + 1))
    raise last


def tpex_notice_items(cutoff):
    u"""櫃買 ETF 訊息中心的收益分配公告（公告日 >= cutoff）。"""
    out = []
    for x in post_json(TPEX_NOTICE_LIST, {'type': 'distribution'}):
        params = x.get('params') or ''
        fund = re.search(r'fund=([0-9A-Z]+)', params)
        nd = (x.get('date') or '').replace('.', '-')
        if fund and nd >= cutoff:
            out.append({'nd': nd, 'u': 'tpex:' + params, 'f': fund.group(1),
                        't': plain(x.get('subject') or ''), 'params': params})
    return out


def tpex_notice_body(params):
    import urllib.parse
    q = dict(urllib.parse.parse_qsl(params))
    rows = post_json(TPEX_NOTICE_DETAIL, q)
    if not rows:
        return ''
    # 內文用 CRLF 硬換行，數字或「新臺幣」可能被切斷 → 直接接起來
    return re.sub(r'[\r\n]+', '', rows[0].get('description') or '')


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
    final = re.search(u'每受益權單位配發金額\\s*[:：]\\s*(?:新臺幣)?\\s*(\\d+(?:\\.\\d+)?)', body)   # 金額後面可能直接接句點（「0.0633.」）
    est = re.search(u'(?:預估|預計)配發金額(?:每受益權單位)?(?:為)?\\s*新臺幣\\s*(\\d+(?:\\.\\d+)?)', body)   # 金額後面可能直接接句點（「0.0633.」）
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
    try:
        tp = tpex_notice_items(cutoff)
    except Exception as e:                                    # noqa: BLE001
        log(u'  櫃買 ETF 公告列表失敗：%s' % str(e)[:60])
        tp = []

    fetched = fetched_tp = 0
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
    for x in tp:
        if x['u'] in cache or fetched_tp >= TPEX_MAX_NEW:
            continue
        try:
            body = tpex_notice_body(x['params'])
        except Exception as e:                                # noqa: BLE001
            log(u'  櫃買公告內文 %s 失敗：%s' % (x['f'], str(e)[:60]))
            continue
        parsed = parse_notice(x['t'], body)
        parsed.update({'code': x['f'], 'nd': x['nd']})
        cache[x['u']] = parsed
        fetched_tp += 1
    items = items + tp

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
            best[key] = dict(v, u=(TPEX_NOTICE_PAGE + u[5:]) if u.startswith('tpex:') else NOTICE_BASE + u)
    out = [{'code': v['code'], 'ex': v['ex'], 'pay': v.get('pay'), 'cash': v['cash'],
            'ck': v['ck'], 'nd': v['nd'], 'u': v['u']}
           for v in best.values()]
    log(u'ETF 收益分配公告：%d 則（新抓 證交所 %d、櫃買 %d 則），整理出 %d 檔次' % (len(items), fetched, fetched_tp, len(out)))
    return sorted(out, key=lambda r: (r['ex'], r['code']))


def etf_pay_dates(today, until):
    u"""e添富 dividendList -> ({'代號|除息日': 發放日}, {代號: 簡稱})。"""
    html_ = fetch_html(DIVIDEND_LIST)
    since = (date.fromisoformat(today) - timedelta(days=PAY_BACK_DAYS)).isoformat()
    out, names = {}, {}
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', html_, re.S):
        cells = [plain(c) for c in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
        if len(cells) < 5:
            continue
        names.setdefault(cells[0], cells[1])
        ex, pay = roc_date(cells[2]), roc_date(cells[4])
        if ex and pay and since <= ex <= until:
            out['%s|%s' % (cells[0], ex)] = pay
    log(u'e添富發放日：%d 筆' % len(out))
    return out, names


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
        pay, names = etf_pay_dates(today, until)
    except Exception as e:                                    # noqa: BLE001
        errors.append(u'e添富發放日：%s' % str(e)[:80])
        pay, names = {}, {}
    try:
        notices = etf_notices(today)
    except Exception as e:                                    # noqa: BLE001
        errors.append(u'ETF 收益分配公告：%s' % str(e)[:80])
        notices = []
    for n in notices:
        n['name'] = names.get(n['code'], '')
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

    calls, call_errors = earnings_calls(today)
    calls = [c for c in calls if c['d'] <= until]
    errors += call_errors

    doc = {
        'meta': {'updated': today, 'until': until,
                 'source': u'臺灣證券交易所、證券櫃檯買賣中心（除權除息預告表、股東會資料彙總表）；'
                           u'ETF 收益分配公告取自證交所 e添富與櫃買 ETF 訊息中心，發放日取自 e添富與投信公告；'
                           u'法說會取自上市櫃公司重大訊息',
                 'errors': errors},
        'exdiv': exdiv,
        'meetings': meets,
        # 法說會：重大訊息第 12 款，逐日累積（見檔頭說明）
        'calls': calls,
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
