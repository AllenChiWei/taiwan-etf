# -*- coding: utf-8 -*-
"""Step 4 - check the rebuilt page, and diff it against a backup of the previous one.

    python verify_page.py [path/to/taiwan_etf_list.html] [previous.html]

Exits non-zero on any structural failure. The diff against the previous version is
the important half: it lists every existing row whose name / bank / payout changed
so you can eyeball them, and it FAILS if a row silently disappeared.
"""
import io, re, sys

HTML = sys.argv[1] if len(sys.argv) > 1 else 'taiwan_etf_list.html'
PREV = sys.argv[2] if len(sys.argv) > 2 else None
fails = []


def rows_of(h):
    out = {}
    for m in re.finditer(r'<tr data-custodian="(.*?)" data-frequency="(.*?)">\s*'
                         r'<td class="code"><a[^>]*>(.*?)</a></td>\s*<td>(.*?)</td>', h):
        cu, f, code, name = m.groups()
        out[code] = (name, cu, f)
    return out


def sections_of(h):
    out = {}
    for m in re.finditer(r'<section id="([a-z\-]+)">(.*?)</section>', h, re.S):
        for c in re.findall(r'<td class="code"><a[^>]*>(.*?)</a>', m.group(2)):
            out[c] = m.group(1)
    return out


h = io.open(HTML, encoding='utf-8').read()
rows = rows_of(h)
n_tr = len(re.findall(r'<tr data-custodian', h))
print('rows=%d  unique codes=%d' % (n_tr, len(rows)))
if n_tr != len(rows):
    fails.append('duplicate ETF codes on the page')

# --- per-section header count vs actual rows ---------------------------------
for sid, cnt in re.findall(r'<section id="([a-z\-]+)">\s*<h2>[^<]*<span class="count">\((\d+) ', h):
    body = h.split('<section id="%s">' % sid, 1)[1].split('</section>', 1)[0]
    actual = body.count('<tr data-custodian')
    flag = 'OK' if int(cnt) == actual else 'MISMATCH'
    print('  %-24s header=%-4s actual=%-4d %s' % (sid, cnt, actual, flag))
    if flag == 'MISMATCH':
        fails.append('%s header count %s != %d rows' % (sid, cnt, actual))

# --- header stat boxes --------------------------------------------------------
stats = dict((b.strip(), int(a)) for a, b in re.findall(r'<strong>(\d+)</strong>([^<]+)', h))
print('stats: %s' % stats)
counts = dict((sid, h.split('<section id="%s">' % sid, 1)[1].split('</section>', 1)[0]
               .count('<tr data-custodian'))
              for sid in sections_of(h).values())
if stats.get(u'總計 ETF 檔數') != len(rows):
    fails.append('total stat box != row count')
for label, sid in [(u'台股 ETF', 'cat-domestic'), (u'海外 ETF', 'cat-foreign'),
                   (u'債券 ETF', 'cat-bond')]:
    if stats.get(label) != counts.get(sid):
        fails.append('stat box %s (%s) != %s rows' % (label, stats.get(label), counts.get(sid)))
lev = sum(counts.get(s, 0) for s in ('cat-leveraged', 'cat-futures', 'cat-leveraged-futures'))
if stats.get(u'槓桿/期貨 ETF') != lev:
    fails.append(u'槓桿/期貨 stat box != %d' % lev)

# --- filters cover every value in use ----------------------------------------
cop = set(re.findall(r'<option value="([^"]*)">', h.split('custodianFilter', 1)[1]
                     .split('</select>', 1)[0]))
fop = set(re.findall(r'<option value="([^"]*)">', h.split('frequencyFilter', 1)[1]
                     .split('</select>', 1)[0]))
miss_c = set(v[1] for v in rows.values()) - cop
miss_f = set(v[2] for v in rows.values()) - fop
if miss_c:
    fails.append('custodians used but not in filter: %s' % sorted(miss_c))
if miss_f:
    fails.append('payout labels used but not in filter: %s' % sorted(miss_f))

# --- pill classes -------------------------------------------------------------
need = set(re.findall(r'class="freq (freq-[a-z]+)"', h))
have = set(re.findall(r'\.(freq-[a-z]+|ret-[a-z]+)\s*\{', h))
if need - have:
    fails.append('pill class used but not defined in CSS: %s' % sorted(need - have))

# --- row internals: 10 cells, cell text agrees with the data-* attributes ------
# 代號 / 名稱 / 保管銀行 / 配息 / 殖利率 / 近3月 / 近6月 / 近1年 / 近3年 / 詳情
NCELLS = 10
NUM_OK = re.compile(r'^(N/A|-?[\d,]+\.\d+|-?[\d,]+)$')
bad = badnum = 0
yield_cells = []
for m in re.finditer(r'<tr data-custodian="(.*?)" data-frequency="(.*?)">(.*?)</tr>', h, re.S):
    cu, fr, body = m.groups()
    tds = re.findall(r'<td[^>]*>(.*?)</td>', body, re.S)
    if len(tds) != NCELLS or tds[2].strip() != cu or fr not in tds[3]:
        bad += 1
        continue
    for v in tds[4:8]:                      # 殖利率 + the three return columns
        if not NUM_OK.match(v.strip()):
            badnum += 1
    yield_cells.append(tds[4].strip())
if bad:
    fails.append('%d rows with the wrong cell count or cells disagreeing with data-*' % bad)
if badnum:
    fails.append('%d numeric cells are not a number or N/A' % badnum)

# a numeric cell's class must match its content: returns red up / green down
# (TW convention), yield always .yld, N/A always .ret-na
wrong = 0
for cls, val in re.findall(r'<td class="num (ret-[a-z]+|yld)">(.*?)</td>', h):
    if val == 'N/A':
        ok = (cls == 'ret-na')
    elif cls == 'yld':
        ok = True                            # yield has no sign colouring
    else:
        try:
            f = float(val.replace(',', ''))
            ok = cls == ('ret-up' if f > 0 else ('ret-down' if f < 0 else 'ret-flat'))
        except ValueError:
            ok = False
    if not ok:
        wrong += 1
if wrong:
    fails.append('%d numeric cells whose colour class disagrees with their value' % wrong)

# yield must be present wherever MoneyDJ had one; a whole column of N/A means the
# 殖利率 field stopped parsing (it shares Basic0004 with 保管銀行/配息)
n_yld = sum(1 for v in yield_cells if v != 'N/A')
print('yield cells with a value: %d / %d' % (n_yld, len(yield_cells)))
if yield_cells and n_yld < len(yield_cells) * 0.2:
    fails.append('only %d of %d yield cells have a value - 殖利率 parsing likely broke'
                 % (n_yld, len(yield_cells)))

# header row must have the same column count as the body rows
for ths in re.findall(r'<thead><tr>(.*?)</tr></thead>', h, re.S):
    n_th = ths.count('<th')
    if n_th != NCELLS:
        fails.append('thead has %d columns, rows have %d' % (n_th, NCELLS))
        break

# --- links point at their own code -------------------------------------------
mism = sum(1 for m in re.finditer(
    r'<td class="code"><a href="[^"]*etfid=([0-9a-z]+)\.tw"[^>]*>([^<]+)</a>', h)
    if m.group(1) != m.group(2).lower())
if mism:
    fails.append('%d MoneyDJ links point at a different code than the row' % mism)

# --- JS contract --------------------------------------------------------------
for token in ['filterRows', 'resetFilters', 'scrollToTop', 'sortTable', 'searchBox',
              'custodianFilter', 'frequencyFilter', 'scrollTopBtn']:
    if token not in h:
        fails.append('lost JS/DOM hook: %s' % token)

# --- click-to-sort wiring -----------------------------------------------------
# 5 sortable headers (殖利率 + 4 returns) in each of the 6 section tables. The
# handler is delegated off `th.sortable`, so a header that loses the class goes
# silently dead rather than erroring.
n_tables = h.count('<thead>')
n_sortable = len(re.findall(r'<th class="num sortable"', h))
print('sortable headers: %d (%d tables x 5)' % (n_sortable, n_tables))
if n_sortable != n_tables * 5:
    fails.append('expected %d sortable headers, found %d' % (n_tables * 5, n_sortable))
for css in ['th.sortable', '.sorted-desc', '.sorted-asc']:
    if css not in h:
        fails.append('missing sort CSS: %s' % css)

# --- tag balance --------------------------------------------------------------
for tag in ['section', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'a']:
    o, c = len(re.findall(r'<%s[ >]' % tag, h)), h.count('</%s>' % tag)
    if o != c:
        fails.append('unbalanced <%s>: %d open / %d close' % (tag, o, c))

# --- diff against the previous version ---------------------------------------
if PREV:
    prev = rows_of(io.open(PREV, encoding='utf-8').read())
    prev_sec, now_sec = sections_of(io.open(PREV, encoding='utf-8').read()), sections_of(h)
    dropped = sorted(set(prev) - set(rows))
    added = sorted(set(rows) - set(prev))
    changed = [(k, prev[k], rows[k]) for k in sorted(prev) if k in rows and prev[k] != rows[k]]
    moved = [(k, prev_sec[k], now_sec[k]) for k in sorted(prev_sec)
             if k in now_sec and prev_sec[k] != now_sec[k]]
    print('\nvs previous: +%d added, -%d dropped, %d changed, %d moved section'
          % (len(added), len(dropped), len(changed), len(moved)))
    if dropped:
        fails.append('rows disappeared: %s (a listed ETF should never vanish - '
                     'if it really delisted, say so explicitly)' % dropped)
    for k, a, b in changed:
        print(u'  CHANGED %s  %s -> %s' % (k, a, b))
    for k, a, b in moved:
        print(u'  MOVED   %s  %s -> %s' % (k, a, b))
    print('  (review each CHANGED/MOVED line above - renames and payout changes are '
          'normal, unexplained bank changes are not)')

print('\n%s' % ('FAILED:\n  ' + '\n  '.join(fails) if fails else 'all structural checks passed'))
sys.exit(1 if fails else 0)
