# -*- coding: utf-8 -*-
u"""Step 3 - turn the scraped pages into the React app's etfs.json.

    python scripts/build_data.py <workdir> [out.json]

Replaces the old build_page.py: the site now renders from JSON, so this writes data
only - no HTML, no CSS, no splicing. Idempotent.

Existing codes keep the section they already have (read from the previous JSON), so a
curated placement such as 00735 國泰臺韓科技 sitting in 海外 survives a rebuild. Only
codes that are new get classified by the rule in etfdata.section().
"""
import io, os, re, sys, json, datetime, collections

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from etfdata import (DASH, FREQ_CLASS, FREQ_ORDER, SECTIONS, RETURN_PERIODS,
                     load_rows)

WORK = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = (sys.argv[2] if len(sys.argv) > 2
       else os.path.join('app', 'public', 'data', 'etfs.json'))

# MoneyDJ 的期間欄位 -> JSON 欄位名。順序由 etfdata.RETURN_PERIODS 決定。
PERIOD_KEY = {u'三個月': 'r3', u'六個月': 'r6', u'一年': 'r12',
              u'三年': 'r36', u'五年': 'r60'}


def previous_sections(path):
    u"""{code: section_id} from the JSON already on disk; {} on a first build."""
    if not os.path.exists(path):
        return {}
    try:
        doc = json.load(io.open(path, encoding='utf-8'))
    except ValueError as e:
        sys.exit('%s is not valid JSON (%s) - fix or delete it before rebuilding' % (path, e))
    return dict((e['code'], e['sec']) for e in doc.get('etfs', []) if e.get('sec'))


def main():
    universe_path = os.path.join(WORK, 'universe.tsv')
    if not os.path.exists(universe_path):
        sys.exit('%s not found - run fetch_universe.py first' % universe_path)

    universe = [l.rstrip('\n').split('\t')
                for l in io.open(universe_path, encoding='utf-8') if l.strip()]

    rows, missing, no_ret, ret_asof, yld_asof = load_rows(
        WORK, universe, previous_sections(OUT))

    if missing:
        sys.exit('no MoneyDJ page for %d codes (%s) - run scrape_moneydj.py first'
                 % (len(missing), ', '.join(missing[:10])))
    if no_ret:
        print('WARNING: no return data for %d codes (%s%s) - their cells show N/A'
              % (len(no_ret), ', '.join(no_ret[:10]), '...' if len(no_ret) > 10 else ''))

    unknown = sorted(set(r['freq'] for r in rows) - set(FREQ_CLASS))
    if unknown:
        sys.exit(u'unknown payout label(s) %s - add them to FREQ_CLASS/FREQ_ORDER in '
                 u'etfdata.py, add a .pill-* rule to app/src/styles.css, and add the '
                 u'label to PILL in app/src/lib/format.ts plus FreqLabel in app/src/types.ts'
                 % unknown)

    stray = set(r['sec'] for r in rows) - set(s for s, _ in SECTIONS)
    if stray:
        sys.exit('rows landed in unknown section(s): %s' % sorted(stray))

    order = dict((s, i) for i, (s, _) in enumerate(SECTIONS))
    rows.sort(key=lambda r: (order[r['sec']], r['code']))

    counts = collections.Counter(r['sec'] for r in rows)

    etfs = []
    for r in rows:
        e = {
            'code': r['code'],
            'name': r['name'],
            'cust': r['cust'],
            'freq': r['freq'],
            'yield': r['yield'],
            'sec': r['sec'],
        }
        for period, key in PERIOD_KEY.items():
            e[key] = r['ret'].get(period) or 'N/A'
        etfs.append(e)

    doc = {
        'meta': {
            'updated': datetime.date.today().isoformat(),
            'snapshot': ret_asof or yld_asof or '',
            'total': len(etfs),
            'source': u'TWSE / TPEx / MoneyDJ',
            'generated_by': 'build_data.py',
        },
        'sections': [{'id': s, 'title': t, 'count': counts.get(s, 0)} for s, t in SECTIONS],
        'custodians': sorted(set(r['cust'] for r in rows) - set([DASH])),
        'frequencies': [f for f in FREQ_ORDER if f in set(r['freq'] for r in rows)]
                       + ([DASH] if any(r['freq'] == DASH for r in rows) else []),
        'etfs': etfs,
    }

    d = os.path.dirname(OUT)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(doc, ensure_ascii=False, separators=(',', ':'), sort_keys=False))

    print('%s: %d ETFs  %s' % (OUT, len(etfs),
          '  '.join('%s=%d' % (s, counts.get(s, 0)) for s, _ in SECTIONS)))
    print('custodians=%d  returns as-of=%s  yield as-of=%s'
          % (len(doc['custodians']), ret_asof or 'none', yld_asof or 'none'))
    print('N/A cells: returns=%d  yield=%d'
          % (sum(1 for e in etfs for k in PERIOD_KEY.values() if e[k] == 'N/A'),
             sum(1 for e in etfs if e['yield'] == 'N/A')))


main()
