# -*- coding: utf-8 -*-
u"""Structural checks on us_etfs.json, plus a regression diff against the previous one.

    python scripts/verify_us_data.py app/public/data/us_etfs.json [previous.json]

Same role as verify_data.py on the Taiwan side: the gate that stops an unattended run from
replacing good data with something emptier.

The delisting rule is looser here than for Taiwan. US ETFs close all the time — a few dozen
a year is normal — so a vanished row is a warning, not a failure. A large *drop in total*
still fails, because that means the feed broke rather than that funds closed.
"""
import io
import json
import os
import sys
import collections

CUR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    'app', 'public', 'data', 'us_etfs.json')
PREV = sys.argv[2] if len(sys.argv) > 2 else None

DROP_TOLERANCE = 0.05          # 一次少掉 5% 以上就是來源壞了，不是 ETF 集體下市
REQUIRED = ['code', 'name', 'exch', 'r3', 'r6', 'r12', 'r36', 'r60', 'adv', 'liquid']

fails, warns = [], []


def load(path):
    try:
        return json.load(io.open(path, encoding='utf-8'))
    except Exception as e:
        sys.exit('cannot read %s: %s' % (path, e))


doc = load(CUR)

for key in ('meta', 'etfs'):
    if key not in doc:
        fails.append('missing top-level key: %s' % key)
if fails:
    print('\n'.join(fails))
    sys.exit(1)

etfs, meta = doc['etfs'], doc['meta']

if not etfs:
    fails.append('etfs list is empty')

for i, e in enumerate(etfs):
    for f in REQUIRED:
        if f not in e:
            fails.append('etfs[%d] (%s) missing field %s' % (i, e.get('code', '?'), f))
            break

dupes = [c for c, n in collections.Counter(e['code'] for e in etfs).items() if n > 1]
if dupes:
    fails.append('duplicate codes: %s' % sorted(dupes)[:10])

if meta.get('total') != len(etfs):
    fails.append('meta.total=%s but there are %d rows' % (meta.get('total'), len(etfs)))

# liquid 旗標必須與宣告的門檻一致，否則前端的預設篩選會和說明文字對不上。
# 只驗一個方向：liquid 的一定過得了金額門檻。反向不成立 —— 歷史不足
# LIQUID_MIN_DAYS 的標的就算金額夠也不標 liquid（見 fetch_us_etfs.py），
# 而歷史長度不在 JSON 裡，這裡驗不了。
threshold = meta.get('liquidMinAdv')
if not isinstance(threshold, int) or threshold <= 0:
    fails.append('meta.liquidMinAdv is missing or not a positive int: %r' % threshold)
else:
    bad = [e['code'] for e in etfs if e['liquid'] and e['adv'] < threshold]
    if bad:
        fails.append('%d row(s) flagged liquid below meta.liquidMinAdv: %s'
                     % (len(bad), bad[:5]))
    declared = meta.get('liquid')
    actual = sum(1 for e in etfs if e['liquid'])
    if declared != actual:
        fails.append('meta.liquid=%s but %d rows are flagged liquid' % (declared, actual))


def numeric_ok(v):
    if v == 'N/A':
        return True
    try:
        float(str(v).replace(',', ''))
        return True
    except ValueError:
        return False


for e in etfs:
    for f in ('r3', 'r6', 'r12', 'r36', 'r60'):
        if not numeric_ok(e[f]):
            fails.append('%s has unparsable %s=%r' % (e['code'], f, e[f]))
    if not isinstance(e['adv'], int) or e['adv'] < 0:
        fails.append('%s has a bad adv=%r' % (e['code'], e['adv']))

# 整欄都是 N/A 代表報酬率沒算出來
for f in ('r3', 'r12'):
    have = sum(1 for e in etfs if e[f] != 'N/A')
    if have == 0:
        fails.append('every %s is N/A - the return calculation produced nothing' % f)

# 有流動性的標的幾乎都該有近3月報酬；大量缺漏代表價格矩陣有問題
liq = [e for e in etfs if e['liquid']]
if liq:
    missing_r3 = sum(1 for e in liq if e['r3'] == 'N/A')
    if missing_r3 > len(liq) * 0.1:
        fails.append('%d of %d liquid ETFs have no 3-month return (>10%%)'
                     % (missing_r3, len(liq)))

if PREV and os.path.exists(PREV):
    prev = load(PREV)
    pcodes = set(e['code'] for e in prev.get('etfs', []))
    ccodes = set(e['code'] for e in etfs)

    gone = sorted(pcodes - ccodes)
    if gone:
        # 美股 ETF 清算是常態，只提醒
        warns.append('%d row(s) gone: %s%s'
                     % (len(gone), ', '.join(gone[:8]), '…' if len(gone) > 8 else ''))
    added = sorted(ccodes - pcodes)
    if added:
        warns.append('%d new: %s%s'
                     % (len(added), ', '.join(added[:8]), '…' if len(added) > 8 else ''))

    if pcodes:
        drop = (len(pcodes) - len(ccodes)) / float(len(pcodes))
        if drop > DROP_TOLERANCE:
            fails.append('total fell %.1f%% (%d -> %d), above the %.0f%% tolerance'
                         % (drop * 100, len(pcodes), len(ccodes), DROP_TOLERANCE * 100))

print('%s: %d ETFs (%d liquid, threshold $%s)  asof=%s'
      % (CUR, len(etfs), sum(1 for e in etfs if e['liquid']),
         format(threshold or 0, ','), meta.get('asof')))
print('with 3m return: %d   with 3y return: %d'
      % (sum(1 for e in etfs if e['r3'] != 'N/A'),
         sum(1 for e in etfs if e['r36'] != 'N/A')))

for w in warns:
    print('NOTE: %s' % w)

if fails:
    print('')
    for f in fails:
        print('FAIL: %s' % f)
    sys.exit('%d check(s) failed' % len(fails))

print('OK - all checks passed')
