# -*- coding: utf-8 -*-
import unittest

import pandas as pd

from fetch_calc import split_adjust
from fill_summary import summarize_fills


class FillSummaryTests(unittest.TestCase):
    def test_fill_days_and_unfilled_gap(self):
        dates = pd.to_datetime(['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07'])
        close = pd.Series([100, 94, 99, 100], index=dates)
        dividends = pd.Series([6], index=[dates[1]])

        result = summarize_fills(close, dividends)

        self.assertEqual(result['events'][0]['days'], 2)
        self.assertTrue(result['events'][0]['filled'])
        self.assertEqual(result['payoutCv3y'], None)

        still_unfilled = summarize_fills(close.iloc[:3], dividends)
        self.assertFalse(still_unfilled['events'][0]['filled'])
        self.assertEqual(still_unfilled['events'][0]['gapPct'], 1.0)

    def test_split_adjusted_reference_price(self):
        dates = pd.to_datetime(['2025-06-17', '2025-06-18', '2025-06-19', '2025-06-20'])
        # 1 拆 4 後由 100 元變成 25 元；次日除息 2 元，再於隔日填息。
        close = pd.Series([100, 25, 23, 25], index=dates)
        ratio = pd.Series([1, 4, 4 / (23 / 25), 4 / (23 / 25)], index=dates)
        adj = close * ratio

        split_close, dividends, splits, _ = split_adjust(close, adj)
        result = summarize_fills(split_close, dividends)

        self.assertEqual(splits[0]['ratio'], 4.0)
        self.assertAlmostEqual(float(dividends.iloc[0]), 2.0)
        self.assertAlmostEqual(float(split_close.iloc[0]), 25.0)
        self.assertEqual(result['events'][0]['days'], 1)

    def test_three_year_payout_coefficient_of_variation(self):
        dates = pd.to_datetime(['2024-01-02', '2024-06-03', '2024-12-02', '2025-06-02'])
        close = pd.Series([100, 100, 100, 100], index=dates)
        dividends = pd.Series([1, 2, 3], index=dates[1:])

        result = summarize_fills(close, dividends)

        self.assertEqual(result['payoutCv3y'], 40.82)
        self.assertEqual(len(result['events']), 3)


if __name__ == '__main__':
    unittest.main()
