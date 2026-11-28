#!/usr/bin/env python3
# -*- coding: utf-8 -*-
u"""純邏輯單元測試：scripts/fetch_us_etf_holdings.py（不發網路請求）。"""
import io
import json
import os
import sys
import tempfile
import unittest

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

import fetch_us_etf_holdings as fuh  # noqa: E402


class FetchUsEtfHoldingsTests(unittest.TestCase):
    def test_honest_user_agent(self):
        self.assertIn('TaiwanETF/1.0', fuh.UA)
        self.assertIn('https://allenchiwei.github.io/taiwan-etf/', fuh.UA)

    def test_parse_invesco_qqq_fixture(self):
        # 依 2026-11-28 實測 Invesco JSON 結構設計測資
        fixture = {
            'effectiveBusinessDate': '2026-11-25',
            'totalNumberOfHoldings': 106,
            'holdings': [
                {
                    'ticker': 'NVDA ',
                    'issuerName': 'NVIDIA Corp',
                    'units': 1234567,
                    'percentageOfTotalNetAssets': 8.5234,
                    'securityTypeName': 'Common Stock',
                    'cusip': '67066G104',
                },
                {
                    'ticker': 'AAPL',
                    'issuerName': 'Apple Inc',
                    'units': 987654,
                    'percentageOfTotalNetAssets': '8.11%',
                    'securityTypeName': 'Common Stock',
                    'cusip': '037833100',
                },
                {
                    'ticker': 'ASML',
                    'issuerName': 'ASML Holding NV',
                    'units': 50000,
                    'percentageOfTotalNetAssets': 1.85,
                    'securityTypeName': 'New York Registry Shares',
                    'cusip': 'N07059210',
                },
                {
                    'ticker': 'PDD',
                    'issuerName': 'PDD Holdings Inc ADR',
                    'units': 60000,
                    'percentageOfTotalNetAssets': 0.92,
                    'securityTypeName': 'American Depositary Receipt',
                    'cusip': '722304102',
                },
                {
                    'ticker': 'BRK/B',
                    'issuerName': 'Berkshire Hathaway Inc',
                    'units': 1000,
                    'percentageOfTotalNetAssets': 0.5,
                    'securityTypeName': 'Ordinary Shares',
                    'cusip': '084670702',
                },
                # 以下非股票項目必須排除
                {
                    'ticker': 'AGPXX',
                    'issuerName': 'Invesco Government & Agency Portfolio',
                    'units': 500000,
                    'percentageOfTotalNetAssets': 0.25,
                    'securityTypeName': 'Money Market Fund',
                    'cusip': '825252885',
                },
                {
                    'ticker': 'USD',
                    'issuerName': 'Cash & Equivalents',
                    'units': 10000,
                    'percentageOfTotalNetAssets': 0.12,
                    'securityTypeName': 'Cash',
                    'cusip': '',
                },
                {
                    'ticker': '912797KL0',
                    'issuerName': 'US Treasury Bill',
                    'units': 10000,
                    'percentageOfTotalNetAssets': 0.30,
                    'securityTypeName': 'U.S. Treasury Bill',
                    'cusip': '912797KL0',
                },
                {
                    'ticker': 'NDXOPT',
                    'issuerName': 'NDX Call Option',
                    'units': 10,
                    'percentageOfTotalNetAssets': 0.40,
                    'securityTypeName': 'Equity Option',
                    'cusip': '',
                },
            ],
        }
        asof, rows = fuh.parse_invesco(fixture)
        self.assertEqual(asof, '2026-11-25')
        self.assertEqual([r[0] for r in rows], ['NVDA', 'AAPL', 'ASML', 'PDD', 'BRK.B'])
        self.assertEqual(rows[0], ['NVDA', 'NVIDIA Corp', 8.523])
        self.assertEqual(rows[1], ['AAPL', 'Apple Inc', 8.11])
        self.assertEqual(rows[4], ['BRK.B', 'Berkshire Hathaway Inc', 0.5])

    def test_parse_neos_qqqi_html_fixture(self):
        # 依 2026-11-28 實測 NEOS HTML 結構設計測資（含頁面上其他干擾表格與日期）
        html = """
        <html><body>
          <section class="perf">
            <p>Data as of 10/31/2026</p>
            <table><tr><th>Period</th><th>Return</th></tr><tr><td>1M</td><td>3.2%</td></tr></table>
          </section>
          <section class="holdings">
            <h2>Top Holdings</h2>
            <p>Data as of 11/30/2026</p>
            <button onclick="downloadHoldingsCSV('QQQI')">Download CSV</button>
            <table>
              <thead>
                <tr><th>Security Name</th><th>Identifier</th><th>Weighting (%)</th></tr>
              </thead>
              <tbody>
                <tr><td>Apple Inc</td><td>AAPL</td><td>9.01%</td></tr>
                <tr><td>NVIDIA Corp</td><td>NVDA</td><td>8.75%</td></tr>
                <tr><td>Berkshire Hathaway Inc Cl B</td><td>BRK/B</td><td>1.42%</td></tr>
                <tr><td>NDX 12/19/2026 Call 22000</td><td>NDX261219C22000</td><td>0.85%</td></tr>
                <tr><td>NDX Put Option</td><td>NDXP</td><td>0.40%</td></tr>
                <tr><td>Cash &amp; Other</td><td>Cash&amp;Other</td><td>1.15%</td></tr>
                <tr><td>US Treasury Bill 0% 01/15/2027</td><td>912797AB1</td><td>2.30%</td></tr>
                <tr><td>SPX 12/19/2026 C6100</td><td>SPX 261219C06100000</td><td>0.22%</td></tr>
              </tbody>
            </table>
          </section>
        </body></html>
        """
        asof, rows = fuh.parse_neos_html(html)
        self.assertEqual(asof, '2026-11-30')
        self.assertEqual([r[0] for r in rows], ['AAPL', 'NVDA', 'BRK.B'])
        self.assertEqual(rows[0], ['AAPL', 'Apple Inc', 9.01])
        self.assertEqual(rows[1], ['NVDA', 'NVIDIA Corp', 8.75])
        self.assertEqual(rows[2], ['BRK.B', 'Berkshire Hathaway Inc Cl B', 1.42])

    def test_neos_crawl_delay_respected(self):
        # 驗證連續兩次打 NEOS 會依 robots.txt Crawl-delay >= 10 秒節流
        slept = []
        now = [100.0]

        def fake_clock():
            return now[0]

        def fake_sleep(sec):
            slept.append(sec)
            now[0] += sec

        class FakeResp(object):
            def read(self):
                return b'<html>ok</html>'

        class FakeOpener(object):
            def open(self, req, timeout=30):
                self.last_ua = req.get_header('User-agent')
                return FakeResp()

        opener = FakeOpener()
        client = fuh.ThrottledClient(opener=opener, sleep_fn=fake_sleep, clock_fn=fake_clock)
        client.fetch_text('neos', 'https://neosfunds.com/qqqi/', 'text/html')
        self.assertEqual(slept, [], '第一次請求不需等待')
        client.fetch_text('neos', 'https://neosfunds.com/spyi/', 'text/html')
        self.assertEqual(len(slept), 1)
        self.assertGreaterEqual(slept[0], 10.0)
        self.assertIn('TaiwanETF/1.0', opener.last_ua)

    def test_merge_and_preserve_previous_on_single_failure(self):
        prev = {'asof': '2026-11-25', 'src': u'Invesco 官網', 'basis': 'full', 'rows': [['AAPL', 'Apple', 8.5]]}
        older = {'asof': '2026-11-24', 'src': u'Invesco 官網', 'basis': 'full', 'rows': [['AAPL', 'Apple', 8.0]]}
        newer = {'asof': '2026-11-26', 'src': u'Invesco 官網', 'basis': 'full', 'rows': [['AAPL', 'Apple', 8.6]]}
        self.assertEqual(fuh.merge_entry(prev, None), prev)
        self.assertEqual(fuh.merge_entry(prev, older), prev, '不可用舊日期蓋掉新日期')
        self.assertEqual(fuh.merge_entry(prev, newer), newer)

        # 實測 run_fetch：QQQ 成功、QQQI 失敗時保留前一版 QQQI
        with tempfile.TemporaryDirectory() as td:
            out_path = os.path.join(td, 'us_etf_holdings.json')
            seed = {
                'meta': {'updated': '2026-11-25', 'count': 1},
                'etfs': {
                    'QQQI': {
                        'asof': '2026-11-25',
                        'src': u'NEOS 官網',
                        'basis': 'top25',
                        'rows': [['AAPL', 'Apple Inc', 9.0]],
                    },
                },
            }
            with io.open(out_path, 'w', encoding='utf-8') as fh:
                json.dump(seed, fh)

            class PartialClient(object):
                def fetch_text(self, provider, url, accept):
                    if 'QQQ/' in url:
                        return json.dumps({
                            'effectiveBusinessDate': '2026-11-26',
                            'holdings': [
                                {'ticker': 'NVDA', 'issuerName': 'NVIDIA Corp',
                                 'percentageOfTotalNetAssets': 8.5, 'securityTypeName': 'Common Stock'},
                            ],
                        })
                    raise RuntimeError('HTTP 503')

            ok, errs, payload = fuh.run_fetch(
                out_path=out_path, only=['QQQ', 'QQQI'], client=PartialClient(), today_iso='2026-11-28')
            self.assertEqual(ok, 1)
            self.assertEqual(len(errs), 1)
            self.assertIn('QQQ', payload['etfs'])
            self.assertEqual(payload['etfs']['QQQ']['asof'], '2026-11-26')
            self.assertIn('QQQI', payload['etfs'], '單檔失敗須保留前一版 QQQI')
            self.assertEqual(payload['etfs']['QQQI']['asof'], '2026-11-25')

    def test_verify_doc_qqq_rules(self):
        # 100 檔 QQQ 合計 99.0% + 20 檔 QQQI 合計 65.0% -> 通過
        qqq_rows = [['S%03d' % i, 'Stock %d' % i, 0.99] for i in range(100)]
        qqqi_rows = [['S%03d' % i, 'Stock %d' % i, 3.25] for i in range(20)]
        good = {
            'meta': {'updated': '2026-11-28'},
            'etfs': {
                'QQQ': {'asof': '2026-11-25', 'src': u'Invesco 官網', 'basis': 'full', 'rows': qqq_rows},
                'QQQM': {'asof': '2026-11-25', 'src': u'Invesco 官網', 'basis': 'full', 'rows': qqq_rows},
                'QQQI': {'asof': '2026-11-25', 'src': u'NEOS 官網', 'basis': 'top25', 'rows': qqqi_rows},
                'SPYI': {'asof': '2026-11-25', 'src': u'NEOS 官網', 'basis': 'top25', 'rows': qqqi_rows},
            },
        }
        errs, warns = fuh.verify_doc(good)
        self.assertEqual(errs, [])
        self.assertEqual(warns, [])

        # QQQ 少於 90 檔或權重低於 95% 必須失敗
        bad_low = {
            'meta': {'updated': '2026-11-28'},
            'etfs': {
                'QQQ': {'asof': '2026-11-25', 'src': u'Invesco 官網', 'basis': 'full',
                        'rows': [['S%03d' % i, 'Stock %d' % i, 1.0] for i in range(80)]},
            },
        }
        errs_low, _ = fuh.verify_doc(bad_low)
        self.assertTrue(any('90' in e for e in errs_low))
        self.assertTrue(any('95%' in e for e in errs_low))

        # QQQ 權重超過 101% 必須失敗
        bad_high = {
            'meta': {'updated': '2026-11-28'},
            'etfs': {
                'QQQ': {'asof': '2026-11-25', 'src': u'Invesco 官網', 'basis': 'full',
                        'rows': [['S%03d' % i, 'Stock %d' % i, 1.1] for i in range(95)]},
            },
        }
        errs_high, _ = fuh.verify_doc(bad_high)
        self.assertTrue(any('101%' in e for e in errs_high))


if __name__ == '__main__':
    unittest.main()
