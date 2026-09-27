# -*- coding: utf-8 -*-
u"""美國總經數據：通膨、就業、利率與殖利率曲線、原油。FRED 為主，原油庫存取自 EIA。

    python scripts/fetch_macro.py [outfile]

預設寫到 app/public/data/macro.json（部署時產生，不進版控）。

## 為什麼是 FRED、為什麼只挑這幾條

FRED（聖路易聯邦準備銀行）把美國各政府機關發佈的數列集中在一個地方，而且每條都有
不需要金鑰的 CSV 端點 `fredgraph.csv?id=…`。robots.txt 對一般程式開放這個路徑
（只擋圖片與搜尋頁），要求 `Crawl-delay: 1`，所以每個請求之間等 1.5 秒。

**FRED 上不是每條數列都能轉載。** 它自己的說明寫得很清楚：部分數列的著作權屬於第三方
（S&P、ICE 美銀的債券指數、Moody's 的信用利差…），要另外取得授權。這裡只挑**原始
發佈者是美國聯邦政府機關**的數列 —— 美國聯邦政府的著作不受著作權保護：

    勞工統計局 BLS     CPI、核心 CPI、失業率、非農就業
    經濟分析局 BEA     核心 PCE、實質 GDP
    勞工部 DOL         初領失業救濟金
    聯準會 Fed         聯邦基金利率目標區間、有效利率、公債殖利率（H.15）
    能源資訊署 EIA     WTI 現貨價；原油商業庫存直接取自 EIA（見下）

原油商業庫存（不含戰略儲備，WCESTUS1）FRED 沒有收，改抓 EIA 自己的歷史表
`dnav/pet/hist/LeafHandler.ashx`。eia.gov 的 robots.txt 對所有人 `Allow: /`，`/dnav/` 不在
禁止清單裡。那一頁是 HTML 表格，一列是一個月、裡面最多五組「週末日期／千桶」。

要加數列之前，先到 FRED 那條數列的頁面看「Source」與「Release」是不是政府機關。

## 存什麼

月資料存近 20 年，日資料存近 10 年（殖利率一天一點，十一個天期全存會到好幾 MB，
所以曲線只存最新、一個月前、一年前三條，完整歷史只留畫利差要用的 3 個月、2 年、10 年）。
年增率、月增這些**衍生數字在前端算**（`lib/macro.ts`，有測試），這裡存原始數列 ——
這樣要對帳時，JSON 裡的數字跟 FRED 網頁上看到的一模一樣。

一條數列抓不到就略過並記在 `meta.errors`，其他照常寫出；一條都沒有才失敗。
"""
import csv
import io
import json
import os
import sys
import time
import urllib.request
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'macro.json')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
if args:
    OUT = args[0]

UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) US macro indicators')
CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s&cosd=%s'
DELAY = 1.5                     # robots.txt: Crawl-delay: 1
TIMEOUT = 40

MONTHLY_YEARS = 20
DAILY_YEARS = 10

# (鍵, FRED 代號, 名稱, 單位, 頻率, 發佈機關)
# 單位是 FRED 原始單位；前端依鍵決定要不要換算成年增率或月增。
SERIES = [
    ('cpi',      'CPIAUCSL',        u'CPI',              u'指數',   'M', 'BLS'),
    ('core_cpi', 'CPILFESL',        u'核心 CPI',         u'指數',   'M', 'BLS'),
    ('core_pce', 'PCEPILFE',        u'核心 PCE',         u'指數',   'M', 'BEA'),
    ('unrate',   'UNRATE',          u'失業率',           '%',       'M', 'BLS'),
    ('payems',   'PAYEMS',          u'非農就業人數',     u'千人',   'M', 'BLS'),
    ('claims',   'ICSA',            u'初領失業救濟金',   u'人',     'W', 'DOL'),
    ('gdp',      'A191RL1Q225SBEA', u'實質 GDP 成長率',  '%',       'Q', 'BEA'),
    ('fed_upper', 'DFEDTARU',       u'聯邦基金利率目標上限', '%',   'D', 'Fed'),
    ('fed_lower', 'DFEDTARL',       u'聯邦基金利率目標下限', '%',   'D', 'Fed'),
    ('effr',     'DFF',             u'有效聯邦基金利率', '%',       'D', 'Fed'),
    ('wti',      'DCOILWTICO',      u'WTI 原油現貨',     u'美元/桶', 'D', 'EIA'),
]

# 殖利率曲線的天期（財政部公債固定期限殖利率，Fed H.15）。
TENORS = [
    ('1M', 'DGS1MO'), ('3M', 'DGS3MO'), ('6M', 'DGS6MO'), ('1Y', 'DGS1'),
    ('2Y', 'DGS2'), ('3Y', 'DGS3'), ('5Y', 'DGS5'), ('7Y', 'DGS7'),
    ('10Y', 'DGS10'), ('20Y', 'DGS20'), ('30Y', 'DGS30'),
]
# 這三個天期留完整日資料，前端拿來畫 10Y−2Y 與 10Y−3M 利差。
KEEP_HISTORY = {'3M': 'y3m', '2Y': 'y2', '10Y': 'y10'}


def log(m):
    print(m, flush=True)


def fetch_series(fred_id, since):
    u"""回傳 ([日期], [數值])。FRED 用 "." 表示那天沒有值（假日），直接略過。"""
    req = urllib.request.Request(CSV_URL % (fred_id, since), headers={'User-Agent': UA})
    last = None
    for attempt in range(3):
        try:
            raw = urllib.request.urlopen(req, timeout=TIMEOUT).read().decode('utf-8')
            break
        except Exception as e:                                # noqa: BLE001
            last = e
            time.sleep(5 * (attempt + 1))
    else:
        raise last
    time.sleep(DELAY)
    rows = list(csv.reader(io.StringIO(raw)))
    if not rows or len(rows[0]) < 2:
        raise ValueError(u'%s：回應不是 CSV' % fred_id)
    dates, values = [], []
    for r in rows[1:]:
        if len(r) < 2 or r[1] in ('', '.'):
            continue
        try:
            v = float(r[1])
        except ValueError:
            continue
        dates.append(r[0])
        values.append(round(v, 4))
    if not dates:
        raise ValueError(u'%s：沒有資料' % fred_id)
    return dates, values


EIA_URL = 'https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=%s&f=W'
MONTHS = {m: i + 1 for i, m in enumerate(
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])}


def parse_eia_weekly(html):
    u"""EIA 週資料表 -> ([日期], [數值])。

    列標是「2026-Sep」，格子是「09/04」與「424,069」交錯。跨年的那一週（12 月那列裡
    出現 01/02）年份要加一。
    """
    import re
    dates, values = [], []
    for label, body in re.findall(r"<td class='B6'>\s*(?:&nbsp;)*(\d{4}-[A-Za-z]{3})</td>(.*?)</tr>",
                                  html, re.S):
        year, mon = int(label[:4]), MONTHS[label[5:8]]
        cells = re.findall(r"<td class='B[35]'>(.*?)</td>", body, re.S)
        for i in range(0, len(cells) - 1, 2):
            md = cells[i].replace('&nbsp;', '').strip()
            val = cells[i + 1].replace('&nbsp;', '').replace(',', '').strip()
            if not md or not val:
                continue
            m, d = int(md[:2]), int(md[3:5])
            y = year + 1 if (mon == 12 and m == 1) else year
            dates.append('%04d-%02d-%02d' % (y, m, d))
            values.append(float(val))
    return dates, values


def fetch_eia_weekly(series_id, since):
    req = urllib.request.Request(EIA_URL % series_id, headers={'User-Agent': UA})
    html = urllib.request.urlopen(req, timeout=TIMEOUT).read().decode('utf-8', 'replace')
    time.sleep(DELAY)
    d, v = parse_eia_weekly(html)
    keep = [i for i, x in enumerate(d) if x >= since]
    if not keep:
        raise ValueError(u'%s：沒有資料' % series_id)
    return [d[i] for i in keep], [v[i] for i in keep]


def value_on_or_before(dates, values, day):
    u"""某一天（含）以前最近的一個值；曲線的「一個月前」遇到假日要往前找。"""
    best = None
    for d, v in zip(dates, values):
        if d > day:
            break
        best = (d, v)
    return best


def main():
    today = date.today()
    since_m = '%d-01-01' % (today.year - MONTHLY_YEARS - 1)   # 多一年，湊得出第一年的年增率
    since_d = (today - timedelta(days=365 * DAILY_YEARS)).isoformat()

    out = {'series': {}, 'curve': None}
    errors = []

    for key, fid, label, unit, freq, src in SERIES:
        since = since_m if freq in ('M', 'Q') else since_d
        try:
            d, v = fetch_series(fid, since)
        except Exception as e:                                # noqa: BLE001
            errors.append(u'%s：%s' % (fid, str(e)[:80]))
            log(u'  %-16s 失敗：%s' % (fid, str(e)[:80]))
            continue
        out['series'][key] = {'id': fid, 'label': label, 'unit': unit, 'freq': freq,
                              'src': src, 'd': d, 'v': v}
        log(u'  %-16s %5d 筆，最新 %s = %s' % (fid, len(d), d[-1], v[-1]))

    try:
        d, v = fetch_eia_weekly('WCESTUS1', since_d)
        out['series']['crude'] = {'id': 'WCESTUS1', 'label': u'原油商業庫存（不含戰略儲備）',
                                   'unit': u'千桶', 'freq': 'W', 'src': 'EIA', 'd': d, 'v': v}
        log(u'  %-16s %5d 筆，最新 %s = %s' % ('WCESTUS1 (EIA)', len(d), d[-1], v[-1]))
    except Exception as e:                                    # noqa: BLE001
        errors.append(u'WCESTUS1：%s' % str(e)[:80])
        log(u'  WCESTUS1 (EIA)   失敗：%s' % str(e)[:80])

    # 殖利率曲線：最新一天、約一個月前、約一年前。三條都以「最新一天」往回推，
    # 而不是各天期自己的最新 —— 天期之間偶爾差一天，混用會畫出不存在的曲線。
    curves = {}
    for tenor, fid in TENORS:
        try:
            curves[tenor] = fetch_series(fid, since_d if tenor in KEEP_HISTORY
                                         else (today - timedelta(days=400)).isoformat())
        except Exception as e:                                # noqa: BLE001
            errors.append(u'%s：%s' % (fid, str(e)[:80]))
            log(u'  %-16s 失敗：%s' % (fid, str(e)[:80]))
    if len(curves) >= 6:
        latest = min(c[0][-1] for c in curves.values())
        points = {
            'now': latest,
            'm1': (date.fromisoformat(latest) - timedelta(days=30)).isoformat(),
            'y1': (date.fromisoformat(latest) - timedelta(days=365)).isoformat(),
        }
        curve = {'tenors': [t for t, _ in TENORS if t in curves], 'dates': {}}
        for name, day in points.items():
            vals, when = [], None
            for t in curve['tenors']:
                hit = value_on_or_before(curves[t][0], curves[t][1], day)
                vals.append(hit[1] if hit else None)
                if hit and (when is None or hit[0] > when):
                    when = hit[0]
            curve[name] = vals
            curve['dates'][name] = when
        out['curve'] = curve
        log(u'  殖利率曲線 %s：%s' % (latest, curve['now']))
    for tenor, key in KEEP_HISTORY.items():
        if tenor in curves:
            d, v = curves[tenor]
            out['series'][key] = {'id': dict(TENORS)[tenor], 'label': u'%s 公債殖利率' % tenor,
                                  'unit': '%', 'freq': 'D', 'src': 'Fed', 'd': d, 'v': v}

    if not out['series']:
        log(u'一條數列都沒抓到，不寫出')
        sys.exit(1)

    out['meta'] = {
        'updated': today.isoformat(),
        'source': u'FRED（聖路易聯邦準備銀行）彙整之美國政府機關數列：'
                  u'勞工統計局、經濟分析局、勞工部、聯準會、能源資訊署',
        'errors': errors,
    }
    d = os.path.dirname(OUT)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    log(u'寫出 %s：%d 條數列%s' % (OUT, len(out['series']),
                                  u'，%d 條失敗' % len(errors) if errors else ''))


if __name__ == '__main__':
    main()
