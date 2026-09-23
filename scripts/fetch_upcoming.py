# -*- coding: utf-8 -*-
u"""還沒上市的 ETF：募集中、待上市、明天上市。

    python scripts/fetch_upcoming.py [outfile]

預設寫到 app/public/data/upcoming.json（**不進版控**，部署時產生，跟 news.json 一樣）。
**已經上市的一律不列**（站主指定，2026-09-23）—— 那些在台股清單裡就看得到。

## 為什麼要靠新聞：官方沒有「募集中」的結構化清單

找過的官方來源（2026-09-23）：

* 證交所 OpenAPI company/applylistingLocal、company/newlisting —— 只有公司股票。
* 集保基金資訊觀測站 api/etf/product —— 只有已上市的；api/onshore/announce/info-new
  有「基金成立」事件，但只有基金全名、沒有證券代號，而且成立時募集已經結束了。
* 投信投顧公會 ETF 專區 —— ASP.NET postback，基金清單裡也還沒有募集中的。
* 證交所 e添富「新上市ETF 相關簡介」—— 規格最完整，但**上市前一天才發布**。

所以分兩段：

1. **找代號**：掃鉅亨網 ETF 與台股分類近 75 天的新聞標題，抓出 ETF 代號，扣掉
   etfs.json 裡已經上市的。新 ETF 在募集前後都有新聞（00412A、00415A 都是）。
   標題提到「募集／開募／新秀／新兵／掛牌」的連內文一起掃 —— 「5 檔新秀登場」這種
   標題只寫兩個代號，第三檔（00992B）只在內文裡。
2. **補細節**：每個代號用鉅亨網關鍵字搜尋，讀那幾則新聞的標題、摘要與內文，推出名稱、
   投信、開募日、預計上市日。只看代號附近到下一個代號為止的那一段，免得一篇介紹好幾檔
   的文章把別檔的日期算到這檔頭上。**內文與摘要只在執行時拿來推資訊，不存** ——
   新聞只存標題與連結是這個站的規矩。
   上市前一天證交所簡介出來後，改用簡介的完整規格。

推出來的日期標明是「新聞」，畫面上要讓人知道它不是官方公告。

鉅亨網：api.cnyes.com 的 robots.txt 對所有人 Allow: /；ess.api.cnyes.com（搜尋）
沒有 robots.txt。證交所 robots.txt 對 `*` 只擋 /epaper/ 與 /FTSE/。

## 產出

    {"meta": {...},
     "items": [{"code", "name", "issuer", "raise": "9/16", "listing": "2026-10-13",
                "stage": "raising|listing|tomorrow", "source": "news|twse",
                "url", "fields": [[欄名, 內容], ...], "news": [[標題, 連結, 日期], ...]}]}
"""
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    ROOT, 'app', 'public', 'data', 'upcoming.json')
ETFS = os.path.join(ROOT, 'app', 'public', 'data', 'etfs.json')

TPE = timezone(timedelta(hours=8))
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; +https://allenchiwei.github.io/taiwan-etf/) '
      'new ETF listings')
DELAY = 1.5

TWSE = 'https://www.twse.com.tw/zh/ETFortune/'
TWSE_CATEGORY = 'ff8080818b7e232e018b8336a1b90021'     # e添富「新上市ETF」分類的代碼
CNYES_LIST = 'https://api.cnyes.com/media/api/v1/newslist/category/%s?'
CNYES_SEARCH = 'https://ess.api.cnyes.com/ess/api/v1/news/keyword?'
CNYES_LINK = 'https://news.cnyes.com/news/id/%s'
CNYES_CATEGORIES = ['etf', 'tw_stock']
LOOKBACK_DAYS = 75
# 標題有這些字的 ETF 新聞連內文一起掃代號（最多 MAX_BODIES 篇，控制請求量）
BODY_HINT = re.compile(u'募集|開募|新秀|新兵|掛牌|新ETF|新基金')
MAX_BODIES = 12
# 每個代號最多讀幾篇內文來推名稱與日期
BODIES_PER_CODE = 3

# ETF 代號：00 開頭、共 5～6 碼，後面可能帶一個英文字母（A 主動、B 債券、D…）
CODE = re.compile(r'(?<![0-9A-Za-z])(00\d{3,4}[A-Z]?)(?![0-9A-Za-z])')
ISSUERS = [u'元大', u'國泰', u'富邦', u'中國信託', u'中信', u'統一', u'復華', u'群益', u'野村',
           u'凱基', u'永豐', u'第一金', u'兆豐', u'貝萊德', u'摩根', u'聯博', u'大華銀', u'玉山',
           u'華南永昌', u'聯邦', u'台新', u'新光', u'安聯', u'富蘭克林', u'路博邁', u'瀚亞',
           u'保德信', u'國票', u'街口', u'第一金', u'華南']

ERRORS = []


def log(m):
    print(m, flush=True)


def note(m):
    log(u'  ⚠ %s' % m)
    ERRORS.append(m)


def get(url, data=None):
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers={'User-Agent': UA})
    raw = urllib.request.urlopen(req, timeout=40).read()
    time.sleep(DELAY)
    return raw.decode('utf-8', 'replace')


def text(html):
    t = re.sub(r'<[^>]+>', '', html or '')
    t = t.replace('&nbsp;', ' ').replace('&amp;', '&').replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', t).strip()


def today():
    return datetime.now(TPE).date()


# ── 證交所：上市前一天的完整簡介 ──────────────────────────────

def roc_date(s):
    u"""'115/08/21' 或 '2026/08/21' -> '2026-08-21'；看不懂回 None。"""
    m = re.search(r'(\d{2,4})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})', s or '')
    if not m:
        return None
    y = int(m.group(1))
    y = y + 1911 if y < 1911 else y
    return '%04d-%02d-%02d' % (y, int(m.group(2)), int(m.group(3)))


def twse_briefs():
    u"""{代號: {name, listing, url, fields}}，e添富「新上市ETF」最近 20 則簡介。"""
    html = get(TWSE + 'newsList', {'newsCategory': TWSE_CATEGORY, 'keyword': '', 'max': '20'})
    out = {}
    for nid, body in re.findall(r'<tr onclick="[^"]*newsDetail/([0-9a-f]+)[^"]*">(.*?)</tr>', html, re.S):
        cells = re.findall(r'<div class="content"[^>]*>(.*?)</div>|<a [^>]*class="content"[^>]*>(.*?)</a>',
                           body, re.S)
        vals = [text(a or b) for a, b in cells]
        if len(vals) < 3 or u'新上市' not in vals[0]:
            continue
        title = vals[2]
        m = re.search(r'^(.*?)\(([0-9A-Z]{4,7})\)', title)
        # 已經上市的不需要打開簡介：列表上的發布日比今天早兩天以上，多半就是已上市
        posted = vals[1].replace('.', '-')
        if posted < (today() - timedelta(days=2)).isoformat():
            continue
        fields = []
        for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', get(TWSE + 'newsDetail/' + nid), re.S):
            tds = [text(td) for td in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
            if len(tds) == 2 and tds[0] and tds[1]:
                fields.append([re.sub(r'^ETF\s*', '', tds[0]).strip(), tds[1]])
        f = dict(fields)
        code = (f.get(u'上市代號') or (m.group(2) if m else '')).strip()
        if not code:
            continue
        out[code] = {
            # 標題裡的是簡稱，比表格的基金全名好讀；拆不出來才用表格的並去掉法定警語
            'name': (m.group(1) if m else re.sub(u'\\s*[（(]\\s*本?基金[^）)]*[）)]', '',
                                                 f.get(u'名稱') or title)).strip(),
            'listing': roc_date(f.get(u'上市交易日期') or f.get(u'上市日期') or ''),
            'url': TWSE + 'newsDetail/' + nid,
            'fields': fields,
        }
    return out


# ── 鉅亨網：從新聞找代號、推日期 ──────────────────────────────

def article_text(news_id):
    u"""新聞頁的純文字。**只在這次執行裡用來推代號、名稱與日期，不寫進檔案。**"""
    html = ''
    for attempt in (1, 2, 3):               # 新聞頁將近 200 KB，常常讀到一半斷線
        try:
            html = get(CNYES_LINK % news_id)
            break
        except Exception as e:                                # noqa: BLE001
            if attempt == 3:
                note(u'鉅亨網新聞 %s：%s' % (news_id, str(e)[:60]))
                return ''
            time.sleep(DELAY * 2 * attempt)
    return text(re.sub(r'<script.*?</script>|<style.*?</style>', ' ', html, flags=re.S))


def cnyes_candidates(listed):
    u"""近 LOOKBACK_DAYS 天 ETF／台股新聞裡、還沒上市的 ETF 代號。"""
    now = int(time.time())
    found = set()
    bodies = []
    for cat in CNYES_CATEGORIES:
        page = 1
        while page <= 8:
            q = urllib.parse.urlencode({'limit': 100, 'page': page,
                                        'startAt': now - LOOKBACK_DAYS * 86400, 'endAt': now})
            try:
                d = json.loads(get(CNYES_LIST % cat + q))
            except Exception as e:                            # noqa: BLE001
                note(u'鉅亨網 %s 第 %d 頁：%s' % (cat, page, str(e)[:60]))
                break
            items = (d.get('items') or {}).get('data') or []
            for x in items:
                title = x.get('title') or ''
                for c in CODE.findall(title):
                    if c not in listed:
                        found.add(c)
                if cat == 'etf' and BODY_HINT.search(title) and x.get('newsId') not in bodies:
                    bodies.append(x.get('newsId'))
            if page >= (d.get('items') or {}).get('last_page', 1):
                break
            page += 1
    # 「5 檔新秀登場」這種標題只寫兩個代號，其餘的只在內文
    for nid in bodies[:MAX_BODIES]:
        for c in CODE.findall(article_text(nid)):
            if c not in listed:
                found.add(c)
    return found


MD = u'(\\d{1,2})\\s*[/月]\\s*(\\d{1,2})\\s*日?'


def infer_date(texts, words):
    u"""「9/16 開募」「10月13日掛牌」這類寫法 -> (月, 日)。取最常出現的那個。"""
    hits = Counter()
    pat = re.compile(MD + u'\\s*(?:起)?\\s*(?:' + '|'.join(words) + ')')
    for t in texts:
        for m in pat.finditer(t):
            mo, dd = int(m.group(1)), int(m.group(2))
            if 1 <= mo <= 12 and 1 <= dd <= 31:
                hits[(mo, dd)] += 1
    return hits.most_common(1)[0][0] if hits else None


def to_date(md):
    u"""(月, 日) -> 今年或明年的那一天。新聞不寫年份，取離今天 45 天前之後最近的那個。"""
    if not md:
        return None
    t = today()
    for y in (t.year, t.year + 1):
        try:
            d = date(y, md[0], md[1])
        except ValueError:
            return None
        if d >= t - timedelta(days=45):
            return d
    return None


def infer_name(code, texts):
    u"""推名稱。新聞常見三種寫法，簡稱（「主動」開頭）優先：

        主動群益核心50(00415A-TW)
        「台新臺灣中小主動式ETF基金(00416A-TW)」
        00415A 主動群益核心50 30日開募
    """
    cands = Counter()
    c = re.escape(code)
    before = re.compile(u'([一-鿿A-Za-z0-9&＆]{3,26})\\s*[（(]' + c + u'(?:-TW)?[）)]')
    after = re.compile(c + u'(?:-TW)?[\\s「」:：]*(主動[一-鿿A-Za-z0-9]{2,14})')
    for t in texts:
        for m in before.finditer(t):
            name = tidy_name(m.group(1))
            cands[name] += 3 if name.startswith(u'主動') else 1
        for m in after.finditer(t):
            cands[m.group(1)] += 2
    return cands.most_common(1)[0][0] if cands else None


def tidy_name(s):
    u"""「著重台、韓、日半導體股的主動安聯亞半導體」-> 「主動安聯亞半導體」。

    往前抓名稱時會連到前面的句子。有「主動」就從它開始；否則切在最後一個
    「的／推出／為」之後（「…即將推出FT核心AI電力算力ETF」-> 「FT核心AI電力算力ETF」）。
    """
    s = re.sub(u'證券投資信託基金$|基金$', '', s)
    # 「主動式」是型態不是名稱開頭（「台新臺灣中小主動式ETF」），只有「主動群益…」這種才截
    m = re.search(u'主動(?!式)', s)
    if m and m.start() > 0:
        return s[m.start():]
    parts = re.split(u'的|推出|為|是', s)
    return parts[-1] or s


def near(code, body, span=260):
    u"""內文裡這個代號附近的片段：從代號前 60 字到下一個代號（或 span 字）為止。"""
    out = []
    for m in re.finditer(re.escape(code), body):
        start = max(0, m.start() - 60)
        nxt = CODE.search(body, m.end())
        stop = nxt.start() if nxt and nxt.group(1) != code else len(body)
        out.append(body[start:min(m.end() + span, stop)])
    return out


def infer_issuer(code, texts):
    u"""投信名稱：只看代號前 40 字（「街口投信發行的…ETF(00992B-TW)」）。

    整段文字一起算會被同一篇提到的別家投信帶走 —— 00992B 那篇也寫了路博邁。
    名稱本身帶投信（「主動群益核心50」）時直接用。
    """
    c = Counter()
    for t in texts:
        for m in re.finditer(re.escape(code), t):
            window = t[max(0, m.start() - 40):m.start()]
            for name in ISSUERS:
                if name in window:
                    c[name] += 1
    return c.most_common(1)[0][0] if c else None


def cnyes_detail(code):
    u"""用代號搜尋 -> (相關新聞 [[標題, 連結, 日期]], 推出來的資訊)。"""
    q = urllib.parse.urlencode({'q': code, 'limit': 20, 'page': 1})
    d = json.loads(get(CNYES_SEARCH + q))
    news, texts, ids = [], [], []
    for x in ((d.get('data') or {}).get('items') or []):
        title = text(x.get('title'))
        summary = text(x.get('summary'))
        if code not in title and code not in summary:
            continue                                        # 關鍵字搜尋是模糊比對
        texts += [title] + near(code, summary)
        ids.append(x.get('newsId'))
        at = datetime.fromtimestamp(int(x.get('publishAt') or 0), TPE).date().isoformat()
        news.append([title, CNYES_LINK % x.get('newsId'), at])
    for nid in ids[:BODIES_PER_CODE]:
        texts += near(code, article_text(nid))
    news.sort(key=lambda n: n[2], reverse=True)
    raise_md = infer_date(texts, [u'開募', u'開始募集', u'募集', u'首募'])
    listing = to_date(infer_date(texts, [u'掛牌', u'上市']))
    name = infer_name(code, texts)
    issuer = next((i for i in ISSUERS if name and i in name), None) or infer_issuer(code, texts)
    return news[:5], {
        'name': name,
        'issuer': issuer,
        'raise': '%d/%d' % raise_md if raise_md else None,
        'listing': listing.isoformat() if listing else None,
    }


def main():
    try:
        listed = set(x['code'] for x in json.load(io.open(ETFS, encoding='utf-8'))['etfs'])
    except Exception as e:                                    # noqa: BLE001
        note(u'讀不到 etfs.json：%s' % str(e)[:60])
        listed = set()
    t = today().isoformat()

    try:
        briefs = twse_briefs()
    except Exception as e:                                    # noqa: BLE001
        note(u'證交所新上市簡介：%s' % str(e)[:60])
        briefs = {}
    # 簡介裡上市日還沒到的也算（新聞可能沒提到它）
    codes = set(c for c, b in briefs.items() if c not in listed and (b['listing'] or '9') > t)
    codes |= cnyes_candidates(listed)
    log(u'還沒上市的代號：%s' % (u'、'.join(sorted(codes)) or u'無'))

    items = []
    for code in sorted(codes):
        try:
            news, info = cnyes_detail(code)
        except Exception as e:                                # noqa: BLE001
            note(u'%s 搜尋：%s' % (code, str(e)[:60]))
            news, info = [], {}
        b = briefs.get(code)
        listing = (b or {}).get('listing') or info.get('listing')
        if listing and listing <= t:
            continue                                        # 已經上市（etfs.json 還沒更新到）
        stage = 'tomorrow' if b else ('listing' if listing else 'raising')
        items.append({
            'code': code,
            'name': (b or {}).get('name') or info.get('name'),
            'issuer': info.get('issuer'),
            'raise': info.get('raise'),
            'listing': listing,
            'stage': stage,
            'source': 'twse' if b else 'news',
            'url': (b or {}).get('url'),
            'fields': (b or {}).get('fields') or [],
            'news': news,
        })
        log(u'  %s %s（%s）：開募 %s、上市 %s，新聞 %d 則' % (
            code, items[-1]['name'] or u'?', info.get('issuer') or u'?',
            info.get('raise') or u'—', listing or u'—', len(news)))
    # 上市日近的排前面，還沒有上市日的放最後
    items.sort(key=lambda x: (x['listing'] or '9999', x['code']))
    payload = {
        'meta': {
            'updated': datetime.now(TPE).date().isoformat(),
            'source': u'鉅亨網新聞（代號與日期）；臺灣證券交易所 ETF e添富新上市簡介（規格）',
            'note': (u'官方沒有募集中 ETF 的清單：代號與日期是從新聞推出來的，上市前一天'
                     u'證交所簡介發布後才有完整規格。已上市的不列。'),
            'errors': ERRORS,
        },
        'items': items,
    }
    d = os.path.dirname(OUT)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    log(u'完成：%s（%d 檔）' % (OUT, len(items)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
