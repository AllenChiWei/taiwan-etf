# -*- coding: utf-8 -*-
u"""驗證 app/public/data/etf_holdings.json（被動式 ETF 全部持股）。

    python scripts/verify_etf_holdings.py [app/public/data/etf_holdings.json]

檢查項目：
1. 結構與欄位合法（asof、src、basis、holdings 格式與權重範圍）。
2. 成功抓到投信 PCF 的檔數達到下限（預設台股至少 15 檔）。
3. 台股股票型 ETF（cat-domestic、投信 PCF）權重合計落在 80%～105%。
4. PCF 的 asof 不可早於最近交易日 5 個交易日以上（早於記警告；台股大面積過舊時判失敗）。
5. 與公會月報前十大（top10.json）的前 3 名代號大致一致（跨月允許小幅排名互換，
   平均一致率 >= 65%）；0050 若在清單內，第 1 名必須是 2330 且成分股 >= 45 檔。
"""
import io
import json
import os
import re
import sys
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PATH = os.path.join(ROOT, 'app', 'public', 'data', 'etf_holdings.json')
DEFAULT_ETFS = os.path.join(ROOT, 'app', 'public', 'data', 'etfs.json')
DEFAULT_TOP10 = os.path.join(ROOT, 'app', 'public', 'data', 'top10.json')

VALID_BASIS = ('weight', 'qty', 'quarterly1pct')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
QUARTER_RE = re.compile(r'^\d{4}Q[1-4]$')
MAX_STALE_TRADING_DAYS = 5


def _ensure_utf8_stdio():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            try:
                stream.reconfigure(encoding='utf-8', errors='replace')
            except Exception:                                 # noqa: BLE001
                pass


def _emit(msg, stream=None):
    out = stream or sys.stdout
    try:
        print(msg, file=out, flush=True)
    except UnicodeEncodeError:
        enc = getattr(out, 'encoding', None) or 'ascii'
        print(str(msg).encode(enc, 'replace').decode(enc, 'replace'), file=out, flush=True)


def latest_weekday(d):
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def trading_days_behind(asof_str, ref_date):
    u"""計算 asof_str（不含）到 ref_date（含）之間的工作日（週一～週五）數。"""
    try:
        a = date.fromisoformat(str(asof_str or ''))
        b = ref_date if isinstance(ref_date, date) else date.fromisoformat(str(ref_date))
    except ValueError:
        return 0
    if b <= a:
        return 0
    cnt = 0
    cur = a + timedelta(days=1)
    while cur <= b:
        if cur.weekday() < 5:
            cnt += 1
        cur += timedelta(days=1)
    return cnt


def verify(doc, etfs_doc, top10_doc=None, min_domestic_pcf=15, min_top3_overlap=0.65,
           ref_date=None, max_stale_days=MAX_STALE_TRADING_DAYS):
    u"""純驗證函式，回傳 (errors, warnings, stats)。"""
    errors, warnings = [], []
    if not isinstance(doc, dict) or not isinstance(doc.get('etfs'), dict) or not isinstance(doc.get('meta'), dict):
        return [u'頂層缺少 meta 或 etfs 物件'], warnings, {}

    sec_of = dict((e['code'], e.get('sec', '')) for e in (etfs_doc.get('etfs') or []))
    top10_etfs = (top10_doc or {}).get('etfs') or {}

    pcf_dates = [
        str(e.get('asof') or '')
        for e in doc['etfs'].values()
        if isinstance(e, dict) and e.get('basis') != 'quarterly1pct' and DATE_RE.match(str(e.get('asof') or ''))
    ]
    max_pcf_asof = max(pcf_dates) if pcf_dates else None
    updated_str = str((doc.get('meta') or {}).get('updated') or '')
    updated_wd = None
    if DATE_RE.match(updated_str):
        try:
            updated_wd = latest_weekday(date.fromisoformat(updated_str))
        except ValueError:
            updated_wd = None

    if ref_date is not None:
        ref = ref_date if isinstance(ref_date, date) else date.fromisoformat(str(ref_date))
    elif max_pcf_asof:
        ref = date.fromisoformat(max_pcf_asof)
    elif updated_wd:
        ref = updated_wd
    else:
        ref = None

    if ref and updated_wd and trading_days_behind(ref.isoformat(), updated_wd) > 10:
        warnings.append(u'全部 PCF 最新日期 %s 落後更新日 %s 超過 10 個交易日' % (ref.isoformat(), updated_wd.isoformat()))

    pcf_total = 0
    domestic_pcf = 0
    quarterly_total = 0
    overlap_scores = []
    stale_pcf = []
    stale_domestic = []

    for code, e in doc['etfs'].items():
        if not isinstance(e, dict):
            errors.append(u'%s：資料不是物件' % code)
            continue
        basis = e.get('basis')
        asof = str(e.get('asof') or '')
        rows = e.get('holdings')
        if basis not in VALID_BASIS:
            errors.append(u'%s：無效的 basis=%r' % (code, basis))
            continue
        if basis == 'quarterly1pct':
            if not QUARTER_RE.match(asof):
                errors.append(u'%s：季報 asof 格式不正確（%r）' % (code, asof))
            quarterly_total += 1
        else:
            if not DATE_RE.match(asof):
                errors.append(u'%s：PCF asof 格式不正確（%r）' % (code, asof))
            pcf_total += 1
        if not e.get('src'):
            errors.append(u'%s：缺少 src 來源說明' % code)
        if not isinstance(rows, list) or not rows:
            errors.append(u'%s：holdings 為空' % code)
            continue

        total_w = 0.0
        bad_row = False
        for r in rows:
            if not isinstance(r, list) or len(r) < 4 or not str(r[0]).strip():
                errors.append(u'%s：holdings 列格式錯誤 %r' % (code, r))
                bad_row = True
                break
            w = r[3]
            if not isinstance(w, (int, float)) or w <= 0 or w > 100:
                errors.append(u'%s %s：權重異常（%r）' % (code, r[0], w))
                bad_row = True
                break
            total_w += float(w)
        if bad_row:
            continue

        sec = sec_of.get(code, '')
        if basis != 'quarterly1pct' and ref and DATE_RE.match(asof):
            lag = trading_days_behind(asof, ref)
            if lag > max_stale_days:
                stale_pcf.append(code)
                if sec == 'cat-domestic':
                    stale_domestic.append(code)
                warnings.append(u'%s：PCF 日期 %s 早於最近交易日 %s 達 %d 個交易日（超過 %d 日）' % (
                    code, asof, ref.isoformat(), lag, max_stale_days))
        if basis != 'quarterly1pct' and sec == 'cat-domestic':
            domestic_pcf += 1
            if not (80.0 <= total_w <= 105.0):
                errors.append(u'%s（台股 PCF）：權重合計 %.2f%% 超出 80%%～105%%' % (code, total_w))
        elif basis != 'quarterly1pct' and sec == 'cat-foreign':
            if not (50.0 <= total_w <= 108.0):
                warnings.append(u'%s（海外 PCF）：權重合計 %.2f%% 偏離常態' % (code, total_w))
        elif basis == 'quarterly1pct':
            if not (5.0 <= total_w <= 105.0):
                warnings.append(u'%s（季報 1%%↑）：權重合計 %.2f%% 偏離常態' % (code, total_w))

        # 與公會月報前十大比對前 3 名代號（僅限台股 PCF）
        if basis != 'quarterly1pct' and sec == 'cat-domestic' and code in top10_etfs:
            m_rows = [r for r in (top10_etfs[code].get('rows') or []) if r[2] and (r[4] or 0) > 0]
            if len(m_rows) >= 3:
                m_top3 = [str(r[2]).strip() for r in m_rows[:3]]
                p_top5 = set(str(r[0]).strip() for r in rows[:5])
                hit = sum(1 for c in m_top3 if c in p_top5)
                overlap_scores.append(hit / 3.0)
                if hit == 0:
                    warnings.append(u'%s：與月報前 3 名（%s）完全無交集' % (code, ','.join(m_top3)))

    if domestic_pcf < min_domestic_pcf:
        errors.append(u'台股 PCF 成功檔數不足：%d 檔（至少需 %d 檔）' % (domestic_pcf, min_domestic_pcf))

    if len(stale_domestic) >= 3:
        errors.append(u'台股 PCF 過舊檔數過多（%d 檔早於 %s 超過 %d 個交易日：%s）' % (
            len(stale_domestic), ref.isoformat() if ref else '', max_stale_days, ','.join(stale_domestic[:8])))

    avg_overlap = (sum(overlap_scores) / len(overlap_scores)) if overlap_scores else None
    if avg_overlap is not None and avg_overlap < min_top3_overlap:
        errors.append(u'與公會月報前 3 名平均一致率過低：%.1f%%（門檻 %.0f%%）' % (
            avg_overlap * 100.0, min_top3_overlap * 100.0))

    # 指標股抽檢：0050 若存在，第 1 名必為 2330 且至少 45 檔
    e0050 = doc['etfs'].get('0050')
    if e0050 and e0050.get('basis') != 'quarterly1pct':
        h0050 = e0050.get('holdings') or []
        if not h0050 or h0050[0][0] != '2330':
            errors.append(u'0050 第一大持股應為 2330，實際為 %r' % (h0050[0][0] if h0050 else None))
        if len(h0050) < 45:
            errors.append(u'0050 成分股過少（%d 檔，預期約 50 檔）' % len(h0050))

    stats = {
        'pcfTotal': pcf_total,
        'domesticPcf': domestic_pcf,
        'quarterlyTotal': quarterly_total,
        'stalePcf': stale_pcf,
        'refDate': ref.isoformat() if ref else None,
        'top3Compared': len(overlap_scores),
        'top3AvgOverlap': round(avg_overlap, 4) if avg_overlap is not None else None,
    }
    return errors, warnings, stats


def main(argv=None):
    _ensure_utf8_stdio()
    args = argv if argv is not None else sys.argv[1:]
    path = args[0] if args else DEFAULT_PATH
    if not os.path.exists(path):
        _emit(u'找不到檔案：%s' % path, sys.stderr)
        return 1
    doc = json.load(io.open(path, encoding='utf-8'))
    etfs_doc = json.load(io.open(DEFAULT_ETFS, encoding='utf-8')) if os.path.exists(DEFAULT_ETFS) else {'etfs': []}
    top10_doc = json.load(io.open(DEFAULT_TOP10, encoding='utf-8')) if os.path.exists(DEFAULT_TOP10) else None

    errors, warnings, stats = verify(doc, etfs_doc, top10_doc)
    for w in warnings:
        _emit(u'  ⚠ %s' % w)
    for e in errors:
        _emit(u'  ✗ %s' % e, sys.stderr)
    ov = (u'%.1f%%（比對 %d 檔）' % (stats['top3AvgOverlap'] * 100.0, stats['top3Compared'])
          if stats.get('top3AvgOverlap') is not None else u'無')
    _emit(u'%s：PCF %d 檔（台股 %d）、季報 %d 檔，前 3 名對照一致率 %s' % (
        u'OK' if not errors else u'FAIL',
        stats.get('pcfTotal', 0), stats.get('domesticPcf', 0), stats.get('quarterlyTotal', 0), ov))
    return 0 if not errors else 1


if __name__ == '__main__':
    sys.exit(main())
