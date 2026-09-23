# -*- coding: utf-8 -*-
u"""小台／微台的散戶未平倉（推算），逐日累積，外加加權指數收盤。

    python scripts/fetch_retail.py [--backfill]

寫到 app/public/data/retail.json，**進版控**（每天兩列，一年約 20 KB）。

## 為什麼要累積

籌碼頁的散戶卡片用的是 chips.json 那 120 天，夠畫走勢，但不夠回答「散戶多空比
到底有沒有參考價值」—— 那要幾百個交易日跟之後的指數走勢放在一起看。

而期交所的三大法人端點**只保留約三年**（2026-09 實測，2023-09-22 以前查不到），
所以跟價平和一樣逐日累積：第一次執行把查得到的全部補回來，之後每天只補新的，
三年前的資料就不會隨著期交所的視窗一起消失。

## 算法（與 fetch_chips.py 相同）

    散戶多單 = 全市場未沖銷 − 三大法人多方未平倉
    散戶空單 = 全市場未沖銷 − 三大法人空方未平倉

每天每個契約存 [全市場未沖銷, 三大法人多方合計, 三大法人空方合計]，推算留給前端，
免得哪天要改定義時得重抓。全市場未沖銷取一般時段、含週契約、排除價差列。

三大法人端點用 commodityId 只查單一契約：小台是 **MXF**（不是行情檔裡的 MTX），
微台是 TMF。查錯代號時期交所回一頁 HTML，不是空的 CSV。

加權指數收盤沿用 fetch_atm.py 的 FinMind 抓法（一個請求給完整歷史）。
"""
import io
import json
import os
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_chips as fc                                       # noqa: E402
import fetch_atm                                               # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'retail.json')

# 行情檔代號 -> (三大法人端點的代號, 契約名稱)
CONTRACTS = {
    'MTX': ('MXF', u'小型臺指期貨'),
    'TMF': ('TMF', u'微型臺指期貨'),
}
# 上市日。微台 2024-07-29 才掛牌，更早的區間期交所回 HTML（每段還會重試三次），
# 回補時從上市日開始問，不要白打那十幾個請求
LISTED = {'TMF': date(2024, 7, 29)}
# 期交所查得到的最早日期大約是今天往回三年。區間只要有一天超出，整段都回 HTML，
# 所以寧可少問幾天，也不要讓第一段整段被拒
BACKFILL_DAYS = 3 * 365 - 10
# 每天重抓最近幾天：期交所偶爾晚一點才補齊當天的資料
OVERLAP_DAYS = 7


def institutional(commodity, a, b):
    u"""{交易日: (三大法人多方合計, 空方合計)}。三家都在才算，少一家寧可沒有。"""
    by_day = {}
    rows = fc.fetch_csv('futContractsDateDown', {
        'firstDate': '', 'lastDate': '', 'commodityId': commodity,
        'queryStartDate': a, 'queryEndDate': b})
    for c in rows:
        if len(c) < 15:
            continue
        who = fc.WHO.get(c[2], c[2])
        by_day.setdefault(fc.iso(c[0]), {})[who] = (fc.num(c[9]), fc.num(c[11]))
    out = {}
    for day, whos in by_day.items():
        if all(w in whos for w in fc.WHO_ORDER):
            out[day] = (sum(v[0] for v in whos.values()),
                        sum(v[1] for v in whos.values()))
    return out


def market(cid, a, b):
    return fc.market_oi(fc.fetch_csv('futDataDown', {
        'down_type': '1', 'commodity_id': cid, 'commodity_id2': '',
        'queryStartDate': a, 'queryEndDate': b}))


def main():
    full = '--backfill' in sys.argv[1:]
    doc = {}
    if os.path.exists(OUT):
        try:
            doc = json.load(io.open(OUT, encoding='utf-8'))
        except Exception as e:                                # noqa: BLE001
            fc.note(u'既有的 retail.json 讀不起來（%s），這次重建' % str(e)[:60])
            doc = {}
    data = doc.get('contracts') or {}

    last = fc.latest_available_date()
    if last is None:
        return 1
    added = 0
    for cid, (inst_id, name) in sorted(CONTRACTS.items()):
        entry = data.setdefault(cid, {'name': name, 'days': {}})
        days = entry['days']
        if full or not days:
            start = max(last - timedelta(days=BACKFILL_DAYS),
                        LISTED.get(cid, date.min))
        else:
            start = datetime.strptime(max(days), '%Y-%m-%d').date() \
                - timedelta(days=OVERLAP_DAYS)
        spans = fc.windows((last - start).days, fc.WINDOW_DAYS, last)
        fc.log(u'%s：%s 起，%d 段' % (name, start.isoformat(), len(spans)))
        for a, b in spans:
            inst = institutional(inst_id, a, b)
            if not inst:
                continue
            oi = market(cid, a, b)
            for day, (bn, sn) in inst.items():
                total = oi.get(day)
                # 全市場量比任一邊的法人合計還小，代表那天的行情檔不完整 —— 寧可不收
                if not total or total < bn or total < sn:
                    continue
                if day not in days:
                    added += 1
                days[day] = [total, bn, sn]
        entry['days'] = dict(sorted(days.items()))
        fc.log(u'  共 %d 天' % len(entry['days']))

    all_days = set()
    for entry in data.values():
        all_days.update(entry['days'])
    taiex = dict(doc.get('taiex') or {})
    n_idx = fetch_atm.fill_taiex(taiex, all_days)

    payload = {
        'meta': {
            'updated': datetime.now(fc.TPE).date().isoformat(),
            'latest': max(all_days) if all_days else None,
            'source': u'臺灣期貨交易所（三大法人各期貨契約、期貨每日交易行情）；'
                      u'加權指數：FinMind',
            'note': (u'days 每列是 [全市場未沖銷口數, 三大法人多方未平倉合計, 空方合計]。'
                     u'散戶多單＝全市場−法人多方，散戶空單＝全市場−法人空方。'),
            'errors': fc.ERRORS + fetch_atm.ERRORS,
        },
        'contracts': data,
        'taiex': dict(sorted(taiex.items())),
    }
    fc.write_json(OUT, payload)
    fc.log(u'完成：%s（新增 %d 天；指數 +%d 天；%.0f KB）'
           % (OUT, added, n_idx, os.path.getsize(OUT) / 1024.0))
    return 0 if all_days else 1


if __name__ == '__main__':
    sys.exit(main())
