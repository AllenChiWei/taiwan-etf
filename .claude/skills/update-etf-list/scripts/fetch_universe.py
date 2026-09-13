# -*- coding: utf-8 -*-
"""Step 1 - build the list of currently-listed Taiwan ETFs.

Writes universe.tsv (code<TAB>short name<TAB>twse|tpex) into the work directory.

Sources, in order of authority:
  TWSE  openapi t187ap47_L          -> every TWSE ETF ever listed (includes dead ones)
  TWSE  openapi STOCK_DAY_ALL       -> what actually traded on the latest session
  TPEx  openapi tpex_securities     -> TPEx securities (day-trade eligibility list)
  FinMind TaiwanStockInfo + price   -> sweep for anything the two above missed

t187ap47_L keeps liquidated funds forever, so it is intersected with STOCK_DAY_ALL.
That intersection would also drop a listed-but-zero-volume ETF, and tpex_securities
omits some TPEx classes (it is really a day-trading eligibility list - this is how
00687C went missing), so the FinMind sweep at the end is not optional: it price-checks
every ETF code the exchanges did not confirm and re-adds the ones still trading.
"""
import json, io, os, re, sys, time, datetime
from urllib.request import Request, urlopen

UA = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}
WORK = sys.argv[1] if len(sys.argv) > 1 else '.'

TWSE_ETF_INFO = 'https://openapi.twse.com.tw/v1/opendata/t187ap47_L'
TWSE_DAY_ALL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
TPEX_SECURITIES = 'https://www.tpex.org.tw/openapi/v1/tpex_securities'
FINMIND = 'https://api.finmindtrade.com/api/v4/data'

K_CODE = u'基金代號'        # 基金代號
K_ABBR = u'基金簡稱'        # 基金簡稱
K_TCODE = u'證券代號'       # 證券代號
K_TNAME = u'證券名稱'       # 證券名稱


def _ctx():
    """Anaconda's bundled CA store is missing the intermediate TPEx serves, so a
    plain urlopen dies with CERTIFICATE_VERIFY_FAILED on www.tpex.org.tw while curl
    is fine. Prefer certifi; fall back to unverified (these are public, read-only
    open-data endpoints and nothing is sent to them)."""
    import ssl
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return None


_VERIFIED, _UNVERIFIED = _ctx(), None


def get_json(url, tries=3):
    global _UNVERIFIED
    for i in range(tries):
        try:
            return json.loads(urlopen(Request(url, headers=UA), timeout=90,
                                      context=_VERIFIED).read().decode('utf-8'))
        except Exception as e:
            if 'CERTIFICATE_VERIFY_FAILED' in str(e):
                if _UNVERIFIED is None:
                    import ssl
                    _UNVERIFIED = ssl._create_unverified_context()
                    print('  note: falling back to unverified TLS for %s'
                          % url.split('/')[2])
                try:
                    return json.loads(urlopen(Request(url, headers=UA), timeout=90,
                                              context=_UNVERIFIED).read().decode('utf-8'))
                except Exception:
                    pass
            if i == tries - 1:
                raise
            time.sleep(3)


def main():
    p = lambda f: os.path.join(WORK, f)

    day_all = get_json(TWSE_DAY_ALL)
    traded = dict((x['Code'], x['Name']) for x in day_all)
    print('TWSE securities traded on latest session: %d' % len(traded))

    etf_info = get_json(TWSE_ETF_INFO)
    print('TWSE ETF registry (incl. delisted): %d' % len(etf_info))

    uni = {}
    for x in etf_info:
        c = x[K_CODE].strip()
        if c in traded:                       # drops liquidated funds still in the registry
            uni[c] = (traded[c], 'twse')      # STOCK_DAY_ALL carries the short trading name
    print('TWSE ETFs still trading: %d' % len(uni))

    for x in get_json(TPEX_SECURITIES):
        c = (x.get(K_TCODE) or '').strip()
        if re.match(r'^0\d{4}', c):           # ETF codes: 00xxx / 0xxxxx
            uni[c] = (x[K_TNAME].strip(), 'tpex')
    print('after TPEx: %d' % len(uni))

    # ---- FinMind sweep for anything the exchange feeds missed -------------
    info = get_json(FINMIND + '?dataset=TaiwanStockInfo')['data']
    known = {}
    for x in info:
        if 'ETF' in x['industry_category']:
            known.setdefault(x['stock_id'], x)
    cand = [c for c in known if c not in uni]
    print('price-checking %d codes the exchanges did not confirm...' % len(cand))

    today = datetime.date.today()
    start = (today - datetime.timedelta(days=20)).isoformat()
    added = []
    for c in cand:
        url = ('%s?dataset=TaiwanStockPrice&data_id=%s&start_date=%s&end_date=%s'
               % (FINMIND, c, start, today.isoformat()))
        try:
            rows = get_json(url, tries=2).get('data', [])
        except Exception as e:
            print('  WARN %s: %s' % (c, e))
            continue
        if rows:
            uni[c] = (known[c]['stock_name'], known[c]['type'])
            added.append(c)
        time.sleep(0.4)
    if added:
        print('sweep re-added %d: %s' % (len(added), ', '.join(sorted(added))))

    out = io.open(p('universe.tsv'), 'w', encoding='utf-8')
    for c in sorted(uni):
        out.write(u'%s\t%s\t%s\n' % (c, uni[c][0], uni[c][1]))
    out.close()
    print('universe.tsv: %d ETFs (%d bond-suffix)'
          % (len(uni), sum(1 for c in uni if c.endswith('B'))))


main()
