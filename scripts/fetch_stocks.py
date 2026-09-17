# -*- coding: utf-8 -*-
u"""個股頁的資料：財報（累積式）＋ 籌碼（每日）。

    python scripts/fetch_stocks.py [--no-chips] [--backfill N]

產出三份東西：

    app/public/data/fin_history.json   財報歷史，**進版控**、每次執行合併
    .cache/stock_chips.json            籌碼歷史，不進版控（CI 用 Actions 快取保存）
    app/public/data/stocks/…           前端實際讀的：index.json 與每檔一個 JSON

## 來源全部是官方免費端點，不動用 FinLab 額度

    TWSE  opendata/t187ap03_L      公司基本資料（產業、股本、上市日）
    TWSE  opendata/t187ap05_L      月營收（含上月、去年同月、累計與 YoY）
    TWSE  opendata/t187ap06_L_ci   綜合損益表（含基本每股盈餘）
    TWSE  opendata/t187ap07_L_ci   資產負債表（含每股參考淨值）
    TPEx  openapi/v1/mopsfin_*     上櫃的同五份
    TWSE  fund/T86                 三大法人買賣超（可指定日期）
    TWSE  marginTrading/MI_MARGN   融資融券餘額
    TWSE  fund/MI_QFIIS            外資及陸資持股比率
    TPEx  insti/dailyTrade、margin/balance   上櫃的對應資料
    TDCC  opendata/1-5             集保股權分散表（每週）

## 為什麼財報要「累積」

那幾個財報端點**只回當期**：綜合損益表只有最新一季、月營收只有最新一個月，
沒有任何歷史參數。所以季度趨勢只能自己留：`fin_history.json` 進版控，每次執行
把新的一期合併進去，已經有的期別不覆蓋。第一版上線時只有一季，之後每季長一筆。

這不是偷懶，是這些端點的極限。要一次補回三五年只有兩條路：用 FinLab 抓一次
（會吃掉當天 5 GB 的額度，而每日部署需要它），或到公開資訊觀測站對每家公司
逐季查（2900 家 × 8 季 = 兩萬多次請求，不會做）。好消息是端點本身就帶對照
數字 —— 月營收有去年同月與累計 YoY，所以第一版就看得出成長趨勢。

## 季報的數字是「累計」，不是單季

公開資訊觀測站的綜合損益表是**年初到該季底的累計數**：季別 2 是上半年、
季別 3 是前三季。用月營收對照就看得出來 —— 台積電 2026Q2 營收 2.40 兆，
而 1～8 月累計月營收是 3.39 兆；當成單季會差一倍。EPS 同理（Q2 的 49.33 元
是上半年的）。

所以 JSON 原樣保留累計數，前端標明「累計」，並在歷史裡有連續兩期時自己相減
得出單季（lib/stock.ts，有測試）。資產負債表則是時點數，不受這件事影響。

## 籌碼為什麼不進版控

它每天都變，而且是 2000 多檔 × 每日三個數字。進版控的話 repo 每天長幾 MB。
CI 用 Actions 快取保存，快取掉了就用 `--backfill` 逐日補回來 —— T86 可以指定
日期，這是它跟財報端點不一樣的地方。
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
DATA = os.path.join(ROOT, 'app', 'public', 'data')
HISTORY = os.path.join(DATA, 'fin_history.json')
CHIPS_CACHE = os.path.join(ROOT, '.cache', 'stock_chips.json')
OUTDIR = os.path.join(DATA, 'stocks')

UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) per-stock fundamentals and chips')

DELAY = 1.2
TIMEOUT = 60
TPE = timezone(timedelta(hours=8))

# 籌碼留幾個交易日。20 日是市場上看買賣超最常用的窗口。
CHIP_DAYS = 20
# 財報留幾期。8 季＝兩年，13 個月才看得出「去年同月」的完整一輪。
KEEP_QUARTERS = 8
KEEP_MONTHS = 13

NO_CHIPS = '--no-chips' in sys.argv
BACKFILL = 0
for a in sys.argv[1:]:
    if a.startswith('--backfill'):
        BACKFILL = int(a.split('=')[1]) if '=' in a else CHIP_DAYS

TWSE_OPEN = 'https://openapi.twse.com.tw/v1/opendata/%s'
TPEX_OPEN = 'https://www.tpex.org.tw/openapi/v1/%s'
TWSE_T86 = ('https://www.twse.com.tw/rwd/zh/fund/T86'
            '?date=%s&selectType=ALL&response=json')
TWSE_MARGIN = ('https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN'
               '?date=%s&selectType=ALL&response=json')
TWSE_QFII = ('https://www.twse.com.tw/rwd/zh/fund/MI_QFIIS'
             '?date=%s&selectType=ALLBUT0999&response=json')
TPEX_INSTI = ('https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade'
              '?type=Daily&sect=EW&date=%s&id=&response=json')
TPEX_MARGIN = ('https://www.tpex.org.tw/www/zh-tw/margin/balance'
               '?date=%s&type=Daily&response=json')
TDCC = 'https://openapi.tdcc.com.tw/v1/opendata/1-5'

# 集保的持股分級：12～15 級是 400 張以上，15 級是千張以上，17 級是合計。
# 這個對照表是解讀那份資料的關鍵，寫死在這裡比每次去查文件可靠。
TDCC_BIG = ('12', '13', '14', '15')
TDCC_HUGE = ('15',)
TDCC_TOTAL = '17'

ERRORS = []


def log(m):
    print(m, flush=True)


def note(msg):
    log(u'  ⚠ %s' % msg)
    ERRORS.append(msg)


def write_json(path, obj):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')))


def load_json(path, default):
    try:
        return json.load(io.open(path, encoding='utf-8'))
    except Exception:                                         # noqa: BLE001
        return default


def fetch(url, label, tries=3):
    u"""抓一個端點。失敗回 None 並記下來 —— 一個來源掛掉不該讓整份沒有。

    會重試：櫃買的幾個大端點（月營收、損益表）偶爾在傳輸中途斷掉，
    回 IncompleteRead。那不是資料問題，下一次同樣的請求通常就完整。
    """
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            raw = urllib.request.urlopen(req, timeout=TIMEOUT).read()
            time.sleep(DELAY)
            # TDCC 的 JSON 帶 BOM，utf-8-sig 兩種都吃得下
            return json.loads(raw.decode('utf-8-sig'))
        except Exception as e:                                # noqa: BLE001
            if attempt == tries:
                note(u'%s：%s（試了 %d 次）' % (label, str(e)[:70], tries))
                return None
            log(u'  %s 第 %d 次失敗（%s），重試' % (label, attempt, str(e)[:50]))
            time.sleep(DELAY * attempt)
    return None


def num(v):
    u"""'13,515,534' / '71289957.00' -> 數字；空值、'-'、'--' 回 None。"""
    if v is None:
        return None
    s = str(v).replace(',', '').replace('%', '').strip()
    if not s or s in ('-', '--', 'N/A'):
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return int(f) if f == int(f) else round(f, 2)


def pick(row, *names):
    u"""欄位名稱在上市與上櫃之間不一致（櫃買有些是英文鍵），挨個試。"""
    for n in names:
        if n in row:
            return row[n]
    return None


def roc_quarter(row):
    u"""民國年 + 季別 -> '2026Q2'。"""
    year = num(pick(row, u'年度', 'Year'))
    season = num(pick(row, u'季別', 'Season'))
    if not year or not season:
        return None
    return '%dQ%d' % (int(year) + 1911, int(season))


def roc_month(ym):
    u"""'11508' -> '2026-08'。"""
    s = str(ym or '').strip()
    if not re.match(r'^\d{5,6}$', s):
        return None
    return '%d-%s' % (int(s[:-2]) + 1911, s[-2:])


# ── 財報 ─────────────────────────────────────────────────────

def fetch_info(history):
    u"""公司基本資料。名稱與產業以最新一次為準，所以直接覆蓋。"""
    info = history.setdefault('info', {})
    for url, market, label in (
            (TWSE_OPEN % 't187ap03_L', u'上市', u'證交所公司基本資料'),
            (TPEX_OPEN % 'mopsfin_t187ap03_O', u'上櫃', u'櫃買公司基本資料')):
        rows = fetch(url, label)
        if not rows:
            continue
        for r in rows:
            code = str(pick(r, u'公司代號', 'SecuritiesCompanyCode') or '').strip()
            if not re.match(r'^\d{4,6}$', code):
                continue
            info[code] = {
                'name': (pick(r, u'公司簡稱', 'CompanyAbbreviation',
                              u'公司名稱', 'CompanyName') or '').strip(),
                'full': (pick(r, u'公司名稱', 'CompanyName') or '').strip(),
                'market': market,
                'capital': num(pick(r, u'實收資本額', 'capital')),
                'listed': str(pick(r, u'上市日期', u'上櫃日期', 'listingDate') or '').strip(),
                'chair': (pick(r, u'董事長', 'chairman') or '').strip(),
                'site': (pick(r, u'網址', 'website') or '').strip(),
            }
        log(u'  %s %d 家' % (market, len(rows)))
    return info


def merge_monthly(history, info):
    u"""月營收。端點只給最新一個月，所以合併而不是覆蓋。"""
    months = history.setdefault('m', {})
    added = 0
    for url, label in ((TWSE_OPEN % 't187ap05_L', u'證交所月營收'),
                       (TPEX_OPEN % 'mopsfin_t187ap05_O', u'櫃買月營收')):
        rows = fetch(url, label)
        if not rows:
            continue
        for r in rows:
            code = str(pick(r, u'公司代號', 'SecuritiesCompanyCode') or '').strip()
            period = roc_month(pick(r, u'資料年月', 'DataYearMonth'))
            if not code or not period:
                continue
            # 產業別在這裡是文字（基本資料那份是代碼），順手補進 info
            industry = (pick(r, u'產業別', 'industry') or '').strip()
            if industry and code in info and not info[code].get('industry'):
                info[code]['industry'] = industry
            rec = {
                'p': period,
                'rev': num(pick(r, u'營業收入-當月營收')),
                'mom': num(pick(r, u'營業收入-上月比較增減(%)')),
                'yoy': num(pick(r, u'營業收入-去年同月增減(%)')),
                'cum': num(pick(r, u'累計營業收入-當月累計營收')),
                'cumYoy': num(pick(r, u'累計營業收入-前期比較增減(%)')),
            }
            rows_for_code = months.setdefault(code, [])
            if any(x['p'] == period for x in rows_for_code):
                continue
            rows_for_code.append(rec)
            added += 1
    for code in months:
        months[code] = sorted(months[code], key=lambda x: x['p'])[-KEEP_MONTHS:]
    log(u'  新增 %d 筆月營收' % added)
    return added


def merge_quarterly(history):
    u"""季報：損益表、資產負債表、營益分析三份合併成一期。"""
    quarters = history.setdefault('q', {})
    staging = {}

    def collect(url, label, mapper):
        rows = fetch(url, label)
        if not rows:
            return
        for r in rows:
            code = str(pick(r, u'公司代號', 'SecuritiesCompanyCode') or '').strip()
            period = roc_quarter(r)
            if not code or not period:
                continue
            mapper(staging.setdefault((code, period), {'p': period}), r)

    def from_income(rec, r):
        rec['rev'] = num(pick(r, u'營業收入'))
        rec['gp'] = num(pick(r, u'營業毛利（毛損）淨額', u'營業毛利（毛損）'))
        rec['op'] = num(pick(r, u'營業利益（損失）'))
        rec['pre'] = num(pick(r, u'稅前淨利（淨損）'))
        rec['ni'] = num(pick(r, u'淨利（淨損）歸屬於母公司業主', u'本期淨利（淨損）'))
        rec['eps'] = num(pick(r, u'基本每股盈餘（元）'))

    def from_balance(rec, r):
        rec['ca'] = num(pick(r, u'流動資產'))
        rec['cl'] = num(pick(r, u'流動負債'))
        rec['ta'] = num(pick(r, u'資產總計'))
        rec['tl'] = num(pick(r, u'負債總計'))
        rec['eq'] = num(pick(r, u'權益總計'))
        rec['bv'] = num(pick(r, u'每股參考淨值'))

    # 毛利率／營益率／純益率不另外抓「營益分析」那份：證交所有、櫃買沒有，
    # 而三個比率都是損益表欄位的除法。在前端算（lib/stock.ts，有測試）可以
    # 保證兩個市場一致，也少兩次請求。
    for market, inc, bs in (
            (u'上市', 't187ap06_L_ci', 't187ap07_L_ci'),
            (u'上櫃', 'mopsfin_t187ap06_O_ci', 'mopsfin_t187ap07_O_ci')):
        base = TWSE_OPEN if market == u'上市' else TPEX_OPEN
        collect(base % inc, u'%s綜合損益表' % market, from_income)
        collect(base % bs, u'%s資產負債表' % market, from_balance)

    added = 0
    for (code, period), rec in staging.items():
        rows_for_code = quarters.setdefault(code, [])
        existing = next((x for x in rows_for_code if x['p'] == period), None)
        if existing:
            # 同一期後來補齊的欄位要補上（三份表不一定同時公佈）
            for k, v in rec.items():
                if v is not None and existing.get(k) is None:
                    existing[k] = v
            continue
        rows_for_code.append(rec)
        added += 1
    for code in quarters:
        quarters[code] = sorted(quarters[code], key=lambda x: x['p'])[-KEEP_QUARTERS:]
    log(u'  新增 %d 筆季報' % added)
    return added


# ── 籌碼 ─────────────────────────────────────────────────────

def twse_inst(day):
    u"""上市三大法人買賣超 {代號: [外資, 投信, 自營]}（股數）。"""
    doc = fetch(TWSE_T86 % day, u'證交所 T86（%s）' % day)
    if not doc or doc.get('stat') != 'OK':
        return None
    f = doc['fields']
    fi, fdi = (f.index(u'外陸資買賣超股數(不含外資自營商)'),
               f.index(u'外資自營商買賣超股數'))
    ti, di = f.index(u'投信買賣超股數'), f.index(u'自營商買賣超股數')
    out = {}
    for r in doc['data']:
        code = r[0].strip()
        # 外資＝外陸資（不含外資自營商）＋外資自營商，相加才是市場在講的那個數字
        foreign = (num(r[fi]) or 0) + (num(r[fdi]) or 0)
        out[code] = [foreign, num(r[ti]) or 0, num(r[di]) or 0]
    return out


def tpex_inst(day):
    u"""上櫃三大法人買賣超。欄位名稱七組全都一樣，只能靠位置（見 fetch_chips.py）。"""
    roc = '%d/%02d/%02d' % (int(day[:4]) - 1911, int(day[4:6]), int(day[6:]))
    doc = fetch(TPEX_INSTI % roc, u'櫃買法人買賣超（%s）' % day)
    tables = (doc or {}).get('tables') or []
    if not tables or not tables[0].get('data'):
        return None
    out = {}
    for r in tables[0]['data']:
        out[r[0].strip()] = [num(r[10]) or 0, num(r[13]) or 0, num(r[22]) or 0]
    return out


def margins(day):
    u"""融資與融券的**今日**餘額（張）。上市與上櫃合起來回一份。

    兩邊欄位順序不同，而且都把「前日餘額」排在「今日餘額」前面 —— 取錯一格會
    整頁顯示昨天的數字，而且看起來完全正常（第一版就取錯了，靠對照原始列才發現）。
    上市：5 前日資 / 6 今日資 / 11 前日券 / 12 今日券。
    上櫃：2 前資 / 6 資餘額 / 8 資使用率 / 10 前券 / 14 券餘額。
    """
    out = {}
    doc = fetch(TWSE_MARGIN % day, u'證交所融資融券（%s）' % day)
    for t in (doc or {}).get('tables') or []:
        fields = t.get('fields') or []
        if u'代號' not in fields or len(fields) < 14:
            continue
        for r in t.get('data') or []:
            out[r[0].strip()] = {'mb': num(r[6]), 'sb': num(r[12])}
    doc = fetch(TPEX_MARGIN % ('%d/%02d/%02d' % (int(day[:4]) - 1911,
                                                 int(day[4:6]), int(day[6:]))),
                u'櫃買融資融券（%s）' % day)
    for t in (doc or {}).get('tables') or []:
        fields = [f.strip() for f in (t.get('fields') or [])]
        if u'代號' not in fields:
            continue
        for r in t.get('data') or []:
            out[r[0].strip()] = {'mb': num(r[6]), 'sb': num(r[14]),
                                 'use': num(r[8])}
    return out


def qfii(day):
    u"""外資及陸資持股比率（%）。"""
    doc = fetch(TWSE_QFII % day, u'證交所外資持股（%s）' % day)
    if not doc or not doc.get('data'):
        return {}
    f = doc['fields']
    i = f.index(u'全體外資及陸資持股比率')
    return dict((r[0].strip(), num(r[i])) for r in doc['data'] if r[0].strip())


def tdcc_distribution():
    u"""集保股權分散表：400 張以上與千張以上的比例、股東人數。

    這份是全市場 6 萬多列、9 MB 的原始資料，但每檔只留三個數字 ——
    前端要的是「大戶手上有多少」，不是完整的 17 級分佈。
    """
    rows = fetch(TDCC, u'集保股權分散表')
    if not rows:
        return {}, None
    out = {}
    asof = None
    for r in rows:
        code = str(r.get(u'證券代號') or '').strip()
        grade = str(r.get(u'持股分級') or '').strip()
        pct = num(r.get(u'占集保庫存數比例%'))
        if not code or pct is None:
            continue
        # 日期的鍵帶 BOM（'﻿資料日期'），所以用值來找而不是用鍵
        if asof is None:
            for k, v in r.items():
                if k.endswith(u'資料日期'):
                    asof = str(v).strip()
                    break
        rec = out.setdefault(code, {'big': 0.0, 'huge': 0.0, 'holders': None})
        if grade in TDCC_BIG:
            rec['big'] = round(rec['big'] + pct, 2)
        if grade in TDCC_HUGE:
            rec['huge'] = round(rec['huge'] + pct, 2)
        if grade == TDCC_TOTAL:
            rec['holders'] = num(r.get(u'人數'))
    if asof and len(asof) == 8:
        asof = '%s-%s-%s' % (asof[:4], asof[4:6], asof[6:])
    return out, asof


def trading_days_back(n):
    u"""往回數 n 個日曆日的日期字串（YYYYMMDD），新到舊。

    不是交易日曆 —— 假日的請求會回空的，呼叫端當成沒資料略過就好。
    自己維護一份交易日曆才是更容易錯的做法。
    """
    today = datetime.now(TPE).date()
    return [(today - timedelta(days=i)).strftime('%Y%m%d') for i in range(n)]


def update_chips(cache, backfill, universe):
    u"""把今天（或回補的那幾天）的籌碼併進快取。

    只留 universe 裡的代號。T86 一天回 16000 多列 —— 那裡面絕大多數是權證，
    而這一頁是給個股看的；不過濾的話快取會大八倍，存進 Actions 快取也更慢。
    """
    inst = cache.setdefault('inst', {})
    days = cache.setdefault('days', [])

    # 回補時多看幾個日曆日，才能蓋過假日
    wanted = trading_days_back(max(backfill, 1) + 4)
    todo = []
    for d in wanted:
        iso = '%s-%s-%s' % (d[:4], d[4:6], d[6:])
        if iso not in days:
            todo.append((d, iso))
        if len(todo) >= max(backfill, 1):
            break

    for d, iso in reversed(todo):                 # 舊到新，days 才是排好的
        tw = twse_inst(d)
        if tw is None:
            continue                              # 假日或該日沒資料
        tp = tpex_inst(d) or {}
        kept = 0
        for code, vals in list(tw.items()) + list(tp.items()):
            if code not in universe:
                continue
            inst.setdefault(code, {})[iso] = vals
            kept += 1
        days.append(iso)
        log(u'  籌碼 %s：留下 %d 檔（來源上市 %d、上櫃 %d，其餘多是權證）'
            % (iso, kept, len(tw), len(tp)))

    cache['days'] = sorted(set(days))[-CHIP_DAYS:]
    keep = set(cache['days'])
    for code in list(inst):
        inst[code] = dict((k, v) for k, v in inst[code].items() if k in keep)
        if not inst[code]:
            del inst[code]

    latest = cache['days'][-1] if cache['days'] else None
    if latest:
        compact = latest.replace('-', '')
        cache['margin'] = dict((k, v) for k, v in margins(compact).items()
                               if k in universe)
        cache['qfii'] = dict((k, v) for k, v in qfii(compact).items()
                             if k in universe)
        cache['date'] = latest
    dist, asof = tdcc_distribution()
    if dist:
        cache['tdcc'] = dict((k, v) for k, v in dist.items() if k in universe)
        cache['tdccDate'] = asof
    return cache


# ── 產出前端要的檔案 ─────────────────────────────────────────

def build_outputs(history, chips):
    info = history.get('info') or {}
    months, quarters = history.get('m') or {}, history.get('q') or {}
    inst = (chips or {}).get('inst') or {}
    days = (chips or {}).get('days') or []
    margin = (chips or {}).get('margin') or {}
    qfii_map = (chips or {}).get('qfii') or {}
    tdcc = (chips or {}).get('tdcc') or {}

    index = []
    written = 0
    for code, meta in sorted(info.items()):
        q, m = quarters.get(code) or [], months.get(code) or []
        series = inst.get(code) or {}
        if not q and not m and not series:
            continue                              # 什麼都沒有的不要產出空檔
        index.append({'c': code, 'n': meta.get('name') or code,
                      'm': meta.get('market'), 'i': meta.get('industry') or ''})
        payload = {
            'code': code,
            'info': meta,
            'q': q,
            'm': m,
            'chips': {
                'date': (chips or {}).get('date'),
                'days': days,
                # 三大法人每日買賣超（股數）：外資、投信、自營
                'inst': [series.get(d) for d in days],
                'margin': margin.get(code),
                'qfii': qfii_map.get(code),
                'tdcc': tdcc.get(code),
                'tdccDate': (chips or {}).get('tdccDate'),
            },
        }
        write_json(os.path.join(OUTDIR, code + '.json'), payload)
        written += 1

    write_json(os.path.join(OUTDIR, 'index.json'), {
        'meta': {
            'updated': datetime.now(TPE).date().isoformat(),
            'chipsDate': (chips or {}).get('date'),
            'tdccDate': (chips or {}).get('tdccDate'),
            'stocks': len(index),
            'quarters': sorted({r['p'] for rows in quarters.values() for r in rows}),
            'months': sorted({r['p'] for rows in months.values() for r in rows}),
            'source': u'公開資訊觀測站（證交所／櫃買）、集保結算所',
            'note': (u'財報由官方端點逐期累積 —— 那些端點只回當期，沒有歷史參數。'
                     u'籌碼為近 %d 個交易日。' % CHIP_DAYS),
            'errors': ERRORS,
        },
        'stocks': index,
    })
    return written


def main():
    log(u'個股資料：財報（累積）＋ 籌碼')
    history = load_json(HISTORY, {})

    log(u'公司基本資料…')
    info = fetch_info(history)
    log(u'月營收…')
    merge_monthly(history, info)
    log(u'季報（損益表／資產負債表／營益分析）…')
    merge_quarterly(history)

    history['meta'] = {
        'updated': datetime.now(TPE).date().isoformat(),
        'stocks': len(history.get('info') or {}),
        'source': u'公開資訊觀測站 OpenAPI（證交所 t187ap03/05/06/07/17、櫃買對應端點）',
        'note': u'那些端點只回當期，這份是逐期累積的結果；已有的期別不覆蓋。',
    }
    write_json(HISTORY, history)
    log(u'  財報歷史：%d 家、%.0f KB'
        % (history['meta']['stocks'], os.path.getsize(HISTORY) / 1024.0))

    chips = load_json(CHIPS_CACHE, {})
    if NO_CHIPS:
        log(u'略過籌碼（--no-chips）')
    else:
        log(u'籌碼…')
        need = BACKFILL or (CHIP_DAYS if not chips.get('days') else 1)
        if need > 1:
            log(u'  快取是空的，回補 %d 個交易日' % need)
        chips = update_chips(chips, need, set(history.get('info') or {}))
        write_json(CHIPS_CACHE, chips)
        log(u'  籌碼快取：%d 個交易日、%.0f KB'
            % (len(chips.get('days') or []),
               os.path.getsize(CHIPS_CACHE) / 1024.0))

    log(u'產出前端檔案…')
    written = build_outputs(history, chips)
    log(u'  %d 檔個股' % written)

    if ERRORS:
        log(u'有 %d 段缺漏：' % len(ERRORS))
        for e in ERRORS:
            log(u'  %s' % e)
    return 0 if written else 1


if __name__ == '__main__':
    sys.exit(main())
