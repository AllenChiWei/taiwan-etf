# -*- coding: utf-8 -*-
"""Step 3 - rewrite the tables, filter options, header stats and date in the page.

    python build_page.py <workdir> [path/to/taiwan_etf_list.html]

Only the generated regions are touched; all CSS, JS and layout are left alone, so
hand edits elsewhere in the file survive a rebuild. Idempotent - safe to re-run.

Existing rows keep their section (see etfdata.section), so a curated placement is
never overwritten by the rule.
"""
import io, os, re, sys, datetime, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from etfdata import (DASH, FREQ_CLASS, FREQ_ORDER, SECTIONS, RETURN_KEYS,
                     load_rows, return_class)

WORK = sys.argv[1] if len(sys.argv) > 1 else '.'
HTML = sys.argv[2] if len(sys.argv) > 2 else 'taiwan_etf_list.html'

MDJ = 'https://www.moneydj.com/ETF/X/Basic/Basic0004.xdjhtm?etfid=%s.tw'
RET = 'https://www.moneydj.com/ETF/X/Basic/Basic0008.xdjhtm?etfid=%s.tw'
# The four numeric columns are click-to-sort (see sortTable() in the page's JS).
# `sortable` is the hook the delegated click handler looks for - a column without it
# is simply not sortable, so adding a new numeric column means adding the class too.
_SORT = u'<th class="num sortable" tabindex="0" title="點擊排序，再點一次反向，第三次還原">%s</th>'
TH = (u'<th>代號</th><th>名稱</th><th>保管銀行</th><th>配息</th>'
      + _SORT % u'殖利率'
      + _SORT % u'近3月' + _SORT % u'近6月' + _SORT % u'近1年'
      + _SORT % u'近3年' + _SORT % u'近5年'
      + u'<th>詳情</th>')


def esc(s):
    # Unescape first: some feeds hand back names that already contain entities
    # (TWSE's t187ap47_L returns "元大S&amp;P500"), and escaping those again
    # would render as a literal "S&amp;P500" on the page.
    s = (s.replace('&amp;', '&').replace('&lt;', '<')
          .replace('&gt;', '>').replace('&quot;', '"').replace('&#39;', "'"))
    return (s.replace('&', '&amp;').replace('<', '&lt;')
             .replace('>', '&gt;').replace('"', '&quot;'))


def current_sections(html):
    """{code: section_id} for the rows already on the page."""
    out = {}
    for m in re.finditer(r'<section id="([a-z\-]+)">(.*?)</section>', html, re.S):
        for c in re.findall(r'<td class="code"><a[^>]*>(.*?)</a>', m.group(2)):
            out[c] = m.group(1)
    return out


def main():
    html = io.open(HTML, encoding='utf-8').read()
    universe = [l.rstrip('\n').split('\t')
                for l in io.open(os.path.join(WORK, 'universe.tsv'), encoding='utf-8') if l.strip()]

    rows, missing, no_ret, ret_asof, yld_asof = load_rows(
        WORK, universe, current_sections(html))
    if missing:
        sys.exit('no MoneyDJ page for %d codes (%s) - run scrape_moneydj.py first'
                 % (len(missing), ', '.join(missing[:10])))
    if no_ret:
        print('WARNING: no return data for %d codes (%s%s) - their cells show N/A; '
              'run scrape_returns.py to fill them'
              % (len(no_ret), ', '.join(no_ret[:10]), '...' if len(no_ret) > 10 else ''))

    unknown = sorted(set(r['freq'] for r in rows) - set(FREQ_CLASS))
    if unknown:
        sys.exit(u'unknown payout label(s) %s - add them to FREQ_CLASS/FREQ_ORDER in '
                 u'etfdata.py AND add a .freq-* rule to the page CSS' % unknown)

    by_sec = collections.defaultdict(list)
    for r in rows:
        by_sec[r['sec']].append(r)
    for v in by_sec.values():
        v.sort(key=lambda r: r['code'])
    stray = set(by_sec) - set(s for s, _ in SECTIONS)
    if stray:
        sys.exit('rows landed in unknown section(s): %s' % sorted(stray))

    # ---- tables ----------------------------------------------------------
    out = []
    for sid, title in SECTIONS:
        rs = by_sec[sid]
        out.append(u'  <section id="%s">\n'
                   u'    <h2>%s <span class="count">(%d 檔)</span></h2>\n'
                   u'    <table>\n      <thead><tr>%s</tr></thead>\n      <tbody>\n'
                   % (sid, title, len(rs), TH))
        for r in rs:
            url = MDJ % r['code'].lower()
            yv = r['yield']
            cells = (u'          <td class="num %s">%s</td>\n'
                     % ('yld' if yv != 'N/A' else 'ret-na', esc(yv))
                     + u''.join(
                         u'          <td class="num %s">%s</td>\n'
                         % (return_class(r['ret'][k]), esc(r['ret'][k]))
                         for k in RETURN_KEYS))
            out.append(
                u'        <tr data-custodian="%s" data-frequency="%s">\n'
                u'          <td class="code"><a href="%s" target="_blank">%s</a></td>\n'
                u'          <td>%s</td>\n'
                u'          <td>%s</td>\n'
                u'          <td><span class="freq %s">%s</span></td>\n'
                u'%s'
                u'          <td><a href="%s" target="_blank" class="link-btn">MoneyDJ</a></td>\n'
                u'        </tr>\n'
                % (esc(r['cust']), esc(r['freq']), url, esc(r['code']), esc(r['name']),
                   esc(r['cust']), FREQ_CLASS[r['freq']], esc(r['freq']), cells, url))
        out.append(u'      </tbody>\n    </table>\n  </section>\n\n')
    tables = u''.join(out).rstrip() + u'\n'

    # ---- header stats ----------------------------------------------------
    n = lambda s: len(by_sec[s])
    lev = n('cat-leveraged') + n('cat-futures') + n('cat-leveraged-futures')
    stats = (u'  <div class="stats">\n'
             u'    <div class="stat-box"><strong>%d</strong>總計 ETF 檔數</div>\n'
             u'    <a class="stat-box stat-link" href="#cat-domestic"><strong>%d</strong>台股 ETF</a>\n'
             u'    <a class="stat-box stat-link" href="#cat-foreign"><strong>%d</strong>海外 ETF</a>\n'
             u'    <a class="stat-box stat-link" href="#cat-bond"><strong>%d</strong>債券 ETF</a>\n'
             u'    <a class="stat-box stat-link" href="#cat-leveraged"><strong>%d</strong>槓桿/期貨 ETF</a>\n'
             u'  </div>'
             % (len(rows), n('cat-domestic'), n('cat-foreign'), n('cat-bond'), lev))

    # ---- filter options --------------------------------------------------
    custs = sorted(set(r['cust'] for r in rows) - set([DASH]))
    cust_opts = (u'      <option value="">全部</option>\n'
                 + u''.join(u'      <option value="%s">%s</option>\n' % (esc(c), esc(c))
                            for c in custs))
    used = set(r['freq'] for r in rows)
    freq_opts = (u'      <option value="">全部</option>\n'
                 + u''.join(u'      <option value="%s">%s</option>\n' % (f, f)
                            for f in FREQ_ORDER if f in used)
                 + u'      <option value="%s">%s (無資料)</option>\n' % (DASH, DASH))

    # ---- splice ----------------------------------------------------------
    def sub(pattern, repl, what, flags=0):
        new, k = re.subn(pattern, lambda m: repl(m) if callable(repl) else repl,
                         html_ref[0], 1, flags)
        if k != 1:
            sys.exit('could not locate %s - the page structure changed; '
                     'update build_page.py' % what)
        html_ref[0] = new

    html_ref = [html]
    sub(r'  <div class="stats">.*?\n  </div>', stats, 'header stats', re.S)
    sub(r'(<select id="custodianFilter" onchange="filterRows\(\)">\n).*?(    </select>)',
        lambda m: m.group(1) + cust_opts + m.group(2), 'custodian filter', re.S)
    sub(r'(<select id="frequencyFilter" onchange="filterRows\(\)">\n).*?(    </select>)',
        lambda m: m.group(1) + freq_opts + m.group(2), 'frequency filter', re.S)
    sub(r'  <section id="cat-domestic">.*</section>\n', tables, 'ETF sections', re.S)
    sub(u'(更新日期：)\\d{4}-\\d{2}-\\d{2}',
        lambda m: m.group(1) + datetime.date.today().isoformat(), 'update date')
    snap = ret_asof or yld_asof
    if snap:
        # Append (or refresh) the as-of stamp for the market-snapshot columns
        # (殖利率 + returns); they go stale faster than the rest of the table.
        # The optional group is deliberately generic so an older wording of this
        # stamp is replaced rather than appended to.
        sub(u'(更新日期：\\d{4}-\\d{2}-\\d{2})(　[^<　]*截至：[^<]*)?',
            lambda m: m.group(1) + u'　報酬率／殖利率截至：' + snap, 'snapshot as-of stamp')

    # every pill / return class the tables use must exist in the CSS
    body = html_ref[0]
    need = set(re.findall(r'class="freq (freq-[a-z]+)"', body))
    need |= set(re.findall(r'class="num (ret-[a-z]+|yld)"', body))
    have = set(re.findall(r'\.(freq-[a-z]+|ret-[a-z]+|yld)\s*\{', body))
    if need - have:
        sys.exit('CSS is missing class(es) %s - add the rule(s) to the page <style>'
                 % sorted(need - have))

    io.open(HTML, 'w', encoding='utf-8').write(body)
    print('%s: %d ETFs  %s'
          % (HTML, len(rows), '  '.join('%s=%d' % (s, n(s)) for s, _ in SECTIONS)))
    print('custodian options=%d  returns as-of=%s  yield as-of=%s'
          % (len(custs), ret_asof or 'none', yld_asof or 'none'))
    print('N/A cells: returns=%d  yield=%d'
          % (sum(1 for r in rows for k in RETURN_KEYS if r['ret'][k] == 'N/A'),
             sum(1 for r in rows if r['yield'] == 'N/A')))


if __name__ == '__main__':
    main()
