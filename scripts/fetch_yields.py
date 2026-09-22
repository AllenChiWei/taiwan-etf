# -*- coding: utf-8 -*-
u"""殖利率自己算：近 12 個月配息 ÷ 當日收盤價。

    python scripts/fetch_yields.py [outfile]

預設寫到 app/public/data/yields.json，**進版控**（每檔一列，40 KB 上下）。

## 為什麼要自己算

原本殖利率跟保管銀行、配息頻率一樣來自 MoneyDJ 的 Basic0004，所以「只有殖利率每天
會變」這件事，逼得整份 359 頁每天都要重抓。

拆開之後：

    保管銀行、配息頻率   幾乎不變     -> MoneyDJ 每週一次就夠
    殖利率             每天都在變   -> 自己算，用免費的官方資料

算式就是定義本身：近 12 個月的每股配息合計 ÷ 當日收盤價。配息來自交易所公告
（dividends.json，累積式），收盤價來自證交所與櫃買的每日行情 —— 兩邊都是免費端點，
不動用 FinLab，也不必多敲 MoneyDJ 一次。

## 與 MoneyDJ 的差別

**基準日不同。** 這裡用當天收盤價，MoneyDJ 用它自己的報價日。同一檔在兩邊差幾個
百分點多半是股價變動，不是配息認定不同。

## 算法是年化（2026-09-23 改，站主指定）

    殖利率 = 最近一次除息金額 × 每年配息次數 ÷ 當日收盤價

這就是 MoneyDJ 那種算法，**所有標的一律適用**，不分配息史長短。

原本用「近 12 個月實際配息合計」，對今年才上市的標的會低到失真：00400A（月配、
7 月才第一次配）只框到三次 0.12，顯示 2.32%，實際水準是 0.12 × 12 ÷ 15.49 = 9.30%；
00406A 只配過兩次，顯示 2.70% 而不是 16.83%。全站有 36 檔是這種情況，幾乎全是今年
上市的主動式 ETF，在主動那一區看起來整片都錯 —— 使用者就是這樣回報的。

要知道的取捨：年化是**推估**，它假設下一年配得跟最近一次一樣多。某一次加發會被
乘上次數（00888 實際近一年 10.54%，最後一次 × 4 是 19.39%），減配也會立刻反映。
所以每一列都保留 `y12`（近 12 個月實際配息換算的殖利率）與 `sum`／`n`，要回頭比對
或改回去都拿得到數字。

每年配息次數優先從**實際除息日的間隔**推（中位數 30 天 -> 12 次），推不出來
（只配過一次）才退回既有 etfs.json 的配息頻率標籤；兩邊都沒有就退回近 12 個月實際。

**最近一次除息在一年以前的，視同近一年沒配息，輸出 null 而不是 0%** —— 「沒配」與
「配了 0」不是同一件事，也不該拿一年多前的金額去年化。

build_data.py 優先用這份，算不出來的才退回 MoneyDJ 的值。
"""
import io
import json
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'app', 'public', 'data')
OUT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') \
    else os.path.join(DATA, 'yields.json')

TPE = timezone(timedelta(hours=8))
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) yield from official data')
TIMEOUT = 60
DELAY = 1.5

TWSE_PRICE = ('https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX'
              '?date=%s&type=ALL&response=json')
TPEX_PRICE = ('https://www.tpex.org.tw/www/zh-tw/afterTrading/otc'
              '?date=%s&type=EW&response=json')

# 近 12 個月的定義：365 天。用日曆天而不是「12 次配息」——後者會把改變配息頻率的
# 標的算錯（季配改月配那年會變成只算三個月）。
WINDOW_DAYS = 365

ERRORS = []


def log(m):
    print(m, flush=True)


def note(msg):
    log(u'  ⚠ %s' % msg)
    ERRORS.append(msg)


def fetch_json(url, label, tries=3):
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            raw = urllib.request.urlopen(req, timeout=TIMEOUT).read()
            time.sleep(DELAY)
            return json.loads(raw.decode('utf-8'))
        except Exception as e:                                # noqa: BLE001
            if attempt == tries:
                note(u'%s：%s' % (label, str(e)[:70]))
                return None
            time.sleep(DELAY * attempt)
    return None


def num(v):
    s = str(v or '').replace(',', '').strip()
    if not s or s in ('-', '--'):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def closes_for(day):
    u"""{代號: 收盤價}，上市與上櫃合起來。day 是 YYYYMMDD。"""
    out = {}
    doc = fetch_json(TWSE_PRICE % day, u'證交所每日收盤行情')
    for t in (doc or {}).get('tables') or []:
        fields = t.get('fields') or []
        if u'收盤價' not in fields or u'證券代號' not in fields:
            continue
        ci = fields.index(u'收盤價')
        for r in t.get('data') or []:
            p = num(r[ci])
            if p:
                out[r[0].strip()] = p
    roc = '%d/%02d/%02d' % (int(day[:4]) - 1911, int(day[4:6]), int(day[6:]))
    doc = fetch_json(TPEX_PRICE % roc, u'櫃買每日收盤行情')
    for t in (doc or {}).get('tables') or []:
        fields = [f.strip() for f in (t.get('fields') or [])]
        if u'收盤' not in fields or u'代號' not in fields:
            continue
        ci = fields.index(u'收盤')
        for r in t.get('data') or []:
            p = num(r[ci])
            if p:
                out[r[0].strip()] = p
    return out


def latest_close_day(max_back=8):
    u"""往回找最近一個有收盤行情的日子。假日與收盤前都靠這個迴圈處理。"""
    today = datetime.now(TPE).date()
    for back in range(max_back):
        day = (today - timedelta(days=back)).strftime('%Y%m%d')
        prices = closes_for(day)
        if len(prices) > 100:
            return day, prices
        log(u'  %s 沒有收盤行情，往前一天' % day)
    return None, {}


# 每年配息次數：先看實際除息日的間隔（中位數天數落在哪一段），推不出來才用標籤。
# 上界都放寬了一截，因為除息日會漂 —— 季配實測 91~92 天，但遇上長假會到 100 天。
GAP_TO_PER_YEAR = [(45, 12), (75, 6), (135, 4), (250, 2), (500, 1)]
FREQ_PER_YEAR = {u'月配': 12, u'雙月配': 6, u'季配': 4, u'半年配': 2, u'年配': 1}


def per_year_from_gaps(dates):
    u"""除息日 -> 每年配幾次。用最近最多 6 次的間隔中位數，少於兩次就回 None。"""
    if len(dates) < 2:
        return None
    recent = dates[-6:]
    gaps = []
    for a, b in zip(recent, recent[1:]):
        d0 = datetime.strptime(a, '%Y-%m-%d').date()
        d1 = datetime.strptime(b, '%Y-%m-%d').date()
        gaps.append((d1 - d0).days)
    gaps.sort()
    mid = (gaps[len(gaps) // 2] if len(gaps) % 2 else
           (gaps[len(gaps) // 2 - 1] + gaps[len(gaps) // 2]) / 2.0)
    for limit, n in GAP_TO_PER_YEAR:
        if mid <= limit:
            return n
    return None


def freq_labels():
    u"""既有 etfs.json 的配息頻率 {代號: 每年次數}。間隔推不出來時的退路。

    讀的是上一版 etfs.json（這支腳本跑在 build_data.py 之前），所以今天才上市的
    新標的不會在裡面 —— 那種本來就還沒配過息，年化與否都不影響。
    """
    try:
        doc = json.load(io.open(os.path.join(DATA, 'etfs.json'), encoding='utf-8'))
    except Exception:                                         # noqa: BLE001
        return {}
    out = {}
    for e in doc.get('etfs') or []:
        n = FREQ_PER_YEAR.get(e.get('freq'))
        if n:
            out[e['code']] = n
    return out


def main():
    log(u'殖利率＝近 %d 天配息 ÷ 收盤價（資料全部來自官方免費端點）' % WINDOW_DAYS)

    try:
        div = json.load(io.open(os.path.join(DATA, 'dividends.json'),
                                encoding='utf-8'))['dividends']
    except Exception as e:                                    # noqa: BLE001
        log(u'讀不到 dividends.json（%s），不產生殖利率' % str(e)[:60])
        return 1

    log(u'取得收盤行情…')
    day, prices = latest_close_day()
    if not day:
        log(u'找不到最近的收盤行情，這次不寫出')
        return 1
    asof = '%s-%s-%s' % (day[:4], day[4:6], day[6:])
    log(u'  %s，%d 檔有收盤價' % (asof, len(prices)))

    cutoff = (datetime.strptime(asof, '%Y-%m-%d').date()
              - timedelta(days=WINDOW_DAYS)).isoformat()

    labels = freq_labels()

    rows = {}
    no_price = no_div = annualised = 0
    for code, records in div.items():
        # 上界是收盤日：交易所會提前公告除息，這份資料因此含有還沒除息的日期。
        # 把它算進「近一年實際配過的息」有兩個問題 —— 那筆錢還沒發，而且股價
        # 也還沒除息、分母是含權的。2026-09-22 實測六檔中鏢，00930 因此從
        # 3.95% 變成 7.23%（隔天 09-23 才要除息的 0.815 元被算了進來）。
        paid = [r for r in records if r[0] <= asof]
        recent = [r for r in paid if r[0] > cutoff]
        total = sum(float(r[1]) for r in recent)
        price = prices.get(code)
        if price is None:
            no_price += 1
            continue
        if total <= 0:
            # 近一年沒配過息。輸出 null 而不是 0 —— 那是「沒配」，不是「配了 0」
            no_div += 1
            rows[code] = {'y': None, 'sum': 0, 'n': 0, 'price': round(price, 2)}
            continue

        row = {
            # y12 是「近 12 個月實際配息」換算的殖利率。它不是畫面上顯示的那個，
            # 但留著：年化是推估，要回頭對帳或改回去時就靠這一欄。
            'y12': round(total / price * 100, 2),
            'sum': round(total, 4),
            'n': len(recent),
            'price': round(price, 2),
        }

        per_year = per_year_from_gaps([r[0] for r in paid]) or labels.get(code)
        if not per_year:
            # 只配過一次又沒有頻率標籤（通常是剛上市、還沒進 etfs.json 的）。
            # 年化沒有依據，退回近 12 個月實際金額。
            row['y'] = row['y12']
            rows[code] = row
            continue

        # 最近一次除息金額 × 每年次數 ÷ 收盤價。recent 已經濾掉未來與一年以前的，
        # 所以 recent[-1] 就是「最近一次真的除過息」的那筆。
        last = float(recent[-1][1])
        row['y'] = round(last * per_year / price * 100, 2)
        row['last'] = last
        row['fpy'] = per_year
        annualised += 1
        rows[code] = row

    with_yield = sum(1 for v in rows.values() if v['y'] is not None)
    payload = {
        'meta': {
            'asof': asof,
            'updated': datetime.now(TPE).date().isoformat(),
            'windowDays': WINDOW_DAYS,
            'codes': len(rows),
            'withYield': with_yield,
            'source': u'交易所公告配息（dividends.json）÷ 證交所／櫃買當日收盤價',
            'annualised': annualised,
            'note': (u'年化殖利率＝最近一次除息金額 × 每年配息次數 ÷ 當日收盤價。'
                     u'每列另附 y12（近 %d 天實際配息換算）、last（最近一次金額）與'
                     u'fpy（每年次數）。最近一次除息在一年以前的是 null，不是 0%%。'
                     % WINDOW_DAYS),
            'errors': ERRORS,
        },
        'yields': rows,
    }
    d = os.path.dirname(OUT)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))

    log(u'完成：%d 檔算得出殖利率、%d 檔近一年沒配息、%d 檔沒有收盤價'
        % (with_yield, no_div, no_price))
    log(u'      %s（%.0f KB）' % (OUT, os.path.getsize(OUT) / 1024.0))
    return 0 if with_yield else 1


if __name__ == '__main__':
    sys.exit(main())
