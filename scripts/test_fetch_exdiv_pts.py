#!/usr/bin/env python3
"""Pure unit checks for fetch_exdiv_pts.py; no network requests."""
import unittest

import fetch_exdiv_pts as exdiv


class ExdivPointsTests(unittest.TestCase):
    def test_estimate_uses_share_market_value_and_skips_unannounced_rows(self):
        cal = {'exdiv': [
            {'d': '2026-12-01', 'code': '2330', 'name': '台積電', 'cash': 5, 'm': 'twse'},
            {'d': '2026-12-01', 'code': '0050', 'name': '元大台灣50', 'cash': 2, 'm': 'twse'},
            {'d': '2026-12-02', 'code': '2317', 'name': '鴻海', 'cash': None, 'm': 'twse'},
            {'d': '2026-12-01', 'code': '6488', 'name': '環球晶', 'cash': 3, 'm': 'tpex'},
            {'d': '2026-12-01', 'code': '2330', 'name': '台積電', 'cash': 5, 'm': 'twse'},
        ]}
        # TAIEX=100, total capitalization=10,000 => divisor=100.
        result = exdiv.estimate(cal, '2026-11-26', {'2330': 6000, '2317': 4000},
                                {'2330': 1000, '2317': 1000},
                                {'2330': 6, '2317': 4}, 100, '2026-12-16')
        self.assertEqual(result['meta']['rows'], 1)
        self.assertEqual(result['meta']['totalPoints'], 50.0)
        self.assertEqual(result['events'][0]['weight'], 0.6)

    def test_ignores_events_outside_near_month_settlement_window(self):
        cal = {'exdiv': [{'d': '2026-12-17', 'code': '2330', 'name': '台積電',
                          'cash': 5, 'm': 'twse'}]}
        result = exdiv.estimate(cal, '2026-11-26', {'2330': 10000},
                                {'2330': 1000}, {'2330': 10}, 100, '2026-12-16')
        self.assertEqual(result['events'], [])

    def test_monthly_settlement_is_third_wednesday(self):
        self.assertEqual(exdiv.monthly_settle(exdiv.date(2026, 11, 16)), '2026-11-18')
        self.assertEqual(exdiv.monthly_settle(exdiv.date(2026, 11, 19)), '2026-12-16')

    def test_table_parser_uses_declared_fields(self):
        doc = {'tables': [{'fields': ['證券代號', '證券名稱', '收盤價'],
                           'data': [['2330', '台積電', '1,500.00']]}]}
        rows = list(exdiv.rows_by_fields(doc, {
            'code': ('證券代號',), 'close': ('收盤價',), 'name': ('證券名稱',)
        }))
        self.assertEqual(rows, [{'code': '2330', 'close': '1,500.00', 'name': '台積電'}])

    def test_latest_index_uses_latest_published_day_not_future_rows(self):
        doc = {'fields': ['日期', '發行量加權股價指數'],
               'data': [['115/11/25', '38,195.43'], ['115/11/26', '39,151.81'],
                        ['115/11/27', '40,000.00']]}
        self.assertEqual(exdiv.latest_taiex(doc, '2026-11-26'), ('2026-11-26', 39151.81))


if __name__ == '__main__':
    unittest.main()
