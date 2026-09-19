# -*- coding: utf-8 -*-
"""Step 2 - fetch each ETF's MoneyDJ Basic0004 page (custodian bank + payout frequency).

    python scrape_moneydj.py <workdir>

Reads <workdir>/universe.tsv, writes <workdir>/pages/<CODE>.html.
Already-downloaded pages are skipped, so re-running resumes a partial fetch;
delete pages/ to force a full refresh.

Basic0004 is the same page the list already links to, and it is the only source
checked here that carries BOTH 保管機構 and 配息頻率. Be polite: ~1 req/sec.
"""
import io, os, sys, time, random
from urllib.request import Request, urlopen

# 表明身分而不是假裝成瀏覽器 —— 對方要擋或要聯絡都找得到人。
# 實測 MoneyDJ 對這個 UA 與瀏覽器 UA 回應完全一樣（同一頁、同樣的欄位）。
UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) ETF custodian and payout frequency')
URL = 'https://www.moneydj.com/ETF/X/Basic/Basic0004.xdjhtm?etfid=%s.tw'
MIN_BYTES = 20000          # a real page is ~55-65 KB; anything smaller is an error page

WORK = sys.argv[1] if len(sys.argv) > 1 else '.'
pages = os.path.join(WORK, 'pages')
if not os.path.isdir(pages):
    os.makedirs(pages)

codes = [l.split('\t')[0] for l in io.open(os.path.join(WORK, 'universe.tsv'), encoding='utf-8')
         if l.strip()]
ok = fail = skip = 0
errors = []
for n, c in enumerate(codes, 1):
    dest = os.path.join(pages, c + '.html')
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
    io.open(os.path.join(WORK, 'scrape_errors.txt'), 'w', encoding='utf-8').write(u'\n'.join(errors))
print('scraped ok=%d fail=%d skip=%d' % (ok, fail, skip))
if fail:
    sys.exit('%d pages failed - see scrape_errors.txt, re-run to retry just those' % fail)
