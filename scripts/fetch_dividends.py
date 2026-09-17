# -*- coding: utf-8 -*-
u"""交易所官方的 ETF 除息金額。

    python scripts/fetch_dividends.py [outfile] [--from-year 2019]

預設寫到 app/public/data/dividends.json：

    {"meta": {...}, "dividends": {"00406A": [["2026-07-31", 0.128], ...]}}

## 為什麼需要這支 —— 回推的精度在來源端就沒了

原本 ETF 的配息是從還原股價與原始收盤價的比值回推的（見 fetch_calc.py）。
那個方法能算出是哪一天除息、大致配多少，但**金額只準到「分」**：

    00406A 2026-09-02　官方配息 0.138000
                       前收 9.96，9.96 − 0.138 = 9.822
                       但除權息參考價依最小跳動單位取整成 9.82
                       還原股價按參考價調整 -> 回推得到 9.96 − 9.82 = 0.14

那 0.002 在資料進到本專案之前就消失了。單價低、配息小的標的影響最明顯：
0.138 被算成 0.14 是 1.4% 的誤差，乘上一年十二次就會讓年配息估錯。

使用者實際回報了這個差異，所以改用交易所公告的原始數字。

## 兩個交易所，兩種涵蓋範圍

**證交所（上市）** `exchangeReport/TWT49U`
查詢參數是 `startDate` / `endDate`（不是 `strDate`，那個會回「結束日期不能小於
開始日期」的錯誤訊息，很容易誤判成日期格式不對）。可以一次查一整年，
金額欄位「權值+息值」給到小數第六位。

**櫃買（上櫃）** `exright/dailyquo/exDailyQ_result.php`
只回傳「當前的除息清單」—— 帶 d=115/08 或 d=115/09/02 都一樣回最新那天，
參數是被忽略的。所以拿不到歷史，只能每天抓一次慢慢累積。

因此債券 ETF（00679B 這類在櫃買掛牌的）短期內仍要靠 fetch_calc.py 的回推值。
2026 年有配息的 202 檔裡，證交所涵蓋 100 檔。

## 累積式

產出的檔案會進版控，每次執行是「合併」而不是「重寫」：證交所補歷史，
櫃買補當天。已經有官方數字的紀錄不會被覆蓋掉。
"""
import io
import json
import os
import sys
import time
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'dividends.json')

TWSE_URL = ('https://www.twse.com.tw/exchangeReport/TWT49U'
            '?response=json&startDate=%s&endDate=%s')
TPEX_URL = ('https://www.tpex.org.tw/web/stock/exright/dailyquo/exDailyQ_result.php'
            '?l=zh-tw')
# 上市公司股利分派情形。除權息計算結果表把「權值+息值」合併計價，拆不出現金部分；
# 這張表把現金股利與股票股利分開列，但只涵蓋最近一次宣告。
DECLARED_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap45_L'

UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) ETF dividend amounts')

DELAY = 2.0
TIMEOUT = 40
FROM_YEAR = 2019

args = [a for a in sys.argv[1:] if not a.startswith('--')]
if args:
    OUT = args[0]
for a in sys.argv[1:]:
    if a.startswith('--from-year'):
        FROM_YEAR = int(a.split('=')[1]) if '=' in a else FROM_YEAR


def log(m):
    print(m, flush=True)


def fetch_json(url):
    try:
        from urllib.request import Request, urlopen
    except ImportError:
        from urllib2 import Request, urlopen          # noqa
    req = Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    raw = urlopen(req, timeout=TIMEOUT).read()
    return json.loads(raw.decode('utf-8', 'replace'))


def to_float(s):
    try:
        return float(str(s).replace(',', '').strip())
    except (TypeError, ValueError):
        return None


def roc_to_iso(s):
    u"""'115年08月03日' 或 '115/09/17' -> '2026-08-03'。"""
    t = str(s).strip()
    digits = [d for d in t.replace(u'年', '/').replace(u'月', '/')
                        .replace(u'日', '').split('/') if d.strip()]
    if len(digits) != 3:
        return None
    try:
        y, m, d = (int(x) for x in digits)
    except ValueError:
        return None
    if y < 1911:
        y += 1911
    return '%04d-%02d-%02d' % (y, m, d)


# 除權息的種類。ETF 一律是「息」，個股才會有另外兩種。
KIND_CASH = 'cash'      # 息 —— 純現金股利
KIND_STOCK = 'stock'    # 權 —— 純股票股利，一毛現金都沒有
KIND_BOTH = 'both'      # 權息 —— 兩者都有，而「權值+息值」是合併計價的

KIND_MAP = {u'息': KIND_CASH, u'權': KIND_STOCK, u'權息': KIND_BOTH}


def fetch_twse(year):
    u"""一整年的除權息計算結果表。回傳 [(code, iso_date, amount, kind)]。

    「權/息」這一欄是關鍵：富邦金七月是「息」、九月是「權」（股票股利），
    把兩者都當成配息會讓它看起來是半年配，年現金收入也會被灌水。
    """
    url = TWSE_URL % ('%d0101' % year, '%d1231' % year)
    doc = fetch_json(url)
    if doc.get('stat') != 'OK':
        log(u'  %d 年：%s' % (year, str(doc.get('stat'))[:60]))
        return []
    fields = doc.get('fields') or []
    try:
        i_date = fields.index(u'資料日期')
        i_code = fields.index(u'股票代號')
        i_amt = fields.index(u'權值+息值')
        i_kind = fields.index(u'權/息')
    except ValueError:
        log(u'  %d 年：欄位名稱變了 -> %s' % (year, fields[:6]))
        return []

    out = []
    for r in doc.get('data') or []:
        iso = roc_to_iso(r[i_date])
        amt = to_float(r[i_amt])
        kind = KIND_MAP.get(str(r[i_kind]).strip())
        if iso and amt is not None and amt > 0 and kind:
            out.append((str(r[i_code]).strip(), iso, amt, kind))
    return out


def fetch_declared():
    u"""最近一次宣告的每股現金股利 {代號: 金額}。

    盈餘分配的現金股利加上法定盈餘公積／資本公積發放的現金 —— 兩者都是
    真的會匯進帳戶的錢，股票股利則不是。
    """
    rows = fetch_json(DECLARED_URL)
    k_code = u'公司代號'
    k_cash = u'股東配發-盈餘分配之現金股利(元/股)'
    k_cap = u'股東配發-法定盈餘公積、資本公積發放之現金(元/股)'
    out = {}
    for r in rows if isinstance(rows, list) else []:
        code = str(r.get(k_code, '')).strip()
        if not code:
            continue
        cash = (to_float(r.get(k_cash)) or 0.0) + (to_float(r.get(k_cap)) or 0.0)
        if cash > 0:
            # 同一檔可能有多筆（台積電按季），取最大的那筆當「最近一次的水準」
            out[code] = max(out.get(code, 0.0), cash)
    return out


def fetch_tpex():
    u"""櫃買當前的除息清單。只有今天，拿不到歷史。"""
    doc = fetch_json(TPEX_URL)
    tables = doc.get('tables') or []
    if not tables:
        return []
    tb = tables[0]
    fields = tb.get('fields') or []
    try:
        i_date = fields.index(u'除權息日期')
        i_code = fields.index(u'代號')
        i_amt = fields.index(u'現金股利')
    except ValueError:
        log(u'  櫃買：欄位名稱變了 -> %s' % fields[:6])
        return []

    out = []
    for r in tb.get('data') or []:
        iso = roc_to_iso(r[i_date])
        amt = to_float(r[i_amt])
        # 櫃買這張表的「現金股利」欄位本來就只有現金，所以一律算 cash
        if iso and amt is not None and amt > 0:
            out.append((str(r[i_code]).strip(), iso, amt, KIND_CASH))
    return out


def load_stock_only(path):
    if not os.path.exists(path):
        return {}
    try:
        doc = json.load(io.open(path, encoding='utf-8'))
        return doc.get('stockOnly') or {}
    except Exception:                                  # noqa: BLE001
        return {}


def load_existing(path):
    if not os.path.exists(path):
        return {}
    try:
        doc = json.load(io.open(path, encoding='utf-8'))
        return doc.get('dividends') or {}
    except Exception:                                  # noqa: BLE001
        return {}


def main():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from etfdata import EXTRA_STOCKS

    etfs = json.load(io.open(
        os.path.join(ROOT, 'app', 'public', 'data', 'etfs.json'), encoding='utf-8'))
    codes = set(e['code'] for e in etfs['etfs'])
    # 證交所那張表本來就涵蓋所有上市證券，個股不必另外抓，只要別過濾掉
    codes |= set(EXTRA_STOCKS)
    log(u'名單裡有 %d 檔 ETF，另加 %d 檔個股' % (len(etfs['etfs']), len(EXTRA_STOCKS)))

    merged = load_existing(OUT)
    before = sum(len(v) for v in merged.values())
    log(u'既有紀錄 %d 筆（%d 檔）' % (before, len(merged)))

    log(u'')
    log(u'最近一次宣告的現金股利（用來拆開「權息」）：')
    try:
        declared = fetch_declared()
        log(u'  %d 檔' % len(declared))
    except Exception as e:                             # noqa: BLE001
        declared = {}
        log(u'  抓取失敗（略過，權息會標成約略）：%s' % str(e)[:60])
    time.sleep(DELAY)

    this_year = date.today().year
    added = 0

    skipped_stock = 0
    split_both = 0
    # 既有檔案裡的也要留著，否則重跑時舊年度的排除清單會消失
    stock_only = dict((k, set(v)) for k, v in load_stock_only(OUT).items())

    log(u'')
    log(u'證交所（上市）：')
    for year in range(FROM_YEAR, this_year + 1):
        rows = fetch_twse(year)
        n = 0
        for code, iso, amt, kind in rows:
            if code not in codes:
                continue
            # 純股票股利不是現金，不進配息紀錄。但**日期要留下來** ——
            # 股票股利一樣會讓還原股價跳動，fetch_calc 的回推會把它當成配息。
            # 不明確告訴下游「這天不是配息」，富邦金九月的股票股利就會變成
            # 一筆兩塊多的假現金股利。
            if kind == KIND_STOCK:
                stock_only.setdefault(code, set()).add(iso)
                skipped_stock += 1
                continue
            # 「權值+息值」是合併計價的，從這張表拆不出現金部分。先照原樣收下並
            # 標成不精確，稍後再用宣告的現金股利去修正**最近那一筆** ——
            # 宣告表只涵蓋最近一次，套到歷年每一筆會讓每年都變成同一個數字。
            exact = kind != KIND_BOTH
            lst = merged.setdefault(code, [])
            if any(r[0] == iso for r in lst):
                continue
            lst.append([iso, round(amt, 6), 1 if exact else 0])
            n += 1
        added += n
        log(u'  %d 年：%d 筆除權息，收錄 %d 筆' % (year, len(rows), n))
        time.sleep(DELAY)

    log(u'')
    log(u'櫃買（上櫃，只有當前清單）：')
    try:
        rows = fetch_tpex()
        n = 0
        for code, iso, amt, _kind in rows:
            if code not in codes:
                continue
            lst = merged.setdefault(code, [])
            if any(r[0] == iso for r in lst):
                continue
            lst.append([iso, round(amt, 6), 1])
            n += 1
        added += n
        log(u'  當前清單 %d 筆，收錄 %d 筆' % (len(rows), n))
    except Exception as e:                             # noqa: BLE001
        # 櫃買掛掉不該讓整個流程失敗 —— 證交所那份才是主力
        log(u'  抓取失敗（略過）：%s' % str(e)[:80])

    for lst in merged.values():
        lst.sort()

    # 用宣告的現金股利修正每一檔最近的那筆「權息」。
    # 只改最近一筆：t187ap45_L 只有最近一次宣告，套到更早的年度會把歷年
    # 都壓成同一個數字（玉山金 2022~2026 全變成 1.40 就是這樣來的）。
    for code, cash in declared.items():
        lst = merged.get(code)
        if not lst:
            continue
        # 只看**最新的那一筆**。往回找「最近一筆不精確的」會出事：玉山金 2026 年
        # 那次是純「息」（已經精確），往回找就把 2025 年的權息用 2026 年度宣告的
        # 金額蓋掉了 —— 那是兩個不同年度的股利。
        # 宣告表講的是最近一次配息，最新那筆已經精確就代表它已經反映了，不必動。
        last = lst[-1]
        if len(last) > 2 and not last[2]:
            last[1] = round(cash, 6)
            last[2] = 1
            split_both += 1

    payload = {
        'meta': {
            'updated': date.today().isoformat(),
            'codes': len(merged),
            'records': sum(len(v) for v in merged.values()),
            'stockOnlyDates': sum(len(v) for v in stock_only.values()),
            'source': u'臺灣證券交易所 除權除息計算結果表 / 櫃買中心 除權息預告',
            'note': (u'交易所公告的現金股利。每筆是 [除息日, 每股金額, 是否精確]；'
                     u'精確=0 代表那次是「權息」合併計價、拆不出現金部分，'
                     u'數字會高估。純股票股利（權）不收錄。'
                     u'櫃買只提供當前清單，歷史部分要靠每日累積。'),
        },
        'dividends': merged,
        # 純股票股利的除息日。這些日子還原股價會跳，但一毛現金都沒有 ——
        # 下游要用它把那些事件從配息序列裡拿掉。
        'stockOnly': dict((k, sorted(v)) for k, v in sorted(stock_only.items())),
    }
    d = os.path.dirname(OUT)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, sort_keys=True,
                            separators=(',', ':')))

    log(u'')
    log(u'排除純股票股利 %d 筆；權息用宣告的現金拆開 %d 筆' % (skipped_stock, split_both))
    log(u'新增 %d 筆，合計 %d 筆（%d 檔），寫入 %s（%.0f KB）'
        % (added, payload['meta']['records'], payload['meta']['codes'],
           OUT, os.path.getsize(OUT) / 1024.0))


if __name__ == '__main__':
    main()
