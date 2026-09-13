# -*- coding: utf-8 -*-
u"""Step 4 - structural checks on etfs.json, plus a regression diff against the previous one.

    python scripts/verify_data.py app/public/data/etfs.json [previous.json]

This is the gate the daily workflow runs before committing. It exists because the update
runs unattended: a scrape that half-fails must not be allowed to overwrite good data with
a shorter, emptier table.

Fails (exit 1) on: malformed JSON, counts that disagree, a custodian or frequency with no
entry in the filter lists, an unstyleable payout label, duplicate codes, a row that
vanished, or a total that dropped more than DROP_TOLERANCE.
Renames, payout changes and new listings are printed for review, not failed on.
"""
import io, os, re, sys, json, collections

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from etfdata import DASH, FREQ_CLASS, SECTIONS

CUR = (sys.argv[1] if len(sys.argv) > 1
       else os.path.join('app', 'public', 'data', 'etfs.json'))
PREV = sys.argv[2] if len(sys.argv) > 2 else None

# A legitimate delisting or two is normal; losing 5% of the table in one run is a broken scrape.
DROP_TOLERANCE = 0.05

REQUIRED_FIELDS = ['code', 'name', 'cust', 'freq', 'yield', 'sec',
                   'r3', 'r6', 'r12', 'r36', 'r60']

fails = []
warns = []


def fail(msg):
    fails.append(msg)


def warn(msg):
    warns.append(msg)


def load(path):
    try:
        return json.load(io.open(path, encoding='utf-8'))
    except Exception as e:
        sys.exit('cannot read %s: %s' % (path, e))


doc = load(CUR)

# ---- shape -------------------------------------------------------------------
for key in ('meta', 'sections', 'custodians', 'frequencies', 'etfs'):
    if key not in doc:
        fail('missing top-level key: %s' % key)
if fails:
    print('\n'.join(fails))
    sys.exit(1)

etfs = doc['etfs']
meta = doc['meta']

if not etfs:
    fail('etfs list is empty')

for i, e in enumerate(etfs):
    for f in REQUIRED_FIELDS:
        if f not in e:
            fail('etfs[%d] (%s) missing field %s' % (i, e.get('code', '?'), f))
    if not str(e.get('code', '')).strip():
        fail('etfs[%d] has a blank code' % i)
    if not str(e.get('name', '')).strip():
        fail('%s has a blank name' % e.get('code'))

# ---- uniqueness --------------------------------------------------------------
dupes = [c for c, n in collections.Counter(e['code'] for e in etfs).items() if n > 1]
if dupes:
    fail('duplicate codes: %s' % sorted(dupes))

# ---- counts ------------------------------------------------------------------
if meta.get('total') != len(etfs):
    fail('meta.total=%s but there are %d rows' % (meta.get('total'), len(etfs)))

actual = collections.Counter(e['sec'] for e in etfs)
declared_ids = [s['id'] for s in doc['sections']]

if declared_ids != [s for s, _ in SECTIONS]:
    fail('section list/order changed: %s' % declared_ids)

for s in doc['sections']:
    if s['count'] != actual.get(s['id'], 0):
        fail('section %s declares %d but holds %d' % (s['id'], s['count'], actual.get(s['id'], 0)))

stray = set(actual) - set(declared_ids)
if stray:
    fail('rows in undeclared section(s): %s' % sorted(stray))

# ---- filter options cover the data -------------------------------------------
custs = set(e['cust'] for e in etfs) - set([DASH])
missing_cust = custs - set(doc['custodians'])
if missing_cust:
    fail('custodian(s) with no filter option: %s' % sorted(missing_cust))

freqs = set(e['freq'] for e in etfs)
missing_freq = freqs - set(doc['frequencies'])
if missing_freq:
    fail('frequency(ies) with no filter option: %s' % sorted(missing_freq))

unstyled = freqs - set(FREQ_CLASS)
if unstyled:
    fail('payout label(s) with no .freq-* class: %s' % sorted(unstyled))

# ---- the front end can actually style every payout label ---------------------
# CUR is app/public/data/etfs.json, so three levels up is the Vite project root.
# The React side names the classes .pill-* (not .freq-*) and keeps the label ->
# class map in format.ts, so both files have to know about a new label.
app_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(CUR))))
fmt_path = os.path.join(app_root, 'src', 'lib', 'format.ts')
css_path = os.path.join(app_root, 'src', 'styles.css')

if os.path.exists(fmt_path):
    fmt = io.open(fmt_path, encoding='utf-8').read()
    for f in sorted(freqs):
        if ("'%s'" % f) not in fmt:
            fail('%s has no entry in the PILL map in format.ts' % f)
else:
    warn('format.ts not found at %s - skipped the pill map check' % fmt_path)

if os.path.exists(css_path):
    css = io.open(css_path, encoding='utf-8').read()
    for cls in sorted(set(re.findall(r'pill-[a-z]+', fmt))) if os.path.exists(fmt_path) else []:
        if ('.' + cls) not in css:
            fail('format.ts uses .%s but that class is not in styles.css' % cls)
else:
    warn('styles.css not found at %s - skipped the CSS class check' % css_path)

# ---- numeric fields look like numbers or N/A ---------------------------------
def numeric_ok(v):
    if v in ('N/A', '', DASH):
        return True
    try:
        float(str(v).replace(',', ''))
        return True
    except ValueError:
        return False


for e in etfs:
    for f in ('yield', 'r3', 'r6', 'r12', 'r36', 'r60'):
        if not numeric_ok(e[f]):
            fail('%s has unparsable %s=%r' % (e['code'], f, e[f]))

# ---- an all-N/A table means the scrape failed silently -----------------------
have_yield = sum(1 for e in etfs if e['yield'] not in ('N/A', ''))
have_ret = sum(1 for e in etfs if e['r12'] not in ('N/A', ''))
if have_yield == 0:
    fail('every yield is N/A - the Basic0004 scrape produced nothing usable')
if have_ret == 0:
    fail('every 近1年 return is N/A - the Basic0008 scrape produced nothing usable')

# ---- regression diff ---------------------------------------------------------
if PREV and os.path.exists(PREV):
    prev = load(PREV)
    pmap = dict((e['code'], e) for e in prev.get('etfs', []))
    cmap = dict((e['code'], e) for e in etfs)

    gone = sorted(set(pmap) - set(cmap))
    if gone:
        fail('%d row(s) disappeared: %s' % (len(gone), ', '.join(gone)))

    added = sorted(set(cmap) - set(pmap))
    if added:
        warn('%d new listing(s): %s' % (len(added), ', '.join(added)))

    if pmap:
        drop = (len(pmap) - len(cmap)) / float(len(pmap))
        if drop > DROP_TOLERANCE:
            fail('total fell %.1f%% (%d -> %d), above the %.0f%% tolerance'
                 % (drop * 100, len(pmap), len(cmap), DROP_TOLERANCE * 100))

    for code in sorted(set(pmap) & set(cmap)):
        p, c = pmap[code], cmap[code]
        if p['name'] != c['name']:
            warn('%s renamed: %s -> %s' % (code, p['name'], c['name']))
        if p['freq'] != c['freq']:
            warn('%s payout changed: %s -> %s' % (code, p['freq'], c['freq']))
        if p['cust'] != c['cust']:
            warn('%s custodian changed: %s -> %s' % (code, p['cust'], c['cust']))
        if p['sec'] != c['sec']:
            fail('%s moved section %s -> %s (existing rows must keep their section)'
                 % (code, p['sec'], c['sec']))

# ---- report ------------------------------------------------------------------
print('%s: %d ETFs  updated=%s snapshot=%s'
      % (CUR, len(etfs), meta.get('updated'), meta.get('snapshot') or 'none'))
print('sections: %s' % '  '.join('%s=%d' % (s['id'], s['count']) for s in doc['sections']))
print('custodians=%d  frequencies=%d  with-yield=%d  with-1y-return=%d'
      % (len(doc['custodians']), len(doc['frequencies']), have_yield, have_ret))

for w in warns:
    print('NOTE: %s' % w)

if fails:
    print('')
    for f in fails:
        print('FAIL: %s' % f)
    sys.exit('%d check(s) failed' % len(fails))

print('OK - all checks passed')
