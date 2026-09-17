# -*- coding: utf-8 -*-
u"""新聞與公告：財經媒體的標題，加上公開資訊觀測站的重大訊息。

    python scripts/fetch_news.py [outfile]

預設寫到 app/public/data/news.json。

## 為什麼是這三個來源

**只存標題、時間、來源與連結，不存內文。** 這是這支腳本的基本規矩：新聞內文有著作權，
我們做的是索引與導流，點下去要回到原站閱讀。JSON 裡不會出現文章本文，即使 API 有給。

    鉅亨網 api.cnyes.com   台股新聞。robots.txt 對所有人 Allow: /，
                           而且每則有掛到的個股代號，可以標出「跟你清單裡哪一檔有關」
    中央社 RSS             官方提供的 RSS，本來就是給人訂閱轉載標題用的。
                           他們的 content-signal 是 ai-train=no（不給訓練模型）、
                           search=yes —— 我們不訓練任何東西，只放標題與外連
    公開資訊觀測站         證交所 t187ap04_L 與櫃買 mopsfin_t187ap04_O 的重大訊息。
                           官方原始公告，最沒有爭議的一份

**查過但不採用的兩個：**

*奇摩股市*。他們的 robots.txt 有一組明確點名 AI 代理的清單（anthropic-ai、ClaudeBot、
Claude-Web、GPTBot、PerplexityBot、CCBot…）全部 `Disallow: /`；而對所有人的那一組也擋掉
`/api`、`/caas`、`/_td-news`，新聞 JSON 正好在那些路徑下。本專案不繞過 robots、不換 host、
不假裝成別的 User-Agent（富邦的 PCF 也是因此被排除），所以這條路直接不走。

*Google*。news.google.com 的 robots 是 `Disallow: /` 只開放少數幾條路徑，`/rss` 不在裡面；
抓搜尋結果頁本身也違反他們的服務條款。

## 重大訊息的連結

公開資訊觀測站新版是 SPA（mops.twse.com.tw/mops/#/web/t05st01），沒辦法用 GET 帶公司代號
深連結。`mopsov.twse.com.tw/mops/web/t05st01?firstin=1&co_id=XXXX` 這個舊版路徑實測可以，
會直接落在該公司的重大訊息頁，所以連結用它 —— 不是隨手寫一個沒驗過的網址。

## 日期與時間

三個來源三種格式：鉅亨給 Unix 秒、中央社給 RFC 822、觀測站給民國年字串（1150916 與
70003 這種「時分秒」）。全部轉成 ISO 8601 的台北時間再寫出去，前端只需要處理一種。
"""
import io
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

OUT = os.path.join(ROOT, 'app', 'public', 'data', 'news.json')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
if args:
    OUT = args[0]

UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) news headlines, links back to source')

DELAY = 1.5
TIMEOUT = 40
TPE = timezone(timedelta(hours=8))

# 一頁塞不下也不該塞下全部。新聞留最近這麼多則就夠看，再多是往下捲到沒人看的地方。
MAX_NEWS = 120

CNYES_API = ('https://api.cnyes.com/media/api/v1/newslist/category/%s'
             '?limit=30&page=%d')
CNYES_CATEGORIES = [('tw_stock', u'台股')]
CNYES_LINK = 'https://news.cnyes.com/news/id/%s'
CNYES_PAGES = 2

CNA_FEED = 'https://feeds.feedburner.com/rsscna/finance'
CNA_NAME = u'中央社'

TWSE_FILINGS = 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L'
TPEX_FILINGS = 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O'
MOPS_LINK = 'https://mopsov.twse.com.tw/mops/web/t05st01?firstin=1&co_id=%s'


def log(m):
    print(m, flush=True)


def write_json(path, obj):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')))


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    raw = urllib.request.urlopen(req, timeout=TIMEOUT).read()
    time.sleep(DELAY)
    return raw


def tracked_codes():
    u"""站上追蹤的代號集合（ETF ∪ 個股），用來標記哪些新聞跟清單有關。

    讀不到 etfs.json 就回空集合：標記不到而已，新聞本身照樣有用。
    """
    codes = set()
    try:
        doc = json.load(io.open(os.path.join(ROOT, 'app', 'public', 'data', 'etfs.json'),
                                encoding='utf-8'))
        codes |= set(e['code'] for e in doc['etfs'])
    except Exception as e:                                    # noqa: BLE001
        log(u'  讀不到 etfs.json（%s），新聞不做代號標記' % str(e)[:60])
    try:
        from etfdata import EXTRA_STOCKS
        codes |= set(EXTRA_STOCKS)
    except Exception:                                         # noqa: BLE001
        pass
    return codes


# ── 新聞 ─────────────────────────────────────────────────────

def cnyes(codes):
    u"""鉅亨網的台股新聞。只取標題、時間、連結與掛到的個股代號。"""
    out = []
    for cat, label in CNYES_CATEGORIES:
        for page in range(1, CNYES_PAGES + 1):
            try:
                doc = json.loads(fetch(CNYES_API % (cat, page)).decode('utf-8'))
            except Exception as e:                            # noqa: BLE001
                log(u'  鉅亨 %s 第 %d 頁失敗：%s' % (cat, page, str(e)[:70]))
                break
            for r in (doc.get('items') or {}).get('data') or []:
                # stock 欄位是 [{'code': '2330', ...}] 或直接是字串，兩種都出現過
                tagged = []
                for s in r.get('stock') or []:
                    code = s.get('code') if isinstance(s, dict) else s
                    if code:
                        tagged.append(str(code))
                out.append({
                    't': (r.get('title') or '').strip(),
                    'u': CNYES_LINK % r.get('newsId'),
                    's': u'鉅亨網',
                    'at': iso_from_epoch(r.get('publishAt')),
                    'codes': [c for c in tagged if c in codes],
                    'all': tagged,
                    'cat': label,
                })
    return out


def iso_from_epoch(v):
    try:
        return datetime.fromtimestamp(int(v), TPE).isoformat()
    except Exception:                                         # noqa: BLE001
        return None


def cna():
    u"""中央社財經 RSS。用正規表達式而不是 XML 解析器：只要四個欄位，
    而且 feedburner 偶爾回半形實體混雜的內容，寬鬆比嚴格好。"""
    try:
        raw = fetch(CNA_FEED).decode('utf-8', 'replace')
    except Exception as e:                                    # noqa: BLE001
        log(u'  中央社 RSS 失敗：%s' % str(e)[:70])
        return []
    out = []
    for block in re.findall(r'<item>(.*?)</item>', raw, re.S):
        def pick(tag):
            m = re.search(r'<%s>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</%s>' % (tag, tag),
                          block, re.S)
            return (m.group(1).strip() if m else '')
        title, link, pub = pick('title'), pick('link'), pick('pubDate')
        if not title or not link:
            continue
        out.append({
            't': unescape(title), 'u': link, 's': CNA_NAME,
            'at': iso_from_rfc822(pub), 'codes': [], 'all': [], 'cat': u'財經',
        })
    return out


def unescape(s):
    for a, b in (('&amp;', '&'), ('&lt;', '<'), ('&gt;', '>'),
                 ('&quot;', '"'), ('&#39;', "'"), ('&nbsp;', ' ')):
        s = s.replace(a, b)
    return s.strip()


def iso_from_rfc822(s):
    u"""'Thu, 17 Sep 2026 17:37:58 +0800' -> ISO。解不出來回 None 而不是猜。"""
    m = re.match(r'^[A-Za-z]{3},\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+'
                 r'(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?', s or '')
    if not m:
        return None
    months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    try:
        month = months.index(m.group(2)) + 1
    except ValueError:
        return None
    off = m.group(7) or '+0800'
    tz = timezone(timedelta(hours=int(off[:3]), minutes=int(off[0] + off[3:])))
    dt = datetime(int(m.group(3)), month, int(m.group(1)),
                  int(m.group(4)), int(m.group(5)), int(m.group(6)), tzinfo=tz)
    return dt.astimezone(TPE).isoformat()


# ── 重大訊息 ─────────────────────────────────────────────────

def roc_datetime(day, hms):
    u"""'1150916' + '70003' -> ISO。

    觀測站的時間欄位是不補零的「時分秒」串接（70003 = 07:00:03），
    所以要先補到六位再切，不能直接當數字讀。
    """
    day = (day or '').strip()
    if not re.match(r'^\d{6,7}$', day):
        return None
    year = int(day[:-4]) + 1911
    month, dayn = int(day[-4:-2]), int(day[-2:])
    hms = (hms or '').strip().zfill(6)
    try:
        dt = datetime(year, month, dayn, int(hms[:2]), int(hms[2:4]), int(hms[4:6]),
                      tzinfo=TPE)
    except ValueError:
        return None
    return dt.isoformat()


def filings(codes):
    u"""上市與上櫃的重大訊息。欄位名稱兩邊不一樣（櫃買用英文鍵），所以各自取。"""
    out = []
    for url, market, code_key, name_key, subject_key in (
            (TWSE_FILINGS, u'上市', u'公司代號', u'公司名稱', u'主旨 '),
            (TPEX_FILINGS, u'上櫃', 'SecuritiesCompanyCode', 'CompanyName', u'主旨')):
        try:
            rows = json.loads(fetch(url).decode('utf-8'))
        except Exception as e:                                # noqa: BLE001
            log(u'  %s重大訊息失敗：%s' % (market, str(e)[:70]))
            continue
        for r in rows:
            code = str(r.get(code_key, '')).strip()
            subject = (r.get(subject_key) or r.get(u'主旨') or '').strip()
            if not code or not subject:
                continue
            out.append({
                'code': code,
                'name': (r.get(name_key) or '').strip(),
                # 公告本文常有換行與全形空白，壓成一行前端才好排版
                'subject': re.sub(r'\s+', ' ', subject),
                'at': roc_datetime(r.get(u'發言日期'), r.get(u'發言時間')),
                'market': market,
                'clause': (r.get(u'符合條款') or '').strip(),
                'u': MOPS_LINK % code,
                'known': code in codes,
            })
    return out


def main():
    log(u'輸出：%s' % OUT)
    codes = tracked_codes()
    log(u'  站上追蹤 %d 個代號' % len(codes))

    log(u'鉅亨網台股新聞…')
    news = cnyes(codes)
    log(u'  %d 則' % len(news))

    log(u'中央社財經 RSS…')
    cna_rows = cna()
    log(u'  %d 則' % len(cna_rows))
    news += cna_rows

    # 去掉重複的連結，再依時間新到舊排。沒有時間的排最後 —— 寧可沉底也不要
    # 假裝它是最新的
    seen = set()
    uniq = []
    for r in news:
        if r['u'] in seen or not r['t']:
            continue
        seen.add(r['u'])
        uniq.append(r)
    uniq.sort(key=lambda r: r['at'] or '', reverse=True)
    news = uniq[:MAX_NEWS]

    log(u'公開資訊觀測站重大訊息…')
    fil = filings(codes)
    fil.sort(key=lambda r: r['at'] or '', reverse=True)
    log(u'  %d 筆（其中 %d 筆是站上追蹤的標的）'
        % (len(fil), sum(1 for r in fil if r['known'])))

    payload = {
        'meta': {
            'updated': datetime.now(TPE).isoformat(),
            'sources': [u'鉅亨網', CNA_NAME, u'公開資訊觀測站'],
            'note': (u'只收錄標題與連結，內文請點開到原站閱讀。'
                     u'重大訊息為證交所與櫃買公開資料，連結至公開資訊觀測站。'),
            'news': len(news),
            'filings': len(fil),
        },
        'news': news,
        'filings': fil,
    }
    write_json(OUT, payload)
    log(u'完成：%s（%.0f KB）' % (OUT, os.path.getsize(OUT) / 1024.0))


if __name__ == '__main__':
    main()
