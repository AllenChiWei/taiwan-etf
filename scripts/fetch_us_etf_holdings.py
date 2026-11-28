# -*- coding: utf-8 -*-
u"""美股 ETF 成分股抓取與驗證（Invesco 全部持股＋NEOS 前 25 大）。

    python scripts/fetch_us_etf_holdings.py [--only QQQ,QQQI] [--out PATH]
    python scripts/fetch_us_etf_holdings.py --verify [PATH]

寫到 app/public/data/us_etf_holdings.json，**只存最新、不累積**。

## 來源與節流（誠實 UA）

1. Invesco（QQQ、QQQM）：
   GET https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/{TICKER}/holdings/fund?idType=ticker&productType=ETF
   JSON 含 effectiveBusinessDate、totalNumberOfHoldings、holdings[]（ticker、issuerName、
   units、percentageOfTotalNetAssets、securityTypeName、cusip）。依 securityTypeName 只保留股票，
   basis='full'。

2. NEOS（QQQI、SPYI）：
   GET https://neosfunds.com/{ticker}/
   HTML 內嵌於 downloadHoldingsCSV('<TICKER>') 之後的第一個 <table>（Security Name | Identifier |
   Weighting (%)），僅公開前 25 大（basis='top25'），日期在 Data as of MM/DD/YYYY。
   排除名稱／代號含 Call、Put、Option、Cash、Treasury 等非股票列。
   robots.txt 指定 Crawl-delay: 10，連續請求間隔 >= 10.5 秒。

單檔失敗保留前一版該檔；不用較舊日期覆蓋較新日期。
"""
import argparse
import html as htmllib
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPTS_DIR)
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'us_etf_holdings.json')

TPE = timezone(timedelta(hours=8))
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; +https://allenchiwei.github.io/taiwan-etf/) '
      'US ETF holdings')
TIMEOUT = 30

# 可擴充對照表：美股 ETF 代號 -> 抓法設定（之後新增發行商直接在此補列）
US_ETF_SOURCES = {
    'QQQ': {'provider': 'invesco'},
    'QQQM': {'provider': 'invesco'},
    'QQQI': {'provider': 'neos'},
    'SPYI': {'provider': 'neos'},
}

PROVIDER_META = {
    'invesco': {
        'src': u'Invesco 官網',
        'basis': 'full',
        'delay': 1.5,
    },
    'neos': {
        'src': u'NEOS 官網',
        'basis': 'top25',
        # neosfunds.com robots.txt 指定 Crawl-delay: 10，保留緩衝避免踩線
        'delay': 10.5,
    },
}

INVESCO_URL = (
    'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/'
    '{ticker}/holdings/fund?idType=ticker&productType=ETF'
)
NEOS_URL = 'https://neosfunds.com/{ticker_lower}/'

VALID_BASIS = ('full', 'top25')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')

# Invesco securityTypeName 篩選：先排除非股票，再確認屬股票／ADR／REIT
_INVESCO_REJECT_TYPES = (
    'CASH', 'MONEY MARKET', 'TREASURY', 'BOND', 'DEBT', 'NOTE', 'BILL',
    'OPTION', 'CALL', 'PUT', 'FUTURE', 'FORWARD', 'SWAP', 'CURRENCY',
    'FX', 'WARRANT', 'RIGHT', 'ETF', 'FUND', 'SHORT TERM', 'REPO',
)
_INVESCO_STOCK_TYPES = (
    'STOCK', 'EQUITY', 'SHARE', 'ADR', 'ADS', 'DEPOSITARY', 'DEPOSITORY',
    'REIT', 'REGISTRY',
)

# NEOS 排除名稱或代號含選擇權、現金、美債的列
_NEOS_EXCLUDE_RE = re.compile(
    r'\b(?:calls?|puts?|options?|cash|treasur(?:y|ies)|t-?bills?|'
    r'money\s+market|futures?|swaps?|forwards?|currency|u\.?s\.?\s+dollar)\b',
    re.I,
)
_OPTION_SYMBOL_RE = re.compile(
    r'(?:\b\d{6}[CP]\d{5,8}\b|\b\d{1,2}/\d{1,2}/\d{2,4}\s+[CP]\d)',
    re.I,
)
_TREASURY_CUSIP_RE = re.compile(r'^912[0-9A-Z]{6}$')
_BAD_TICKERS = frozenset({'', '-', '--', 'N/A', 'NA', 'CASH', 'USD', 'OTHER'})


def _ensure_utf8_stdio():
    u"""Windows 本機預設 cp950 印不出符號，執行時安全切換為 UTF-8（不影響 Linux CI）。"""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            try:
                stream.reconfigure(encoding='utf-8', errors='replace')
            except Exception:  # noqa: BLE001
                pass


def log(msg, stream=None):
    out = stream or sys.stdout
    try:
        print(msg, file=out, flush=True)
    except UnicodeEncodeError:
        enc = getattr(out, 'encoding', None) or 'ascii'
        print(str(msg).encode(enc, 'replace').decode(enc, 'replace'), file=out, flush=True)


def _strip_tags(raw):
    text = re.sub(r'<[^>]+>', ' ', raw or '')
    return re.sub(r'\s+', ' ', htmllib.unescape(text)).strip()


def norm_date(value):
    u"""將 YYYY-MM-DD、YYYY/MM/DD、YYYYMMDD 或 MM/DD/YYYY 轉為 YYYY-MM-DD。"""
    s = str(value or '').strip()
    if not s:
        return None
    m = re.match(r'^(\d{4})[/-](\d{1,2})[/-](\d{1,2})', s)
    if m:
        yr, mo, dy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= dy <= 31:
            return '%04d-%02d-%02d' % (yr, mo, dy)
    m = re.match(r'^(\d{4})(\d{2})(\d{2})$', s)
    if m:
        yr, mo, dy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= dy <= 31:
            return '%04d-%02d-%02d' % (yr, mo, dy)
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', s)
    if m:
        mo, dy, yr = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= dy <= 31:
            return '%04d-%02d-%02d' % (yr, mo, dy)
    return None


def norm_us_ticker(raw):
    u"""正規化美股成分代號（去空白、大寫，將 BRK/B、BRK-B、BRK B 統一為 BRK.B）。"""
    s = re.sub(r'\s+', ' ', str(raw or '').strip()).upper()
    if not s or s in _BAD_TICKERS:
        return ''
    s = s.replace('/', '.')
    m = re.match(r'^([A-Z0-9]{1,5})[\s-]([A-Z])$', s)
    if m:
        s = '%s.%s' % (m.group(1), m.group(2))
    if s in _BAD_TICKERS:
        return ''
    return s


def _parse_weight(value):
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).replace(',', '').replace('%', '').strip()
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def normalize_rows(rows):
    u"""合併同代號列、排除無效代號與權重 <= 0，依權重由大到小排序 -> [[代號, 名稱, 權重%], ...]。"""
    merged = {}
    for item in rows or []:
        if not item or len(item) < 3:
            continue
        ticker = norm_us_ticker(item[0])
        name = re.sub(r'\s+', ' ', str(item[1] or '').strip())
        w = _parse_weight(item[2])
        if not ticker or not (0 < w <= 100):
            continue
        if ticker in merged:
            prev = merged[ticker]
            if name and (not prev[1] or len(name) < len(prev[1])):
                prev[1] = name
            prev[2] = round(prev[2] + w, 3)
        else:
            merged[ticker] = [ticker, name or ticker, round(w, 3)]
    out = list(merged.values())
    out.sort(key=lambda r: (-r[2], r[0]))
    return out


# ── Invesco（JSON）純解析 ─────────────────────────────────────────

def is_invesco_stock_type(security_type_name):
    u"""判斷 Invesco securityTypeName 是否為股票類（含 Common Stock、ADR、Ordinary Shares）。"""
    s = re.sub(r'\s+', ' ', str(security_type_name or '').strip()).upper()
    if not s:
        return False
    if any(bad in s for bad in _INVESCO_REJECT_TYPES):
        return False
    return any(ok in s for ok in _INVESCO_STOCK_TYPES)


def parse_invesco(data):
    u"""解析 Invesco holdings/fund JSON，回傳 (asof, rows)。"""
    if not isinstance(data, dict):
        return None, []
    body = data.get('data') if (isinstance(data.get('data'), dict) and 'holdings' not in data) else data
    if not isinstance(body, dict):
        return None, []
    asof = norm_date(body.get('effectiveBusinessDate'))
    raw_holdings = body.get('holdings')
    if not isinstance(raw_holdings, list):
        return asof, []

    rows = []
    for h in raw_holdings:
        if not isinstance(h, dict):
            continue
        if not is_invesco_stock_type(h.get('securityTypeName')):
            continue
        ticker = norm_us_ticker(h.get('ticker'))
        if not ticker or _TREASURY_CUSIP_RE.match(ticker) or _OPTION_SYMBOL_RE.search(ticker):
            continue
        name = str(h.get('issuerName') or '').strip()
        w = _parse_weight(h.get('percentageOfTotalNetAssets'))
        if w > 0:
            rows.append([ticker, name, w])
    return asof, normalize_rows(rows)


# ── NEOS（HTML）純解析 ────────────────────────────────────────────

def is_neos_stock_row(name, ticker):
    u"""NEOS 排除名稱或代號含 Call／Put／Option／Cash／Treasury 與選擇權代碼的列。"""
    n = str(name or '').strip()
    t = str(ticker or '').strip()
    if not t or t.upper() in _BAD_TICKERS:
        return False
    if _NEOS_EXCLUDE_RE.search(n) or _NEOS_EXCLUDE_RE.search(t):
        return False
    if _OPTION_SYMBOL_RE.search(n) or _OPTION_SYMBOL_RE.search(t):
        return False
    if _TREASURY_CUSIP_RE.match(t.upper()):
        return False
    return True


def _extract_neos_date(text):
    plain = _strip_tags(text)
    matches = re.findall(r'Data\s+as\s+of\s*:?\s*(\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2})', plain, re.I)
    if not matches:
        return None
    return norm_date(matches[0])


def _extract_neos_date_last(text):
    plain = _strip_tags(text)
    matches = re.findall(r'Data\s+as\s+of\s*:?\s*(\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2})', plain, re.I)
    if not matches:
        return None
    return norm_date(matches[-1])


def _table_rows(table_html):
    out = []
    for tr in re.findall(r'<tr\b[^>]*>(.*?)</tr>', table_html or '', re.S | re.I):
        cells = [_strip_tags(td) for td in re.findall(r'<t[hd]\b[^>]*>(.*?)</t[hd]>', tr, re.S | re.I)]
        if cells:
            out.append(cells)
    return out


def parse_neos_html(page):
    u"""解析 NEOS 基金頁 HTML（downloadHoldingsCSV 之後的第一個 <table>），回傳 (asof, rows)。"""
    if not isinstance(page, str) or not page:
        return None, []

    anchor = re.search(r'downloadHoldingsCSV\s*\(', page, re.I)
    table_match = None
    if anchor:
        table_match = re.search(r'<table\b[^>]*>.*?</table>', page[anchor.start():], re.S | re.I)
        table_start = anchor.start() + table_match.start() if table_match else None
        table_end = anchor.start() + table_match.end() if table_match else None
    else:
        table_start = None
        table_end = None
        for m in re.finditer(r'<table\b[^>]*>.*?</table>', page, re.S | re.I):
            low = m.group(0).lower()
            if 'security name' in low and 'identifier' in low and 'weight' in low:
                table_match = m
                table_start = m.start()
                table_end = m.end()
                break

    if not table_match:
        return None, []

    # 優先從持股區塊附近取 Data as of MM/DD/YYYY，避免誤取頁面上其他績效區塊的日期
    asof = None
    if anchor and table_end is not None:
        asof = _extract_neos_date(page[anchor.start():table_end])
        if not asof:
            asof = _extract_neos_date_last(page[max(0, anchor.start() - 2000):anchor.start()])
        if not asof:
            asof = _extract_neos_date(page[table_end:table_end + 1500])
    elif table_start is not None and table_end is not None:
        asof = (_extract_neos_date_last(page[max(0, table_start - 2000):table_start])
                or _extract_neos_date(page[table_end:table_end + 1500]))
    if not asof:
        asof = _extract_neos_date(page)

    trs = _table_rows(table_match.group(0))
    if not trs:
        return asof, []

    name_idx, id_idx, weight_idx = 0, 1, 2
    header_row = None
    for row in trs:
        low = [c.lower() for c in row]
        if any('security' in c or 'name' in c for c in low) and any('weight' in c or '%' in c for c in low):
            header_row = row
            for i, c in enumerate(low):
                if 'security' in c or ('name' in c and 'identifier' not in c):
                    name_idx = i
                elif 'identifier' in c or 'ticker' in c or 'symbol' in c:
                    id_idx = i
                elif 'weight' in c or '%' in c:
                    weight_idx = i
            break

    rows = []
    need_len = max(name_idx, id_idx, weight_idx) + 1
    for row in trs:
        if row is header_row or len(row) < need_len:
            continue
        sec_name = row[name_idx].strip()
        ident = row[id_idx].strip()
        w_raw = row[weight_idx].strip()
        if sec_name.lower() in ('security name', 'total', 'subtotal'):
            continue
        if not is_neos_stock_row(sec_name, ident):
            continue
        ticker = norm_us_ticker(ident)
        w = _parse_weight(w_raw)
        if ticker and w > 0:
            rows.append([ticker, sec_name, w])

    return asof, normalize_rows(rows)


# ── 合併與驗證 ────────────────────────────────────────────────────

def merge_entry(prev_entry, new_entry):
    u"""合併單檔新舊資料：新抓失敗或為空保留舊版；不以較舊日期覆蓋較新日期。"""
    if not new_entry or not new_entry.get('rows') or not new_entry.get('asof'):
        return prev_entry
    if not prev_entry or not prev_entry.get('rows'):
        return new_entry
    if str(new_entry.get('asof') or '') < str(prev_entry.get('asof') or ''):
        return prev_entry
    return new_entry


def verify_doc(doc):
    u"""輕量驗證 us_etf_holdings.json，回傳 (errors, warnings)。

    規則：
    - 頂層含 meta、etfs，每檔格式與權重範圍合法。
    - QQQ 必須存在、basis='full'、>= 90 檔、權重合計 95%～101%。
    - 其餘 full 檔至少 50 檔且合計 80%～105%；top25 檔 10～30 檔且合計 15%～101%。
    """
    errors, warnings = [], []
    if not isinstance(doc, dict) or not isinstance(doc.get('meta'), dict) or not isinstance(doc.get('etfs'), dict):
        return [u'頂層缺少 meta 或 etfs 物件'], warnings
    etfs = doc['etfs']
    if not etfs:
        return [u'etfs 為空'], warnings

    for code, entry in etfs.items():
        if not isinstance(entry, dict):
            errors.append(u'%s：資料不是物件' % code)
            continue
        asof = str(entry.get('asof') or '')
        src = str(entry.get('src') or '').strip()
        basis = entry.get('basis')
        rows = entry.get('rows')
        if not DATE_RE.match(asof):
            errors.append(u'%s：asof 格式不正確（%r）' % (code, asof))
        if not src:
            errors.append(u'%s：缺少 src' % code)
        if basis not in VALID_BASIS:
            errors.append(u'%s：無效的 basis=%r' % (code, basis))
            continue
        if not isinstance(rows, list) or not rows:
            errors.append(u'%s：rows 為空' % code)
            continue

        total_w = 0.0
        bad = False
        for r in rows:
            if not isinstance(r, list) or len(r) < 3 or not str(r[0]).strip():
                errors.append(u'%s：rows 列格式錯誤 %r' % (code, r))
                bad = True
                break
            w = r[2]
            if not isinstance(w, (int, float)) or not (0 < float(w) <= 100):
                errors.append(u'%s %s：權重異常（%r）' % (code, r[0], w))
                bad = True
                break
            total_w += float(w)
        if bad:
            continue

        if code == 'QQQ':
            if basis != 'full':
                errors.append(u'QQQ 的 basis 應為 full，實際為 %r' % basis)
            if len(rows) < 90:
                errors.append(u'QQQ 成分股過少（%d 檔，需 >= 90 檔）' % len(rows))
            if not (95.0 <= total_w <= 101.0):
                errors.append(u'QQQ 權重合計 %.2f%% 超出 95%%～101%%' % total_w)
        elif basis == 'full':
            if len(rows) < 50:
                errors.append(u'%s（full）：成分股過少（%d 檔）' % (code, len(rows)))
            if not (80.0 <= total_w <= 105.0):
                errors.append(u'%s（full）：權重合計 %.2f%% 超出 80%%～105%%' % (code, total_w))
        elif basis == 'top25':
            if not (10 <= len(rows) <= 30):
                errors.append(u'%s（top25）：成分股檔數異常（%d 檔，預期 10～30 檔）' % (code, len(rows)))
            if not (15.0 <= total_w <= 101.0):
                errors.append(u'%s（top25）：權重合計 %.2f%% 超出 15%%～101%%' % (code, total_w))

    if 'QQQ' not in etfs:
        errors.append(u'缺少 QQQ 持股資料')

    missing_targets = [c for c in US_ETF_SOURCES if c not in etfs]
    if missing_targets:
        warnings.append(u'尚未收錄設定清單中的標的：%s' % ','.join(missing_targets))

    return errors, warnings


# ── HTTP 抓取與節流 ───────────────────────────────────────────────

class ThrottledClient(object):
    u"""依發行商各自節流（NEOS 依 robots.txt Crawl-delay >= 10 秒）並使用誠實 UA。"""

    def __init__(self, opener=None, sleep_fn=time.sleep, clock_fn=time.monotonic):
        self.opener = opener or urllib.request.build_opener()
        self.sleep_fn = sleep_fn
        self.clock_fn = clock_fn
        self.last_at = {}

    def _wait(self, provider):
        delay = PROVIDER_META[provider]['delay']
        prev = self.last_at.get(provider)
        if prev is not None:
            elapsed = self.clock_fn() - prev
            if elapsed < delay:
                self.sleep_fn(delay - elapsed)

    def fetch_text(self, provider, url, accept):
        self._wait(provider)
        req = urllib.request.Request(url, headers={
            'User-Agent': UA,
            'Accept': accept,
            'Accept-Language': 'en-US,en;q=0.9',
        })
        try:
            raw = self.opener.open(req, timeout=TIMEOUT).read()
            return raw.decode('utf-8', 'replace')
        finally:
            self.last_at[provider] = self.clock_fn()


def fetch_one(ticker, spec, client):
    u"""抓取單一美股 ETF 持股，回傳 entry dict 或 None。"""
    provider = spec['provider']
    meta = PROVIDER_META[provider]
    if provider == 'invesco':
        url = INVESCO_URL.format(ticker=ticker)
        text = client.fetch_text(provider, url, 'application/json, */*;q=0.8')
        data = json.loads(text)
        asof, rows = parse_invesco(data)
    elif provider == 'neos':
        url = NEOS_URL.format(ticker_lower=ticker.lower())
        html_text = client.fetch_text(provider, url, 'text/html,application/xhtml+xml,*/*;q=0.8')
        asof, rows = parse_neos_html(html_text)
    else:
        raise ValueError(u'不支援的 provider: %s' % provider)

    if not asof or not rows:
        return None
    return {
        'asof': asof,
        'src': meta['src'],
        'basis': meta['basis'],
        'rows': rows,
    }


def run_fetch(out_path=OUT, only=None, client=None, today_iso=None):
    u"""執行全部（或指定）美股 ETF 抓取並寫檔，回傳 (ok_count, errors, payload)。"""
    prev_doc = {}
    errors = []
    if os.path.exists(out_path):
        try:
            prev_doc = json.load(io.open(out_path, encoding='utf-8'))
        except Exception as e:  # noqa: BLE001
            errors.append(u'既有 us_etf_holdings.json 讀取失敗（%s），本次重建' % str(e)[:60])
    etfs_out = dict(prev_doc.get('etfs') or {})

    only_set = set(x.strip().upper() for x in only if x.strip()) if only else None
    targets = [(c, spec) for c, spec in US_ETF_SOURCES.items()
               if not only_set or c in only_set]

    http = client or ThrottledClient()
    ok_count = 0

    for ticker, spec in targets:
        provider = spec['provider']
        src_name = PROVIDER_META[provider]['src']
        try:
            entry = fetch_one(ticker, spec, http)
        except Exception as e:  # noqa: BLE001
            msg = u'%s（%s）：%s（保留前一版）' % (ticker, src_name, str(e)[:100])
            log(u'  ⚠ %s' % msg)
            errors.append(msg)
            continue

        if not entry:
            msg = u'%s（%s）：查無有效持股（保留前一版）' % (ticker, src_name)
            log(u'  ⚠ %s' % msg)
            errors.append(msg)
            continue

        merged = merge_entry(etfs_out.get(ticker), entry)
        etfs_out[ticker] = merged
        ok_count += 1
        tot_w = sum(r[2] for r in merged['rows'])
        log(u'  %-5s %-12s %s %3d 檔 合計 %5.1f%%（%s）' % (
            ticker, src_name, merged['asof'], len(merged['rows']), tot_w, merged['basis']))

    payload = {
        'meta': {
            'updated': today_iso or datetime.now(TPE).date().isoformat(),
            'count': len(etfs_out),
            'source': u'Invesco 官網（QQQ、QQQM 全部持股）與 NEOS 官網（QQQI、SPYI 前 25 大持股）',
            'errors': errors,
        },
        'etfs': dict(sorted(etfs_out.items())),
    }

    if etfs_out:
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with io.open(out_path, 'w', encoding='utf-8') as fh:
            fh.write(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
        log(u'完成：%s（共 %d 檔、本次成功 %d/%d 檔、%.1f KB）' % (
            out_path, len(etfs_out), ok_count, len(targets), os.path.getsize(out_path) / 1024.0))
    return ok_count, errors, payload


def main(argv=None):
    _ensure_utf8_stdio()
    ap = argparse.ArgumentParser(description=u'抓取或驗證美股 ETF 持股（Invesco／NEOS）')
    ap.add_argument('--out', default=OUT, help=u'輸出 JSON 路徑')
    ap.add_argument('--only', default='', help=u'只抓指定美股 ETF 代號，逗號分隔（例 QQQ,QQQI）')
    ap.add_argument('--verify', nargs='?', const=OUT, default=None,
                    help=u'只驗證指定 us_etf_holdings.json（不發網路請求）')
    args = ap.parse_args(argv)

    if args.verify is not None:
        path = args.verify
        if not os.path.exists(path):
            log(u'找不到檔案：%s' % path, sys.stderr)
            return 1
        doc = json.load(io.open(path, encoding='utf-8'))
        errs, warns = verify_doc(doc)
        for w in warns:
            log(u'  ⚠ %s' % w)
        for e in errs:
            log(u'  ✗ %s' % e, sys.stderr)
        etfs = doc.get('etfs') or {}
        summary = u'、'.join(
            u'%s(%d檔/%.1f%%)' % (c, len(v.get('rows') or []), sum(r[2] for r in (v.get('rows') or [])))
            for c, v in sorted(etfs.items()) if isinstance(v, dict)
        )
        log(u'%s：%d 檔［%s］' % (u'OK' if not errs else u'FAIL', len(etfs), summary))
        return 0 if not errs else 1

    only = [x.strip() for x in args.only.split(',') if x.strip()] if args.only else None
    ok_count, _, payload = run_fetch(out_path=args.out, only=only)
    if not payload['etfs'] or ok_count == 0:
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
