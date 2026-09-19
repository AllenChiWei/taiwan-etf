# -*- coding: utf-8 -*-
"""Step 2b - fetch each ETF's MoneyDJ 報酬分析 page (Basic0008) for period returns.

    python scrape_returns.py <workdir>

Reads <workdir>/universe.tsv, writes <workdir>/returns/<CODE>.html.
Same resume-on-rerun behaviour as scrape_moneydj.py: existing files are skipped.

Returns move every trading day, so DELETE <workdir>/returns before a refresh whose
point is up-to-date performance numbers. Keeping them is only right when you are
adding newly listed ETFs and deliberately leaving the rest untouched.
"""
import io, os, sys, time, random
from urllib.request import Request, urlopen

# 表明身分而不是假裝成瀏覽器 —— 對方要擋或要聯絡都找得到人。
# 實測 MoneyDJ 對這個 UA 與瀏覽器 UA 回應完全一樣（同一頁、同樣的欄位）。
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) ETF returns')
URL = 'https://www.moneydj.com/ETF/X/Basic/Basic0008.xdjhtm?etfid=%s.tw'
MIN_BYTES = 20000

WORK = sys.argv[1] if len(sys.argv) > 1 else '.'
dest_dir = os.path.join(WORK, 'returns')
if not os.path.isdir(dest_dir):
    os.makedirs(dest_dir)

codes = [l.split('\t')[0] for l in io.open(os.path.join(WORK, 'universe.tsv'), encoding='utf-8')
         if l.strip()]
ok = fail = skip = 0
errors = []
for n, c in enumerate(codes, 1):
    dest = os.path.join(dest_dir, c + '.html')
    if os.path.exists(dest) and os.path.getsize(dest) > MIN_BYTES:
        skip += 1
        continue
    for attempt in range(3):
        try:
            data = urlopen(Request(URL % c.lower(), headers={'User-Agent': UA,
                                                             'Accept-Language': 'zh-TW'}),
                           timeout=30).read()
            if len(data) < MIN_BYTES:
                raise IOError('short response %d bytes' % len(data))
            open(dest, 'wb').write(data)
            ok += 1
            break
        except Exception as e:
            if attempt == 2:
                fail += 1
                errors.append(u'%s %s' % (c, e))
            time.sleep(2)
    if n % 50 == 0:
        print('  %d/%d' % (n, len(codes)))
    time.sleep(0.6 + random.random() * 0.5)

if errors:
    io.open(os.path.join(WORK, 'returns_errors.txt'), 'w', encoding='utf-8').write(u'\n'.join(errors))
print('returns ok=%d fail=%d skip=%d' % (ok, fail, skip))
if fail:
    sys.exit('%d pages failed - see returns_errors.txt, re-run to retry just those' % fail)
