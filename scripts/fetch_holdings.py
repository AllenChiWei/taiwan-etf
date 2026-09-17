# -*- coding: utf-8 -*-
u"""Scrape ETF holdings from issuers' PCF pages, and build the stock → ETF index.

    python scripts/fetch_holdings.py [outfile]

預設寫到 app/public/data/holdings.json。

## 為什麼是各投信的 PCF，不是別的地方

實物申購買回清單（PCF）是投信每個交易日依規定必須公告的東西，內容就是這檔
ETF 目前持有哪些股票、各多少股、佔淨值多少。它是為了讓市場參與者能執行
申購買回而公開的，用途明確、來源正式。

其他路都走不通，這是查證過的：

* **FinLab 沒有成分股資料集。** 試過 etf_holding / etf_holdings / etf_constituent /
  fund_holding / etf:holding / etf_component / etf_pcf 等 11 個名稱，全部 404。
* **TWSE OpenAPI 沒有。** 143 個端點裡與 ETF 相關的只有 /ETFReport/ETFRank，
  那是定期定額交易戶數統計，不是持股。
* **投信投顧公會的 ETF 專區沒有。** etf_info.aspx 是基本資料（671 KB / 9 個表格），
  不含成分股；櫃買的 info.tpex.org.tw/ETF 是統計儀表板。
* **MoneyDJ 有，但不用。** 他們的 robots.txt 不允許未經同意的資料探勘，而且
  本專案正在刻意降低對他們的請求量（Basic0008 已經改用 FinLab）。

## 爬蟲禮儀

* 每家投信抓之前先看過 robots.txt，**富邦因此被排除** ——
  websys.fsit.com.tw（他們 PCF 的所在）的 robots.txt 是 `Disallow: /`。
  不繞過、不換 host、不假裝成別的 user-agent。
* User-Agent 標明用途並附上網站網址，對方要擋或要聯絡都找得到人。
* 每個請求之間間隔 DELAY 秒，而且一天只跑一次（跟著既有的資料更新流程）。
* 持股變動很慢，沒必要高頻抓。

## 產出

    {
      "meta": {"updated": "2026-09-17", "etfs": 13, "stocks": 412, "issuers": [...],
               "skipped": [{"issuer": "富邦", "reason": "robots.txt 不允許"}]},
      "stocks": {"2330": {"name": "台積電",
                          "etfs": [["00690", 25.30], ["00888", 22.99]]}},
      "etfs":   {"00888": {"name": "永豐台灣ESG", "count": 60, "asof": "2026-09-16"}}
    }

stocks 是反查用的：給一個股票代號，拿到所有持有它的 ETF 與權重，已按權重排序。
"""
import io
import json
import os
import re
import sys
import time
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    ROOT, 'app', 'public', 'data', 'holdings.json')

# 請求間隔（秒）。持股一天只變一次，慢慢抓沒有任何損失。
DELAY = 2.5
TIMEOUT = 30

UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; +https://allenchiwei.github.io/taiwan-etf/) '
      'ETF holdings for a personal, non-commercial reference site')


# ── 各投信的 PCF 網址 ────────────────────────────────────────────
#
# 只需要「代號 -> 網址」。表格解析是共用的，因為每一家的 PCF 都是
# 「代號 / 名稱 / 股數 / 權重」這個形狀，只是欄位標題用詞不同。
#
# 新增一家：確認 robots.txt 允許、找出網址格式、加一筆進來、跑一次確認。

ISSUERS = [
    {
        'key': 'sinopac',
        'name': u'永豐',
        # 名稱裡出現這個字串就算這家發行的
        'match': u'永豐',
        'url': lambda code: 'https://sitc.sinopac.com/SinopacEtfs/Etfs/Pcf/%s' % code,
    },
    # 兆豐：暫時拿掉。trade_pcf.aspx 是 ASP.NET WebForms，基金是用
    # ctl00$ContentPlaceHolder1$fund_id 的 postback 切換（值是內部 id 5/17/18…，
    # 不是 ETF 代號），?fundid= 這個 query 參數**會被忽略**——每次都回傳清單上
    # 第一檔（00690）的持股。第一次跑的時候七檔兆豐 ETF 拿到的是同一份資料，
    # 靠下面的 assert_distinct() 才抓出來。
    # etf_product.aspx?id=<內部id> 能正確對應到個別 ETF（5→00690、17→00913、
    # 18→00921），但持股在 #compose 區塊由 UpdatePanel 另外載入，初始 HTML 裡沒有。
    # 要支援兆豐得先解出那個 postback，還沒做。
]

# robots.txt 明文不允許的，記錄下來讓產出說得出為什麼少了這些
BLOCKED = [
    {'issuer': u'富邦', 'reason': u'websys.fsit.com.tw 的 robots.txt 是 Disallow: /'},
]


def log(msg):
    print(msg, flush=True)


# ── HTML 表格解析（共用） ────────────────────────────────────────

def decode(raw):
    u"""照 meta charset 解碼。投信的頁面 big5 與 utf-8 都有。"""
    m = re.search(rb'charset=["\']?([\w-]+)', raw[:3000], re.I)
    enc = m.group(1).decode('ascii', 'replace') if m else 'utf-8'
    try:
        return raw.decode(enc, 'replace')
    except LookupError:
        return raw.decode('utf-8', 'replace')


def cells(tr):
    return [re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', c)).replace(u'\xa0', ' ').strip()
            for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', tr, re.S | re.I)]


def table_rows(table_html):
    rows = [c for c in (cells(r) for r in
                        re.findall(r'<tr.*?</tr>', table_html, re.S | re.I)) if c]
    return rows


# 欄位標題的各種說法。兆豐用「股票代號/持股權重」，永豐用「證券代號/佔基金淨資產比率」。
CODE_WORDS = (u'代號', u'代碼')
SHARE_WORDS = (u'股數',)
WEIGHT_WORDS = (u'權重', u'比率', u'比重')


def find_holdings_table(html):
    u"""在一頁裡找出持股表 -> (欄位索引, 資料列)。找不到回傳 (None, None)。

    用欄位標題而不是表格順序來認，因為每家的頁面結構差很多（永豐 62 個表格、
    兆豐 2 個）。只要標題同時出現「代號」與（「股數」或「權重」）就是它。
    """
    best = None
    for tb in re.findall(r'<table.*?</table>', html, re.S | re.I):
        rows = table_rows(tb)
        if len(rows) < 5:
            continue
        head = rows[0]
        joined = ' '.join(head)
        if not any(w in joined for w in CODE_WORDS):
            continue
        if not (any(w in joined for w in SHARE_WORDS)
                or any(w in joined for w in WEIGHT_WORDS)):
            continue

        def col(words):
            for i, h in enumerate(head):
                if any(w in h for w in words):
                    return i
            return None

        idx = {
            'code': col(CODE_WORDS),
            'share': col(SHARE_WORDS),
            'weight': col(WEIGHT_WORDS),
        }
        if idx['code'] is None or idx['weight'] is None:
            continue
        # 名稱通常緊接在代號後面
        idx['name'] = idx['code'] + 1 if idx['code'] + 1 < len(head) else None
        body = [r for r in rows[1:] if len(r) > max(v for v in idx.values() if v is not None)]
        if not body:
            continue
        if best is None or len(body) > len(best[1]):
            best = (idx, body)
    return best if best else (None, None)


NUM = re.compile(r'-?[\d,]+(?:\.\d+)?')


def to_num(s):
    m = NUM.search(s or '')
    if not m:
        return None
    try:
        return float(m.group(0).replace(',', ''))
    except ValueError:
        return None


# 台股代號：4~6 碼，可帶一個英文字尾（00679B、00631L、00406A）
TW_CODE = re.compile(r'^[0-9]{4,6}[A-Z]?$')


def parse_holdings(html):
    u"""-> [(股票代號, 名稱, 股數, 權重%)]，只留台股代號。

    只留台股是刻意的：這個功能是「台股反查 ETF」。海外 ETF 的成分股是美股代號
    （AAPL）或 ISIN（US126650CZ11），混進同一個索引只會讓反查結果變得沒有意義。
    """
    idx, body = find_holdings_table(html)
    if not idx:
        return []
    out = []
    for r in body:
        code = (r[idx['code']] or '').strip().upper()
        if not TW_CODE.match(code):
            continue
        weight = to_num(r[idx['weight']])
        if weight is None:
            continue
        name = (r[idx['name']] or '').strip() if idx['name'] is not None else ''
        share = to_num(r[idx['share']]) if idx['share'] is not None else None
        out.append((code, name, share, weight))
    return out


def fetch(url):
    try:
        from urllib.request import Request, urlopen
    except ImportError:                              # Python 2
        from urllib2 import Request, urlopen         # noqa
    req = Request(url, headers={
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-TW,zh;q=0.9',
    })
    return decode(urlopen(req, timeout=TIMEOUT).read())


def assert_distinct(etf_meta, stocks):
    u"""不同 ETF 不該有一模一樣的持股組合。

    這是這支腳本最重要的一道檢查。投信的 PCF 頁面常常是 ASP.NET WebForms，
    基金靠 postback 切換；用 query 參數去指定基金時，參數會被安靜地忽略，
    回來的是清單上第一檔的持股 —— HTTP 200、表格結構正確、數字看起來也合理，
    只有「每一檔都長得一樣」會露餡。

    實際發生過：兆豐七檔 ETF 全部拿到 00690 的持股，2330 在藍籌30 與三檔
    「等權重」ETF 裡都是 25.30%。等權重 ETF 單一持股 25% 本身就不可能，
    但如果沒有逐檔比對，這種資料會直接上線。

    寧可讓抓取失敗，也不要送出看起來正常的錯資料。
    """
    fingerprint = {}
    for code in etf_meta:
        holdings = tuple(sorted(
            (scode, w) for scode, s in stocks.items() for c, w in s['etfs'] if c == code))
        fingerprint.setdefault(holdings, []).append(code)

    dupes = [codes for codes in fingerprint.values() if len(codes) > 1]
    if not dupes:
        return

    lines = [u'不同 ETF 抓到完全相同的持股，代表網址沒有真的切換基金：']
    for codes in dupes:
        lines.append(u'  %s —— %s' % (
            u'、'.join(codes),
            u'、'.join(u'%s' % etf_meta[c]['name'] for c in codes)))
    lines.append(u'查一下那家投信是不是用 postback 切換基金，而不是 query 參數。')
    sys.exit(chr(10).join(lines))


def main():
    src = os.path.join(ROOT, 'app', 'public', 'data', 'etfs.json')
    doc = json.load(io.open(src, encoding='utf-8'))
    # 只做台股 ETF —— 反查的是台股，海外 ETF 的成分股不是台股代號
    etfs = [e for e in doc['etfs'] if e.get('sec') == 'cat-domestic']
    log(u'台股 ETF 共 %d 檔' % len(etfs))

    targets = []
    for iss in ISSUERS:
        mine = [e for e in etfs if iss['match'] in e['name']]
        targets += [(iss, e) for e in mine]
        log(u'  %s：%d 檔' % (iss['name'], len(mine)))
    log(u'本次要抓 %d 檔，間隔 %.1f 秒' % (len(targets), DELAY))

    stocks = {}
    etf_meta = {}
    failures = []

    for n, (iss, e) in enumerate(targets, 1):
        code = e['code']
        url = iss['url'](code)
        try:
            rows = parse_holdings(fetch(url))
        except Exception as exc:                     # noqa: BLE001
            failures.append({'code': code, 'issuer': iss['name'],
                             'error': str(exc)[:120]})
            log(u'  [%2d/%d] %-8s %-20s 失敗：%s'
                % (n, len(targets), code, e['name'][:20], str(exc)[:60]))
            time.sleep(DELAY)
            continue

        if not rows:
            failures.append({'code': code, 'issuer': iss['name'],
                             'error': u'頁面裡找不到持股表'})
            log(u'  [%2d/%d] %-8s %-20s 找不到持股表'
                % (n, len(targets), code, e['name'][:20]))
            time.sleep(DELAY)
            continue

        for scode, sname, _share, weight in rows:
            s = stocks.setdefault(scode, {'name': sname, 'etfs': []})
            if not s['name'] and sname:
                s['name'] = sname
            s['etfs'].append([code, round(weight, 2)])

        etf_meta[code] = {'name': e['name'], 'count': len(rows), 'issuer': iss['name']}
        log(u'  [%2d/%d] %-8s %-20s %3d 檔成分股'
            % (n, len(targets), code, e['name'][:20], len(rows)))
        time.sleep(DELAY)

    assert_distinct(etf_meta, stocks)

    # 每檔股票的 ETF 依權重由高到低，反查結果第一眼就看得到誰押得最重
    for s in stocks.values():
        s['etfs'].sort(key=lambda x: -x[1])

    payload = {
        'meta': {
            'updated': date.today().isoformat(),
            'etfs': len(etf_meta),
            'stocks': len(stocks),
            'issuers': [i['name'] for i in ISSUERS],
            'skipped': BLOCKED,
            'failures': failures,
            'source': u'各投信公告之實物申購買回清單（PCF）',
        },
        'stocks': stocks,
        'etfs': etf_meta,
    }
    d = os.path.dirname(OUT)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))

    log(u'')
    log(u'完成：%d 檔 ETF、%d 檔股票，寫入 %s（%.0f KB）'
        % (len(etf_meta), len(stocks), OUT, os.path.getsize(OUT) / 1024.0))
    if failures:
        log(u'失敗 %d 檔：%s' % (len(failures),
                              ', '.join(f['code'] for f in failures)))


if __name__ == '__main__':
    main()
