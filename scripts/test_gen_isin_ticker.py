#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""純邏輯單元測試：scripts/gen_isin_ticker.py（不發網路請求）。"""

from __future__ import annotations

from datetime import date
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

import gen_isin_ticker as git  # noqa: E402


class GenIsinTickerTests(unittest.TestCase):
    def test_honest_user_agent(self) -> None:
        self.assertIn("TaiwanETF/1.0", git.USER_AGENT)
        self.assertIn("https://allenchiwei.github.io/taiwan-etf/", git.USER_AGENT)

    def test_non_stock_exclusions(self) -> None:
        # 1. 美國公債／國庫券（US912／US9128）與歐洲債（XS）
        self.assertFalse(git.is_stock_isin_candidate("US912810UK24", "US TREASURY N/B 4.75% 05/15/2055", "政府公債 無擔保"))
        self.assertFalse(git.is_stock_isin_candidate("US912810UK24", "", ""))
        self.assertFalse(git.is_stock_isin_candidate("US912797KL01", "US T-BILL", ""))
        self.assertFalse(git.is_stock_isin_candidate("XS1959337749", "QATAR 4.817 03/14/49", ""))

        # 2. 名稱像債券（利率＋到期日格式，即使缺少 row_type 也須排除）
        self.assertFalse(git.is_stock_isin_candidate("US00206RCQ39", "T 4 3/4 05/15/55", ""))
        self.assertFalse(git.is_stock_isin_candidate("US00206RMN97", "T 5 05/15/56", ""))
        self.assertFalse(git.is_stock_isin_candidate("US594918CE21", "MSFT 2.921 03/17/52", ""))
        self.assertFalse(git.is_stock_isin_candidate("US281020AX52", "EIX V8.125 06/15/53", ""))
        self.assertFalse(git.is_stock_isin_candidate("US126650EE63", "CVS HEALTH CORP (REG) 6% 01JUN2044", ""))
        self.assertFalse(git.is_stock_isin_candidate("US00206RND07", "AT&T INC 5.550000 % 01-NOV-2045", ""))
        self.assertFalse(git.is_stock_isin_candidate("DE0001102481", "EURO BOND 3.5% 2030", ""))

        # 3. 日本 REIT／TOPIX ETF／港股 ETF
        self.assertFalse(git.is_stock_isin_candidate("JP3048350007", "iFreeETF東京證交所REIT指數", "國外掛牌交易之ETF"))
        self.assertFalse(git.is_stock_isin_candidate("JP3048350007", "iFreeETF東京證交所REIT指數", ""))
        self.assertFalse(git.is_stock_isin_candidate("JP3046400002", "JAPAN HOTEL REIT INVESTMENT CORPORATION", "國外股票(含承銷)"))
        self.assertFalse(git.is_stock_isin_candidate("JP3047820000", "SEKISUI HOUSE REIT INC", "國外股票(含承銷)"))
        self.assertFalse(git.is_stock_isin_candidate("JP3027630007", "NEXT FUNDS TOPIX ETF", "國外掛牌交易之ETF"))
        self.assertFalse(git.is_stock_isin_candidate("JP3027630007", "NEXT FUNDS TOPIX ETF", ""))
        self.assertFalse(git.is_stock_isin_candidate("HK2827039002", "BOCI-PRUDENTIAL-W.I.S.E -HKD", "國外掛牌交易之ETF"))

        # 4. 類型字樣（債券／票券／基金／ETF／REIT／期貨）
        self.assertFalse(git.is_stock_isin_candidate("US037833ER75", "APPLE INC", "公司債 無擔保"))
        self.assertFalse(git.is_stock_isin_candidate("US38141GC514", "GOLDMAN SACHS", "金融債-Tlac 無擔保"))
        self.assertFalse(git.is_stock_isin_candidate("US1234567890", "SHORT BILL", "短期票券"))
        self.assertFalse(git.is_stock_isin_candidate("LU1987066120", "Eastspring Asian High Yield", "依境外基金管理辦法經金管會核准之境外基金"))
        self.assertFalse(git.is_stock_isin_candidate("SG1T22929874", "KEPPEL", "不動產投資信託"))
        self.assertFalse(git.is_stock_isin_candidate("SG1T22929874", "KEPPEL", "REIT"))

        # 5. 台股代號與非 ISIN 寫法
        for code in ("2330", "0050", "00981A", "TW0002330008", "AAPL US", "6857 JP", "TX"):
            self.assertFalse(git.is_stock_isin_candidate(code, "台積電", "國內上市"), code)

    def test_valid_stock_isins_kept(self) -> None:
        valid_cases = [
            ("US0378331005", "APPLE INC", "國外股票(含承銷)"),
            ("US67066G1040", "NVIDIA CORP", "國外股票(含承銷)"),
            ("US8740391003", "TAIWAN SEMIC-ADR", "國外存託憑證"),
            ("JP3122400009", "ADVANTEST CORP", "國外股票(含承銷)"),
            ("KR7005930003", "SAMSUNG ELECTRONICS CO LTD", "國外股票(含承銷)"),
            ("US6658591044", "Northern Trust Corp", "國外股票(含承銷)"),
            ("US44812J1043", "HUT 8 CORP", "國外股票(含承銷)"),
            ("US88025U1097", "10X GENOMICS INC-CLASS A", "國外股票(含承銷)"),
            ("US9581021055", "WESTERN DIGITAL", ""),
        ]
        for sid, name, rtype in valid_cases:
            self.assertTrue(git.is_stock_isin_candidate(sid, name, rtype), f"{sid} {name} 應保留為股票候選")

    def test_collect_from_top10_and_etf_holdings(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            etfs_p = root / "etfs.json"
            top10_p = root / "top10.json"
            hold_p = root / "etf_holdings.json"

            etfs_p.write_text(json.dumps({
                "etfs": [
                    {"code": "00646", "sec": "cat-foreign"},
                    {"code": "00679B", "sec": "cat-bond"},
                    {"code": "00980T", "sec": "cat-foreign"},
                ],
            }), encoding="utf-8")

            top10_p.write_text(json.dumps({
                "etfs": {
                    "00646": {
                        "rows": [
                            [1, "國外股票(含承銷)", "US0378331005", "APPLE INC", 7.5],
                            [2, "國外掛牌交易之ETF", "HK2827039002", "BOCI-PRUDENTIAL-W.I.S.E -HKD", 5.0],
                        ],
                    },
                    "00679B": {
                        "rows": [
                            [1, "政府公債 無擔保", "US912810UK24", "T 4 3/4 05/15/55", 5.0],
                        ],
                    },
                },
            }), encoding="utf-8")

            hold_p.write_text(json.dumps({
                "etfs": {
                    "00980T": {
                        "basis": "quarterly1pct",
                        "holdings": [
                            ["US67066G1040", "NVIDIA Corp", 0, 14.64, "國外股票(含承銷)"],
                            ["US91282CKN01", "T 4 5/8 04/30/31", 0, 1.38, "政府公債 無擔保"],
                            ["US9581021055", "WESTERN DIGITAL", 100, 2.5],  # 4 欄 PCF 格式
                            ["2330", "台積電", 1000, 10.0],
                            ["AAPL US", "蘋果", 100, 5.0],
                            ["JP3048350007", "iFreeETF東京證交所REIT指數", 100, 98.12, "國外掛牌交易之ETF"],
                            ["JP3027630007", "NEXT FUNDS TOPIX ETF", 100, 97.07, "國外掛牌交易之ETF"],
                        ],
                    },
                },
            }), encoding="utf-8")

            got = git.collect_stock_isins(top10_p, etfs_p, hold_p)
            self.assertEqual(got, ["US0378331005", "US67066G1040", "US9581021055"])

    def test_miss_cooldown_and_max_limit(self) -> None:
        today = date(2026, 11, 28)
        self.assertTrue(git.should_skip_miss("2026-11-20", today, 30))
        self.assertTrue(git.should_skip_miss("2026-10-30", today, 30))   # 29 天前 → 跳過
        self.assertFalse(git.should_skip_miss("2026-10-29", today, 30))  # 30 天前 → 重查
        self.assertFalse(git.should_skip_miss(None, today, 30))

        all_isins = [
            "US0378331005",  # 已在 map
            "US1111111111",  # miss 10 天前 → 跳過
            "US2222222222",  # miss 35 天前 → 重查
            "US3333333333",  # 新 ISIN
            "US4444444444",  # 新 ISIN（超過 max=2 被截斷）
        ]
        mapping = {"US0378331005": "AAPL US"}
        miss = {"US1111111111": "2026-11-18", "US2222222222": "2026-10-24"}

        to_query, total_pending, skipped_miss = git.select_pending_isins(
            all_isins, mapping, miss, today, max_queries=2, cooldown_days=30,
        )
        self.assertEqual(skipped_miss, 1)
        self.assertEqual(total_pending, 3)
        self.assertEqual(to_query, ["US2222222222", "US3333333333"])

    def test_seed_json_roundtrip_and_failure_resilience(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            seed_ts = root / "isinTicker.ts"
            out_json = root / "isin_ticker.json"
            top10_p = root / "top10.json"
            hold_p = root / "etf_holdings.json"

            seed_ts.write_text(
                "export const ISIN_TICKER: Record<string, string> = {\n"
                "  'US0378331005': 'AAPL US',\n"
                "};\n",
                encoding="utf-8",
            )
            top10_p.write_text(json.dumps({
                "etfs": {
                    "00646": {
                        "rows": [
                            [1, "國外股票(含承銷)", "US0378331005", "APPLE INC", 8.0],
                            [2, "國外股票(含承銷)", "US9581021055", "WESTERN DIGITAL", 2.5],
                            [3, "國外股票(含承銷)", "XX0000000001", "UNKNOWN CORP", 1.0],
                        ],
                    },
                },
            }), encoding="utf-8")
            # 12 筆新 ISIN 中的後 2 筆會落到第 2 批（模擬第 2 批網路失敗）
            extra_rows = [
                [f"US00000000{i:02d}", f"STOCK {i}", 0, 1.0, "國外股票(含承銷)"]
                for i in range(10, 20)
            ]
            hold_p.write_text(json.dumps({
                "etfs": {"00999": {"basis": "quarterly1pct", "holdings": extra_rows}},
            }), encoding="utf-8")

            calls = {"n": 0}

            def fake_query(batch: list[str]) -> list[dict]:
                calls["n"] += 1
                if calls["n"] == 2:
                    raise RuntimeError("模擬網路中斷")
                resp = []
                for isin in batch:
                    if isin == "US9581021055":
                        resp.append({"data": [{"marketSector": "Equity", "securityType2": "Common Stock", "ticker": "WDC", "exchCode": "US"}]})
                    else:
                        resp.append({"data": []})
                return resp

            with mock.patch.object(git, "query_openfigi_batch", side_effect=fake_query):
                res = git.run_update(
                    top10_path=top10_p,
                    holdings_path=hold_p,
                    etfs_path=None,
                    out_path=out_json,
                    seed_ts_path=seed_ts,
                    max_queries=300,
                    today=date(2026, 11, 28),
                    throttle_seconds=0.0,
                )

            self.assertTrue(res["had_error"])
            self.assertTrue(res["wrote"])
            saved = json.loads(out_json.read_text(encoding="utf-8"))
            self.assertEqual(saved["meta"]["updated"], "2026-11-28")
            self.assertEqual(saved["map"]["US0378331005"], "AAPL US")
            # 第 1 批（10 筆）均為 US0000000010..19（已進 miss），第 2 批失敗的 US9581021055／XX0000000001 不得誤記進 miss
            self.assertEqual(len(saved["miss"]), 10)
            self.assertNotIn("US9581021055", saved["miss"])
            self.assertNotIn("XX0000000001", saved["miss"])

            # 再次執行若第 1 批直接失敗，不得覆寫既有檔案
            before_text = out_json.read_text(encoding="utf-8")
            with mock.patch.object(git, "query_openfigi_batch", side_effect=RuntimeError("API 503")):
                res2 = git.run_update(
                    top10_path=top10_p,
                    holdings_path=hold_p,
                    etfs_path=None,
                    out_path=out_json,
                    seed_ts_path=seed_ts,
                    max_queries=300,
                    today=date(2026, 11, 29),
                    throttle_seconds=0.0,
                )
            self.assertTrue(res2["had_error"])
            self.assertFalse(res2["wrote"])
            self.assertEqual(out_json.read_text(encoding="utf-8"), before_text)


if __name__ == "__main__":
    unittest.main()
