#!/usr/bin/env python3
# -*- coding: utf-8 -*-
u"""純邏輯單元測試：scripts/fetch_etf_holdings.py 與 scripts/verify_etf_holdings.py（不發網路請求）。"""
import io
import os
import sys
import unittest
from datetime import date

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

import fetch_etf_holdings as feh  # noqa: E402
import verify_etf_holdings as veh  # noqa: E402


class FetchEtfHoldingsTests(unittest.TestCase):
    def test_parse_capital_00919_fixture(self):
        # 2026-11-28 群益 00919 實測結構：data.stocks 含 stocNo, stocName, weight, share
        fixture = {
            'data': {
                'pcf': {'date1': '2026-11-28', 'date2': '2026-11-27'},
                'stocks': [
                    {'stocNo': '2603', 'stocName': '長榮*', 'weight': 9.82, 'share': 200000000},
                    {'stocNo': '2303', 'stocName': '聯電', 'weight': 9.45, 'share': 680000000},
                    {'stocNo': '2891', 'stocName': '中信金', 'weight': 10.12, 'share': 850000000},
                ],
            }
        }
        asof, rows = feh.parse_capital(fixture)
        self.assertEqual(asof, '2026-11-27')
        self.assertEqual([r[0] for r in rows], ['2891', '2603', '2303'])
        self.assertEqual(rows[1][1], u'長榮')
        self.assertEqual(rows[0][2], 850000000)
        self.assertAlmostEqual(rows[0][3], 10.12)

    def test_parse_fhtrust_00929_fixture(self):
        # 2026-11-28 復華 00929 實測結構：result[0].detail 含 ftype, stockid, stockname, qshare, prate_addaccint
        fixture = {
            'result': [{
                'dDate': '2026/11/27',
                'detail': [
                    {'ftype': u'股票', 'stockid': '2303', 'stockname': u'聯電',
                     'qshare': '120,000,000', 'mvalue': '5,000,000,000', 'price': '41.5',
                     'prate_addaccint': '4.139%'},
                    {'ftype': u'股票', 'stockid': '2454', 'stockname': u'聯發科',
                     'qshare': '5,000,000', 'prate_addaccint': '6.500%'},
                    {'ftype': u'期貨', 'stockid': 'TX', 'stockname': u'台股期貨',
                     'qshare': '10', 'prate_addaccint': '1.200%'},
                    {'ftype': u'現金', 'stockid': 'CASH', 'stockname': u'新台幣',
                     'qshare': '0', 'prate_addaccint': '2.000%'},
                ],
            }]
        }
        asof, rows = feh.parse_fhtrust(fixture)
        self.assertEqual(asof, '2026-11-27')
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0], ['2454', u'聯發科', 5000000, 6.5])
        self.assertEqual(rows[1], ['2303', u'聯電', 120000000, 4.139])

    def test_parse_yuanta_0050_unwrapped_inkind_nav_denom(self):
        # 2026-11-28 元大 0050 實測結構：頂層無 Data 包裝、FundWeights.StockWeights 為空、成分在 InKind.FundComposition
        fixture = {
            'PCF': {
                'trandate': '20261127',
                'totalav': 100_000_000_000,   # 1,000 億
                'osunit': 500_000_000,        # 每單位 NAV = 200 元
                'baseunit': 500_000,          # 每申購基數淨值 = 100,000,000 元
            },
            'InKind': {
                'FundComposition': [
                    {'stkcd': '2330', 'name': u'台積電', 'qty': 60000, 'cashinlieu': 'N'},
                    {'stkcd': '2454', 'name': u'聯發科', 'qty': 10000, 'cashinlieu': 'N'},
                    {'stkcd': '2317', 'name': u'鴻海', 'qty': 100000, 'cashinlieu': 'Y'},
                ],
            },
            'Cash': {'estcash': 4_000_000},
            'FundWeights': {'StockWeights': []},
            'Memo': {},
        }
        # 2330: 60,000 * 1,000 = 60,000,000 (60%)
        # 2317: 100,000 * 220  = 22,000,000 (22%)
        # 2454: 10,000 * 1,400 = 14,000,000 (14%)
        # 股票合計 96,000,000 / 淨值 100,000,000 = 96%（在 0.75~1.05 內 → denom='nav'）
        px = {'2330': 1000.0, '2454': 1400.0, '2317': 220.0}
        asof, rows, basis, denom = feh.parse_yuanta(fixture, price_lookup=px.get)
        self.assertEqual(asof, '2026-11-27')
        self.assertEqual(basis, 'qty')
        self.assertEqual(denom, 'nav')
        self.assertEqual([r[0] for r in rows], ['2330', '2317', '2454'])
        self.assertAlmostEqual(rows[0][3], 60.0)
        self.assertAlmostEqual(rows[1][3], 22.0)
        self.assertAlmostEqual(rows[2][3], 14.0)

    def test_parse_yuanta_inkind_falls_back_to_stock_sum_when_nav_missing(self):
        fixture = {
            'PCF': {'trandate': '20261127'},
            'InKind': {
                'FundComposition': [
                    {'stkcd': '2330', 'name': u'台積電', 'qty': 3000, 'cashinlieu': 'N'},
                    {'stkcd': '2317', 'name': u'鴻海', 'qty': 5000, 'cashinlieu': 'N'},
                ],
            },
            'FundWeights': {'StockWeights': []},
        }
        px = {'2330': 1000.0, '2317': 200.0}  # 3,000,000 vs 1,000,000 → 75% / 25%
        asof, rows, basis, denom = feh.parse_yuanta(fixture, price_lookup=px.get)
        self.assertEqual(asof, '2026-11-27')
        self.assertEqual(basis, 'qty')
        self.assertEqual(denom, 'stock')
        self.assertAlmostEqual(rows[0][3], 75.0)
        self.assertAlmostEqual(rows[1][3], 25.0)
        self.assertAlmostEqual(sum(r[3] for r in rows), 100.0)

    def test_parse_yuanta_inkind_skips_unpriced_foreign_etf(self):
        fixture = {
            'PCF': {'trandate': '20261127'},
            'InKind': {
                'FundComposition': [
                    {'stkcd': 'AAPL', 'name': 'APPLE', 'qty': 100},
                    {'stkcd': 'MSFT', 'name': 'MICROSOFT', 'qty': 80},
                ],
            },
            'FundWeights': {'StockWeights': []},
        }
        asof, rows, basis, denom = feh.parse_yuanta(fixture, price_lookup={}.get)
        self.assertIsNone(asof)
        self.assertEqual(rows, [])
        self.assertIsNone(basis)
        self.assertIsNone(denom)

    def test_parse_yuanta_direct_weights_when_present(self):
        fixture = {
            'PCF': {'trandate': '20261127'},
            'FundWeights': {
                'StockWeights': [
                    {'code': '2330', 'name': u'台積電', 'qty': 1000, 'weights': 11.5},
                    {'code': 'TX', 'name': u'台指期貨', 'qty': 2, 'weights': 5.0},
                ],
            },
        }
        asof, rows, basis, denom = feh.parse_yuanta(fixture)
        self.assertEqual(asof, '2026-11-27')
        self.assertEqual(basis, 'weight')
        self.assertIsNone(denom)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], '2330')

    def test_kgi_name_matching_and_html_parse(self):
        aliases = {
            '00915': [u'凱基優選高股息30', u'凱基台灣優選高股息30 ETF基金'],
            '00938': [u'凱基優選30', u'凱基台灣優選30 ETF基金'],
            '00952': [u'凱基台灣AI50', u'凱基優選台灣 AI 50 ETF基金'],
            '009816': [u'凱基台灣TOP50', u'凱基台灣TOP 50 ETF基金'],
            '00926': [u'凱基全球菁英55', u'凱基全球菁英55 ETF基金'],
        }
        self.assertEqual(feh.match_kgi_code(u'凱基台灣優選高股息30 ETF基金(本基金之配息來源可能為收益平準金)', aliases), '00915')
        self.assertEqual(feh.match_kgi_code(u'凱基台灣優選30 ETF基金', aliases), '00938')
        self.assertEqual(feh.match_kgi_code(u'凱基優選台灣 AI 50 ETF基金', aliases), '00952')
        self.assertEqual(feh.match_kgi_code(u'凱基台灣TOP 50 ETF基金', aliases), '009816')
        self.assertEqual(feh.match_kgi_code(u'凱基全球菁英55 ETF基金', aliases), '00926')

        html = (u'<div>(2026/11/27)每受益權單位淨資產價值</div>'
                u'<table><tr><td>2330</td><td>台積電</td><td>1,000,000</td><td>8.52</td></tr>'
                u'<tr><td>NVDA US</td><td>NVIDIA</td><td>50,000</td><td>6.10</td></tr></table>')
        asof, rows = feh.parse_kgi_html(html)
        self.assertEqual(asof, '2026-11-27')
        self.assertEqual([r[0] for r in rows], ['2330', 'NVDA US'])

    def test_tsit_html_strips_tt_and_skips_futures(self):
        html = (u'<div>2026/11/27 每基數實際申購總價金</div>'
                u'<table>'
                u'<tr><td>2330 TT</td><td>台積電</td><td>100,000</td><td>12.50</td></tr>'
                u'<tr><td>GOOGL US</td><td>ALPHABET</td><td>2,000</td><td>4.20</td></tr>'
                u'<tr><td>台指期貨</td><td>202612</td><td>5</td><td>3.00</td></tr>'
                u'</table>')
        asof, rows = feh.parse_tsit_html(html)
        self.assertEqual(asof, '2026-11-27')
        self.assertEqual([r[0] for r in rows], ['2330', 'GOOGL US'])

    def test_sitca_quarterly_form_and_table_parse(self):
        # 驗證季別解析（季底月份 03/06/09/12 vs 季序 01..04）
        self.assertEqual(feh.parse_quarter('202609', ['202603', '202606', '202609']), '2026Q3')
        self.assertEqual(feh.parse_quarter('202603', ['202603', '202606', '202609']), '2026Q1')
        self.assertEqual(feh.parse_quarter('202603', ['202601', '202602', '202603']), '2026Q3')
        self.assertEqual(feh.quarter_to_ym('2026Q3'), '202609')

        form_html = (
            '<input type="hidden" name="__VIEWSTATE" value="abc" />'
            '<select name="ctl00$ContentPlaceHolder1$ddlQ_YM">'
            '<option value="202606">2026Q2</option><option value="202609">2026Q3</option></select>'
            '<select name="ctl00$ContentPlaceHolder1$ddlQ_Class">'
            '<option value="AH1">指數股票型-國內</option><option value="AA1">股票型</option></select>'
            '<input type="submit" name="ctl00$ContentPlaceHolder1$BtnQuery" value="查詢" />'
        )
        info = feh.extract_sitca_form(form_html)
        self.assertEqual(info['quarter'], '2026Q3')
        self.assertEqual(info['ym'], '202609')
        self.assertEqual(info['classes'], ['AH1'])

        table_html = (
            u'<table>'
            u'<tr><th>基金名稱</th><th>標的種類</th><th>標的代號</th><th>標的名稱</th><th>股數</th><th>佔淨值比例(%)</th></tr>'
            u'<tr><td rowspan="2">國泰永續高股息ETF基金</td><td>國內上市</td><td>2357</td><td>華碩</td><td>10,000</td><td>5.12</td></tr>'
            u'<tr><td>國內上市</td><td>2303</td><td>聯電</td><td>80,000</td><td>4.08</td></tr>'
            u'<tr><td>合計</td><td colspan="5">9.20</td></tr>'
            u'</table>'
        )
        got = feh.parse_sitca_quarterly_table(table_html)
        self.assertIn(u'國泰永續高股息ETF基金', got)
        rows = got[u'國泰永續高股息ETF基金']
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0], ['2357', u'華碩', 10000, 5.12, u'國內上市'])
        self.assertEqual(rows[1], ['2303', u'聯電', 80000, 4.08, u'國內上市'])

    def test_merge_and_select_targets(self):
        prev_pcf = {'name': '0050', 'asof': '2026-11-27', 'src': u'元大投信', 'basis': 'qty',
                    'holdings': [['2330', u'台積電', 1, 55.0]]}
        older_pcf = {'name': '0050', 'asof': '2026-11-26', 'src': u'元大投信', 'basis': 'qty',
                     'holdings': [['2330', u'台積電', 1, 54.0]]}
        q_entry = {'name': '0050', 'asof': '2026Q3', 'src': feh.SITCA_SRC, 'basis': 'quarterly1pct',
                   'holdings': [['2330', u'台積電', 0, 56.0]]}
        self.assertEqual(feh.merge_entry(prev_pcf, None), prev_pcf)
        self.assertEqual(feh.merge_entry(prev_pcf, older_pcf), prev_pcf)
        self.assertEqual(feh.merge_entry(prev_pcf, q_entry), prev_pcf, '季報不可蓋掉 PCF')
        self.assertEqual(feh.merge_entry(q_entry, prev_pcf), prev_pcf, 'PCF 應覆蓋季報')

        catalog = [
            {'code': '0050', 'name': u'元大台灣50', 'sec': 'cat-domestic'},
            {'code': '00981A', 'name': u'主動統一台股增長', 'sec': 'cat-domestic', 'act': True},
            {'code': '00625K', 'name': u'元大雙幣', 'sec': 'cat-foreign'},
            {'code': '00646', 'name': u'元大S&P500', 'sec': 'cat-foreign'},
            {'code': '00679B', 'name': u'元大美債20年', 'sec': 'cat-bond'},
            {'code': '00878', 'name': u'國泰永續高股息', 'sec': 'cat-domestic'},
        ]
        dom, forg = feh.select_targets(
            catalog,
            prev_etfs={'00646': {'asof': '2026-11-26', 'basis': 'weight'}},
            today=date(2026, 11, 28),
        )
        self.assertEqual([x['code'] for x in dom], ['0050'])
        self.assertEqual(forg, [], '5 天內已更新的海外 ETF 應跳過')

    def test_verify_etf_holdings(self):
        etfs_doc = {'etfs': [
            {'code': '0050', 'sec': 'cat-domestic'},
            {'code': '00919', 'sec': 'cat-domestic'},
            {'code': '00878', 'sec': 'cat-domestic'},
        ]}
        top10_doc = {'etfs': {
            '0050': {'rows': [[1, '', '2330', '', 57], [2, '', '2454', '', 5], [3, '', '2317', '', 4]]},
            '00919': {'rows': [[1, '', '2891', '', 10], [2, '', '2603', '', 9], [3, '', '2303', '', 8]]},
        }}
        h0050 = [['2330', u'台積電', 100, 56.0], ['2454', u'聯發科', 100, 5.0], ['2317', u'鴻海', 100, 4.0]]
        h0050 += [[str(1100 + i), u'股%d' % i, 10, 0.7] for i in range(47)]  # 共 50 檔，合計 97.9%
        good = {
            'meta': {'updated': '2026-11-28'},
            'etfs': {
                '0050': {'asof': '2026-11-27', 'src': u'元大投信', 'basis': 'qty', 'holdings': h0050},
                '00919': {'asof': '2026-11-27', 'src': u'群益投信', 'basis': 'weight',
                          'holdings': [['2891', u'中信金', 10, 40.0], ['2603', u'長榮', 10, 30.0], ['2303', u'聯電', 10, 26.0]]},
                '00878': {'asof': '2026Q3', 'src': feh.SITCA_SRC, 'basis': 'quarterly1pct',
                          'holdings': [['2357', u'華碩', 0, 5.1], ['2303', u'聯電', 0, 4.2]]},
            },
        }
        errs, _, stats = veh.verify(good, etfs_doc, top10_doc, min_domestic_pcf=2)
        self.assertEqual(errs, [])
        self.assertEqual(stats['domesticPcf'], 2)
        self.assertEqual(stats['quarterlyTotal'], 1)
        self.assertAlmostEqual(stats['top3AvgOverlap'], 1.0)

        # 權重合計低於 80% 必須失敗
        bad = {
            'meta': {'updated': '2026-11-28'},
            'etfs': {
                '00919': {'asof': '2026-11-27', 'src': u'群益投信', 'basis': 'weight',
                          'holdings': [['2891', u'中信金', 10, 30.0]]},
            },
        }
        errs_bad, _, _ = veh.verify(bad, etfs_doc, top10_doc, min_domestic_pcf=1)
        self.assertTrue(any(u'80%' in e for e in errs_bad))

    def test_probe_days_do_not_drift_backwards_across_etfs(self):
        # 模擬 2026-11-28（週六）：最近交易日為 11-27，下一個工作日為 11-30
        weekdays = feh.recent_weekdays(5, today=date(2026, 11, 28))
        anchor = weekdays[0]
        self.assertEqual(anchor, date(2026, 11, 27))
        # 元大／中信先試下一個工作日（公告日 11-30），再退回 11-27、11-26
        p_yuanta = feh.build_probe_days('yuanta', anchor, weekdays)
        self.assertEqual(p_yuanta, [date(2026, 11, 30), date(2026, 11, 27), date(2026, 11, 26)])
        # 假設 11-30 尚未公告（空白），跳過 11-30 後每檔都從 11-27 開始，不會因回傳 11-26 而一路倒退
        skip = {date(2026, 11, 30)}
        for _ in range(5):
            p = feh.build_probe_days('yuanta', anchor, weekdays, skip_dates=skip)
            self.assertEqual(p[0], date(2026, 11, 27))
        # 復華／野村直接從 11-27 開始
        self.assertEqual(feh.build_probe_days('fhtrust', anchor, weekdays)[0], date(2026, 11, 27))

    def test_ezmoney_payload_uses_valid_roc_date(self):
        body = feh.ezmoney_payload('55YTW', date(2026, 11, 27))
        self.assertEqual(body, {'fundCode': '55YTW', 'date': '115/11/30', 'specificDate': False})

    def test_merge_entry_rejects_stale_pcf_and_keeps_prev(self):
        prev = {'name': '00940', 'asof': '2026-11-25', 'src': u'元大投信', 'basis': 'weight',
                'holdings': [['2303', u'聯電', 100, 95.0]]}
        stale = {'name': '00940', 'asof': '2026-11-13', 'src': u'元大投信', 'basis': 'weight',
                 'holdings': [['2303', u'聯電', 100, 95.0]]}
        # 11-13 到 11-27 隔 10 個交易日（> 5）→ 保留前版；無前版時回 None
        self.assertEqual(feh.weekdays_between('2026-11-13', '2026-11-27'), 10)
        self.assertEqual(feh.weekdays_between('2026-11-20', '2026-11-27'), 5)
        self.assertEqual(feh.merge_entry(prev, stale, ref_asof='2026-11-27'), prev)
        self.assertIsNone(feh.merge_entry(None, stale, ref_asof='2026-11-27'))

    def test_verify_flags_stale_pcf(self):
        etfs_doc = {'etfs': [
            {'code': '00919', 'sec': 'cat-domestic'},
            {'code': '0056', 'sec': 'cat-domestic'},
            {'code': '006201', 'sec': 'cat-domestic'},
            {'code': '00713', 'sec': 'cat-domestic'},
            {'code': '00940', 'sec': 'cat-domestic'},
        ]}
        rows = [['2303', u'聯電', 100, 95.0]]
        doc_one_stale = {
            'meta': {'updated': '2026-11-28'},
            'etfs': {
                '00919': {'asof': '2026-11-27', 'src': u'群益投信', 'basis': 'weight', 'holdings': rows},
                '0056': {'asof': '2026-11-20', 'src': u'元大投信', 'basis': 'weight', 'holdings': rows},  # 剛好 5 日 OK
                '00940': {'asof': '2026-11-19', 'src': u'元大投信', 'basis': 'weight', 'holdings': rows}, # 6 日 -> 警告
            },
        }
        errs, warns, stats = veh.verify(doc_one_stale, etfs_doc, min_domestic_pcf=2)
        self.assertEqual(errs, [])
        self.assertEqual(stats['stalePcf'], ['00940'])
        self.assertTrue(any('00940' in w and '6' in w for w in warns))

        # >= 3 檔台股 PCF 過舊時升級為 error
        doc_mass_stale = {
            'meta': {'updated': '2026-11-28'},
            'etfs': {
                '00919': {'asof': '2026-11-27', 'src': u'群益投信', 'basis': 'weight', 'holdings': rows},
                '006201': {'asof': '2026-11-19', 'src': u'元大投信', 'basis': 'weight', 'holdings': rows},
                '00713': {'asof': '2026-11-17', 'src': u'元大投信', 'basis': 'weight', 'holdings': rows},
                '00940': {'asof': '2026-11-13', 'src': u'元大投信', 'basis': 'weight', 'holdings': rows},
            },
        }
        errs_mass, _, stats_mass = veh.verify(doc_mass_stale, etfs_doc, min_domestic_pcf=2)
        self.assertEqual(len(stats_mass['stalePcf']), 3)
        self.assertTrue(any(u'過舊檔數過多' in e for e in errs_mass))

    def test_safe_log_handles_cp950_stream(self):
        buf = io.BytesIO()
        cp950_stream = io.TextIOWrapper(buf, encoding='cp950', errors='strict')
        feh.log(u'  ⚠ 00939 測試警告', stream=cp950_stream)
        veh._emit(u'  ⚠ 驗證警告 ✗', stream=cp950_stream)
        cp950_stream.flush()
        text = buf.getvalue().decode('cp950', 'replace')
        self.assertIn(u'00939 測試警告', text)
        self.assertIn(u'驗證警告', text)


if __name__ == '__main__':
    unittest.main()
