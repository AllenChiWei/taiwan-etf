# -*- coding: utf-8 -*-
u"""One-off: add a 近3年 return column to the pipeline and both front ends.

    python tools/add_3y_column.py

Touches, in order:
  scripts/etfdata.py     RETURN_PERIODS gains 三年 (parse_returns finds columns by
                         label, so nothing else in the parser has to change)
  scripts/build_page.py  one more sortable <th>; the cell loop already iterates
                         RETURN_PERIODS so the <td>s follow automatically
  scripts/verify_page.py 10 cells per row, 5 sortable headers per table
  taiwan_etf_list.html   mobile card grid goes from 4 to 5 columns, and every
                         nth-child position after the numbers shifts by one

The page's own rows are NOT edited here - build_page.py regenerates them from the
freshly scraped pages.
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL = os.path.join(ROOT, '.claude', 'skills', 'update-etf-list', 'scripts')


def patch(path, edits, label):
    s = io.open(path, encoding='utf-8').read()
    for old, new in edits:
        if new in s and old not in s:
            print('  %s: already applied' % label)
            return
        if old not in s:
            raise SystemExit('%s: anchor not found:\n%s' % (label, old[:120]))
        if s.count(old) != 1:
            raise SystemExit('%s: anchor appears %d times' % (label, s.count(old)))
        s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8').write(s)
    print('  %s: patched' % label)


print('etfdata.py')
patch(os.path.join(SKILL, 'etfdata.py'), [
    (u"RETURN_PERIODS = [u'三個月', u'六個月', u'一年']",
     u"RETURN_PERIODS = [u'三個月', u'六個月', u'一年', u'三年']"),
], 'RETURN_PERIODS')

print('build_page.py')
patch(os.path.join(SKILL, 'build_page.py'), [
    (u"      + _SORT % u'近3月' + _SORT % u'近6月' + _SORT % u'近1年'\n",
     u"      + _SORT % u'近3月' + _SORT % u'近6月' + _SORT % u'近1年' + _SORT % u'近3年'\n"),
], 'table header')

print('verify_page.py')
patch(os.path.join(SKILL, 'verify_page.py'), [
    (u'# --- row internals: 9 cells, cell text agrees with the data-* attributes ------',
     u'# --- row internals: 10 cells, cell text agrees with the data-* attributes -----'),
    (u'NCELLS = 9', u'NCELLS = 10'),
    (u"# 4 sortable headers (殖利率 + 3 returns) in each of the 6 section tables. The",
     u"# 5 sortable headers (殖利率 + 4 returns) in each of the 6 section tables. The"),
    (u"print('sortable headers: %d (%d tables x 4)' % (n_sortable, n_tables))",
     u"print('sortable headers: %d (%d tables x 5)' % (n_sortable, n_tables))"),
    (u"if n_sortable != n_tables * 4:\n"
     u"        fails.append('expected %d sortable headers, found %d' % (n_tables * 4, n_sortable))",
     u"if n_sortable != n_tables * 5:\n"
     u"        fails.append('expected %d sortable headers, found %d' % (n_tables * 5, n_sortable))"),
], 'cell + header counts')

print('taiwan_etf_list.html (手機版卡片)')
patch(os.path.join(ROOT, 'taiwan_etf_list.html'), [
    # 卡片改成 5 欄，數字列才放得下五個指標
    (u"""    tbody tr {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px 8px;""",
     u"""    tbody tr {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 4px 6px;"""),

    # 第 1 行：代號佔 1-4，配息移到第 5 欄
    (u"    td:nth-child(1) { grid-column: 1 / 4; grid-row: 1; font-size: 1.02rem; }\n"
     u"    td:nth-child(4) { grid-column: 4;     grid-row: 1; justify-self: end; align-self: center; }",
     u"    td:nth-child(1) { grid-column: 1 / 5; grid-row: 1; font-size: 1.02rem; }\n"
     u"    td:nth-child(4) { grid-column: 5;     grid-row: 1; justify-self: end; align-self: center; }"),

    # 第 4 行：五個數字（原本四個）
    (u"""    td:nth-child(n+5):nth-child(-n+8) {
      grid-row: 4;
      text-align: left;
      padding-top: 7px;
      border-top: 1px solid #eef1f5;
    }
    td:nth-child(5) { grid-column: 1; }
    td:nth-child(6) { grid-column: 2; }
    td:nth-child(7) { grid-column: 3; }
    td:nth-child(8) { grid-column: 4; }
    td:nth-child(n+5):nth-child(-n+8)::before {
      display: block;
      font-size: 0.66rem;
      font-weight: 400;
      color: #98a2ae;
      margin-bottom: 1px;
    }
    td:nth-child(5)::before { content: '殖利率'; }
    td:nth-child(6)::before { content: '近3月'; }
    td:nth-child(7)::before { content: '近6月'; }
    td:nth-child(8)::before { content: '近1年'; }""",
     u"""    td:nth-child(n+5):nth-child(-n+9) {
      grid-row: 4;
      text-align: left;
      padding-top: 7px;
      border-top: 1px solid #eef1f5;
    }
    td:nth-child(5) { grid-column: 1; }
    td:nth-child(6) { grid-column: 2; }
    td:nth-child(7) { grid-column: 3; }
    td:nth-child(8) { grid-column: 4; }
    td:nth-child(9) { grid-column: 5; }
    td:nth-child(n+5):nth-child(-n+9)::before {
      display: block;
      font-size: 0.62rem;
      font-weight: 400;
      color: #98a2ae;
      margin-bottom: 1px;
      white-space: nowrap;
    }
    td:nth-child(5)::before { content: '殖利率'; }
    td:nth-child(6)::before { content: '近3月'; }
    td:nth-child(7)::before { content: '近6月'; }
    td:nth-child(8)::before { content: '近1年'; }
    td:nth-child(9)::before { content: '近3年'; }"""),

    # 名稱與保管銀行改成橫跨 5 欄
    (u"    td:nth-child(2) { grid-column: 1 / -1; grid-row: 2; font-weight: 600; font-size: 0.95rem; }",
     u"    td:nth-child(2) { grid-column: 1 / -1; grid-row: 2; font-weight: 600; font-size: 0.94rem; }"),

    # 詳情按鈕從第 9 格變成第 10 格
    (u"    td:nth-child(9) { grid-column: 1 / -1; grid-row: 5; margin-top: 2px; }\n"
     u"    td:nth-child(9) .link-btn {",
     u"    td:nth-child(10) { grid-column: 1 / -1; grid-row: 5; margin-top: 2px; }\n"
     u"    td:nth-child(10) .link-btn {"),

    # 小螢幕微調
    (u"    td:nth-child(n+5):nth-child(-n+8)::before { font-size: 0.62rem; }",
     u"    td:nth-child(n+5):nth-child(-n+9)::before { font-size: 0.58rem; }"),
    (u"    td { font-size: 0.84rem; }",
     u"    td { font-size: 0.8rem; }"),
], 'mobile card grid')

print('\n近3年欄位已接上 —— 執行 build_page.py 重建表格即可生效')
