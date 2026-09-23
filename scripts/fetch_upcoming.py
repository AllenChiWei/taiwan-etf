# -*- coding: utf-8 -*-
u"""即將上市與近期新上市的 ETF：證交所 e添富「新上市ETF 相關簡介」。

    python scripts/fetch_upcoming.py [outfile]

預設寫到 app/public/data/upcoming.json（**不進版控**，部署時產生，跟 news.json 一樣）。

## 為什麼是這個來源、它做不到什麼

找過的官方來源（2026-09-23）：

* 證交所 OpenAPI 的 company/applylistingLocal、company/newlisting —— 只有公司股票。
* 集保基金資訊觀測站 api/etf/product —— 只有已上市的。
* 投信投顧公會 ETF 專區 —— ASP.NET postback，沒有乾淨的資料端點。

e添富的「新上市ETF」簡介是唯一結構化、有完整規格的：上市交易日期、投信、經理人、
追蹤指數、配息頻率與月份、成分股檔數、管理費……但它**通常在上市前一天才發布**，
所以這份清單是「即將上市（明天）與近期新上市」，不是「金管會剛核准、還在募集」。
更早的那一段畫面用新聞標題補（含「募集」「核准」的 ETF 新聞），只放標題與連結。

證交所 robots.txt 對 `*` 只擋 /epaper/ 與 /FTSE/。只有上市（TWSE），櫃買沒有同類頁面。

## 產出

    {"meta": {...},
     "items": [{"code", "name", "listing": "2026-08-21", "posted": "2026-08-20",
                "url", "fields": [[欄名, 內容], ...]}]}      依上市日新到舊

fields 照簡介原本的順序原樣保留 —— 被動式有「追蹤指數」、主動式有「績效指標」，
欄位不固定，寫死欄名只會讓新型態的 ETF 顯示不完整。
"""
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    ROOT, 'app', 'public', 'data', 'upcoming.json')

TPE = timezone(timedelta(hours=8))
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; +https://allenchiwei.github.io/taiwan-etf/) '
      'new ETF listings')
BASE = 'https://www.twse.com.tw/zh/ETFortune/'
CATEGORY = 'ff8080818b7e232e018b8336a1b90021'     # 「新上市ETF」這個分類的代碼
DELAY = 2.0
# 只留最近幾則。一年大約六七十檔新 ETF，畫面上看最近的就夠
LIMIT = 20


def log(m):
    print(m, flush=True)


def fetch(url, data=None):
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers={'User-Agent': UA})
    raw = urllib.request.urlopen(req, timeout=40).read()
    time.sleep(DELAY)
    return raw.decode('utf-8', 'replace')


def text(html):
    t = re.sub(r'<[^>]+>', '', html)
    t = t.replace('&nbsp;', ' ').replace('&amp;', '&').replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', t).strip()


def list_items():
    u"""新上市ETF 分類的列表：[(id, 標題, 發布日)]。"""
    html = fetch(BASE + 'newsList', {'newsCategory': CATEGORY, 'keyword': '',
                                     'max': str(LIMIT)})
    out = []
    for tr in re.findall(r'<tr onclick="[^"]*newsDetail/([0-9a-f]+)[^"]*">(.*?)</tr>', html, re.S):
        nid, body = tr
        cells = re.findall(r'<div class="content"[^>]*>(.*?)</div>|<a [^>]*class="content"[^>]*>(.*?)</a>',
                           body, re.S)
        vals = [text(a or b) for a, b in cells]
        if len(vals) < 3 or u'新上市' not in vals[0]:
            continue
        out.append((nid, vals[2], vals[1].replace('.', '-')))
    return out[:LIMIT]


def roc_date(s):
    u"""'115/08/21' 或 '2026/08/21' -> '2026-08-21'；看不懂回 None。"""
    m = re.search(r'(\d{2,4})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})', s or '')
    if not m:
        return None
    y = int(m.group(1))
    y = y + 1911 if y < 1911 else y
    return '%04d-%02d-%02d' % (y, int(m.group(2)), int(m.group(3)))


def detail(nid):
    u"""簡介頁的兩欄表格 -> [[欄名, 內容], ...]。"""
    html = fetch(BASE + 'newsDetail/' + nid)
    fields = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.S):
        tds = [text(td) for td in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
        if len(tds) != 2 or not tds[0] or not tds[1]:
            continue
        # 欄名前面常有「ETF」字樣（Word 表格拆成兩段），去掉比較好讀
        key = re.sub(r'^ETF\s*', '', tds[0]).strip()
        fields.append([key, tds[1]])
    return fields


def main():
    items = []
    try:
        entries = list_items()
    except Exception as e:                                    # noqa: BLE001
        log(u'  ⚠ 列表抓不到：%s' % str(e)[:80])
        return 1
    log(u'新上市ETF 簡介 %d 則' % len(entries))
    for nid, title, posted in entries:
        m = re.search(r'^(.*?)\(([0-9A-Z]{4,7})\)', title)
        try:
            fields = detail(nid)
        except Exception as e:                                # noqa: BLE001
            log(u'  ⚠ %s：%s' % (title, str(e)[:60]))
            fields = []
        get = dict(fields).get
        listing = roc_date(get(u'上市交易日期') or get(u'上市日期') or '')
        items.append({
            'code': (get(u'上市代號') or (m.group(2) if m else '')).strip(),
            # 標題裡的是簡稱（「主動永豐科技趨勢(00410A)相關簡介」），比表格的基金全名好讀；
            # 標題拆不出代號時（括號格式不同）才用表格的名稱，並去掉後面掛的法定警語
            'name': (m.group(1) if m else re.sub(u'\s*[（(]\s*本?基金[^）)]*[）)]', '',
                                                 get(u'名稱') or title)).strip(),
            'listing': listing,
            'posted': posted,
            'url': BASE + 'newsDetail/' + nid,
            'fields': fields,
        })
    items.sort(key=lambda x: x['listing'] or x['posted'], reverse=True)
    payload = {
        'meta': {
            'updated': datetime.now(TPE).date().isoformat(),
            'source': u'臺灣證券交易所 ETF e添富「新上市ETF」相關簡介',
            'note': u'簡介通常在上市前一天發布；只有上市（證交所），不含上櫃。',
        },
        'items': items,
    }
    d = os.path.dirname(OUT)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    log(u'完成：%s（%d 檔）' % (OUT, len(items)))
    return 0 if items else 1


if __name__ == '__main__':
    sys.exit(main())
