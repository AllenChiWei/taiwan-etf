# -*- coding: utf-8 -*-
u"""美股個股清單（部署時產生，不進版控）。

    python scripts/fetch_us_stocks.py [outfile]

預設寫到 app/public/data/us_stocks.json，供配息試算搜尋美股個股（如 ANT）用。
前端僅在使用者開始搜尋或已持有美股個股時才載入；缺檔時仍可透過直接輸入美股代號查詢 FinMind。

## 來源與篩選

FinMind `USStockInfo`（不帶 data_id，單一請求即回傳全市場清單，免費層可用；有設定
FINMIND_TOKEN 時一併帶上）：
- 只取最新 `date` 那批（避免已下市或舊快照混入）
- 排除 `Subsector` 為 ETF／Blank Checks（SPAC）／n/a 或空值
- 市值（MarketCap）>= 3 億美元（3e8）
- 名稱去掉尾端的 Common Stock／Ordinary Shares 等證券型態贅字（保留 Class A 等股份類別）
- 依市值由大到小排序，輸出精簡陣列 [代號, 名稱, 市值(美元)]

## 容錯

部署流程掛 `continue-on-error: true`：抓取失敗或筆數異常偏低時回傳非零且不寫入壞檔，
不阻擋網站部署。
"""
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else os.path.join(
    ROOT, 'app', 'public', 'data', 'us_stocks.json')

TPE = timezone(timedelta(hours=8))
API = 'https://api.finmindtrade.com/api/v4/data'
TOKEN = os.environ.get('FINMIND_TOKEN', '').strip()
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) US stock directory')
TIMEOUT = 90
MIN_MCAP = 300_000_000          # 3 億美元
MIN_STOCKS = 100                # 少於此數多半是來源異常，不寫出壞檔

EXCLUDED_SUBSECTORS = frozenset(['', 'etf', 'blank checks', 'n/a', 'na', 'none', 'null'])

# 尾端補充說明（ADR 換算比例、票面價值等）
TAIL_EXTRA_RE = re.compile(
    r'(?:,?\s*\(\s*(?:each\s+)?representing\b[^)]*\)'
    r'|,?\s+(?:each\s+)?representing\b.*'
    r'|,?\s*\$\s*[\d.]+\s+par\s+value\b.*)$',
    re.IGNORECASE,
)

# 尾端常見證券型態字眼（保留前面的 Class A / Class B 等類別名稱）
SUFFIX_RE = re.compile(
    r'(?:\s*[-–,]\s*|\s+)(?:'
    r'(?:Non-Voting\s+|Voting\s+)?Common\s+Stocks?'
    r'|Common\s+Shares?'
    r'|Ordinary\s+Shares?'
    r'|Capital\s+Stocks?'
    r'|American\s+Depositary\s+(?:Shares?|Receipts?)'
    r'|Depositary\s+Shares?'
    r'|New\s+York\s+Registry\s+Shares?'
    r'|Shares\s+of\s+Beneficial\s+Interest'
    r'|Common\s+Limited\s+Partner(?:ship)?\s+Units?'
    r'|Limited\s+Partnership\s+Units?'
    r'|Common\s+Units?'
    r')\.?$',
    re.IGNORECASE,
)


def log(m):
    print(m, flush=True)


def parse_mcap(v):
    u"""解析 MarketCap 欄位為浮點數（美元）；無效或負值回 0.0。"""
    if v is None or isinstance(v, bool):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v) if v > 0 else 0.0
    s = str(v).replace(',', '').replace('$', '').strip()
    if not s:
        return 0.0
    try:
        x = float(s)
        return x if x > 0 else 0.0
    except ValueError:
        return 0.0


def clean_name(name):
    u"""去掉美股名稱尾端的 Common Stock／Ordinary Shares 等贅字，保留 Class A 等類別。"""
    raw = re.sub(r'\s+', ' ', str(name or '').strip())
    if not raw:
        return ''
    s = TAIL_EXTRA_RE.sub('', raw).strip(' ,;-–')
    # 最多剝三層，處理像 "Ordinary Shares" 後面又掛說明或雙重尾綴的情況
    for _ in range(3):
        nxt = SUFFIX_RE.sub('', s).strip(' ,;-–')
        if nxt == s:
            break
        s = nxt
    s = re.sub(r'\s+', ' ', s).strip(' ,;-–')
    return s or raw


def build_stocks(rows, min_mcap=MIN_MCAP):
    u"""純函式：從 USStockInfo 原始列篩出最新日期的美股個股，回傳 (asof, [[code, name, mcap], ...])。"""
    dates = [str(r.get('date') or '').strip() for r in rows if r.get('date')]
    if not dates:
        return '', []
    latest_date = max(dates)

    by_code = {}
    for r in rows:
        if str(r.get('date') or '').strip() != latest_date:
            continue
        sub = str(r.get('Subsector') or '').strip().lower()
        if sub in EXCLUDED_SUBSECTORS:
            continue
        code = str(r.get('stock_id') or '').strip().upper()
        if not code:
            continue
        mcap = parse_mcap(r.get('MarketCap'))
        if mcap < min_mcap:
            continue
        name = clean_name(r.get('stock_name')) or code
        prev = by_code.get(code)
        if prev is None or mcap > prev[2]:
            by_code[code] = [code, name, int(round(mcap))]

    stocks = sorted(by_code.values(), key=lambda x: (-x[2], x[0]))
    return latest_date, stocks


def fetch_us_stock_info(tries=3):
    u"""向 FinMind 抓取 USStockInfo 全市場資料。使用系統預設驗證之 SSL 憑證。"""
    params = {'dataset': 'USStockInfo'}
    if TOKEN:
        params['token'] = TOKEN
    url = API + '?' + urllib.parse.urlencode(params)
    last = None
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': UA,
                'Accept': 'application/json',
            })
            raw = urllib.request.urlopen(req, timeout=TIMEOUT).read()
            doc = json.loads(raw.decode('utf-8'))
            if doc.get('msg') != 'success':
                raise RuntimeError(u'FinMind 回應不是 success：%s' % str(doc.get('msg'))[:80])
            return doc.get('data') or []
        except urllib.error.HTTPError as e:
            if e.code == 402:
                raise RuntimeError(u'FinMind 每小時額度已達上限（HTTP 402）')
            last = e
        except Exception as e:                                # noqa: BLE001
            last = e
        if attempt < tries:
            log(u'  第 %d 次抓取失敗（%s），稍後重試' % (attempt, str(last)[:80]))
            time.sleep(3 * attempt)
    raise last


def main():
    log(u'美股個股清單：抓取 FinMind USStockInfo')
    try:
        rows = fetch_us_stock_info()
    except Exception as e:                                    # noqa: BLE001
        log(u'  ⚠ 抓取失敗：%s' % str(e)[:120])
        return 1

    asof, stocks = build_stocks(rows)
    log(u'  原始 %d 列，最新日期 %s，篩選後 %d 檔（市值 >= %d 美元）' % (
        len(rows), asof or u'—', len(stocks), MIN_MCAP))
    if len(stocks) < MIN_STOCKS:
        log(u'  ⚠ 篩選結果過少（%d < %d），不寫出檔案' % (len(stocks), MIN_STOCKS))
        return 1

    payload = {
        'meta': {
            'updated': datetime.now(TPE).date().isoformat(),
            'asof': asof,
            'count': len(stocks),
            'minMarketCap': MIN_MCAP,
            'source': 'FinMind USStockInfo',
        },
        'stocks': stocks,
    }
    d = os.path.dirname(OUT)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    log(u'完成：%s（%d 檔，%.1f KB）' % (OUT, len(stocks), os.path.getsize(OUT) / 1024.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
