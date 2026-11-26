#!/usr/bin/env python3
"""從 top10.json 收集非台股股票 ISIN，呼叫 OpenFIGI v3 mapping API 轉成「代號 交易所」，
寫入 app/src/lib/isinTicker.ts。

特性：
- 免 API key（無 key 上限每分鐘 25 次請求、每次最多 10 筆，本腳本每批 10 筆並節流 2.6 秒，遇 429/5xx 自動重試）。
- 預設保留 app/src/lib/isinTicker.ts 既有對照，只查詢新增 ISIN；加 --refresh 才全量重查。
- 每個 ISIN 優先挑選主要交易所綜合代碼（US/JP/KS/KQ/HK/CH/LN/GR/FP/NA/SW/CN/AU/IN/VN...），
  刻意壓低美國場外粉紅單（Foreign Sh. / OTC），避免日／港／歐股被誤配到美股 OTC 代號。
"""

from __future__ import annotations

import argparse
from datetime import date
import json
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TOP10 = ROOT / "app" / "public" / "data" / "top10.json"
DEFAULT_ETFS = ROOT / "app" / "public" / "data" / "etfs.json"
DEFAULT_OUT = ROOT / "app" / "src" / "lib" / "isinTicker.ts"

OPENFIGI_URL = "https://api.openfigi.com/v3/mapping"
USER_AGENT = "TaiwanETF-ISIN-Mapper/1.0"
BATCH_SIZE = 10
THROTTLE_SECONDS = 2.6
MAX_RETRIES = 4

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")
NON_STOCK_TYPE_RE = re.compile(
    r"公債|公司債|金融債|可轉債|債券|短期票券|附買回|債|期貨|期指|選擇權|受益憑證|共同基金|境外基金|貨幣市場基金|ETF",
    re.IGNORECASE,
)
NON_STOCK_NAME_RE = re.compile(r"期貨|期指")
SKIP_ETF_SECS = {"cat-bond", "cat-leveraged", "cat-futures", "cat-leveraged-futures"}

# 與 app/src/lib/portfolioXray.ts 保持一致的交易所別名正規化
EXCH_ALIAS: dict[str, str] = {
    "US": "US", "UW": "US", "UN": "US", "UA": "US", "UQ": "US", "UP": "US", "UR": "US",
    "JP": "JP", "JT": "JP", "JN": "JP", "JO": "JP",
    "KS": "KS", "KP": "KS", "KQ": "KQ", "KD": "KQ",
    "HK": "HK",
    "CH": "CH", "C1": "CH", "C2": "CH", "CG": "CH", "CS": "CH", "SH": "CH", "SZ": "CH",
    "CN": "CN", "CT": "CN", "CV": "CN", "TO": "CN",
    "LN": "LN", "LI": "LN",
    "GR": "GR", "GY": "GR", "GF": "GR", "GD": "GR",
    "FP": "FP",
    "NA": "NA",
    "SW": "SW", "SE": "SW", "VX": "SW",
    "IM": "IM", "SM": "SM", "SQ": "SM", "SS": "SS", "DC": "DC",
    "NO": "NO", "FH": "FH", "BB": "BB", "ID": "ID", "AV": "AV",
    "AU": "AU", "AT": "AU",
    "IN": "IN", "IS": "IN", "IB": "IN",
    "VN": "VN", "VH": "VN", "VM": "VN",
    "SP": "SP",
    "IT": "IT",
    "BZ": "BZ", "BS": "BZ",
    "MM": "MM", "MK": "MK", "TB": "TB", "IJ": "IJ", "PM": "PM", "SJ": "SJ", "NZ": "NZ",
}

US_MAJOR_VENUES = {"UW", "UN", "UA", "UQ", "UP", "UR"}
US_OTC_VENUES = {"PQ", "PK", "UO", "UV"}

COUNTRY_PREF: dict[str, list[str]] = {
    "US": ["US"],
    "JP": ["JP"],
    "KR": ["KS", "KQ"],
    "HK": ["HK", "US"],
    "CN": ["CH", "HK", "US"],
    "KY": ["HK", "US", "LN", "SP"],
    "CA": ["US", "CN"],
    "GB": ["LN", "US"],
    "DE": ["GR", "US"],
    "FR": ["FP", "US"],
    "NL": ["NA", "US"],
    "CH": ["SW", "US"],
    "AU": ["AU", "US"],
    "IN": ["IN", "US"],
    "VN": ["VN"],
    "SG": ["SP", "US"],
    "IT": ["IM", "US"],
    "ES": ["SM", "US"],
    "SE": ["SS", "US"],
    "DK": ["DC", "US"],
    "NO": ["NO", "US"],
    "FI": ["FH", "US"],
    "BE": ["BB", "US"],
    "IE": ["US", "ID", "LN"],
    "IL": ["US", "IT"],
    "AT": ["AV", "US"],
    "BR": ["BZ", "US"],
    "MX": ["MM", "US"],
    "MY": ["MK"],
    "TH": ["TB"],
    "ID": ["IJ"],
    "PH": ["PM"],
    "ZA": ["SJ", "LN", "US"],
    "NZ": ["NZ", "AU"],
}

DEFAULT_EXCH_PREF = [
    "US", "JP", "KS", "KQ", "HK", "CH", "LN", "GR", "FP", "NA", "SW", "CN",
    "AU", "IN", "VN", "SP", "IM", "SM", "SS", "DC", "NO", "FH", "BB", "ID",
    "AV", "IT", "BZ", "MM", "MK", "TB", "IJ", "PM", "SJ", "NZ",
]

SEC_TYPE2_RANK: dict[str, int] = {
    "Common Stock": 0,
    "Depositary Receipt": 1,
    "REIT": 2,
    "Tracking Stock": 3,
    "Partnership Shares": 4,
    "Stapled Security": 5,
    "Preference": 6,
    "Preferred": 6,
    "Unit": 7,
}

EXISTING_PAIR_RE = re.compile(r"""['"]?([A-Z]{2}[A-Z0-9]{9}\d)['"]?\s*:\s*['"]([^'"]+)['"]""")


def load_existing_map(out_path: Path) -> dict[str, str]:
    if not out_path.exists():
        return {}
    text = out_path.read_text(encoding="utf-8")
    return {m.group(1): m.group(2) for m in EXISTING_PAIR_RE.finditer(text)}


def collect_stock_isins(top10_path: Path, etfs_path: Path | None) -> list[str]:
    skip_codes: set[str] = set()
    if etfs_path and etfs_path.exists():
        etfs_doc = json.loads(etfs_path.read_text(encoding="utf-8"))
        for etf in etfs_doc.get("etfs", []):
            if etf.get("sec") in SKIP_ETF_SECS and etf.get("code"):
                skip_codes.add(etf["code"])

    top10_doc = json.loads(top10_path.read_text(encoding="utf-8"))
    isins: set[str] = set()
    for code, entry in top10_doc.get("etfs", {}).items():
        if code in skip_codes:
            continue
        for row in entry.get("rows", []):
            if len(row) < 4:
                continue
            row_type = str(row[1] or "")
            sid = str(row[2] or "").strip().upper()
            name = str(row[3] or "")
            if not ISIN_RE.match(sid):
                continue
            if sid.startswith("XS") or sid.startswith("US9128"):
                continue
            if NON_STOCK_TYPE_RE.search(row_type) or NON_STOCK_NAME_RE.search(name):
                continue
            isins.add(sid)
    return sorted(isins)


def normalize_pair(raw_ticker: str, raw_exch: str) -> str | None:
    exch = EXCH_ALIAS.get(raw_exch.strip().upper())
    if not exch:
        return None
    ticker = raw_ticker.strip().upper()
    if not ticker or " " in ticker:
        return None
    if exch == "HK" and ticker.isdigit():
        ticker = ticker.lstrip("0") or "0"
    elif exch == "US":
        ticker = ticker.replace("/", ".")
    return f"{ticker} {exch}"


def pick_best_openfigi(isin: str, items: list[dict]) -> str | None:
    if not items:
        return None

    # 依 compositeFIGI 收集同組子交易所，辨識美股掛牌是否為場外粉紅單（OTC）
    venues_by_comp: dict[str, set[str]] = {}
    for it in items:
        comp = it.get("compositeFIGI")
        ex = (it.get("exchCode") or "").upper()
        if comp and ex:
            venues_by_comp.setdefault(comp, set()).add(ex)

    country = isin[:2].upper()
    pref = COUNTRY_PREF.get(country, DEFAULT_EXCH_PREF)
    pref_idx = {ex: i for i, ex in enumerate(pref)}
    default_idx = {ex: i for i, ex in enumerate(DEFAULT_EXCH_PREF)}

    scored: list[tuple[int, int, int, int, int, str]] = []
    for it in items:
        if it.get("marketSector") != "Equity":
            continue
        sec_type2 = it.get("securityType2") or ""
        if sec_type2 in ("Mutual Fund", "ETP", "Option", "Warrant", "Right"):
            continue
        raw_ticker = (it.get("ticker") or "").strip()
        raw_exch = (it.get("exchCode") or "").strip().upper()
        if not raw_ticker or not raw_exch:
            continue

        norm_exch = EXCH_ALIAS.get(raw_exch)
        if not norm_exch:
            continue
        pair = normalize_pair(raw_ticker, norm_exch)
        if not pair:
            continue

        sec_type = it.get("securityType") or ""
        comp = it.get("compositeFIGI") or ""
        siblings = venues_by_comp.get(comp, set())

        # 判斷是否為美國場外粉紅單（Foreign Sh. / 僅掛 PQ, PK, UO, UV）
        is_us_otc = False
        if norm_exch == "US":
            if sec_type in ("Foreign Sh.", "NY Reg Shrs") or "OTC" in sec_type.upper():
                is_us_otc = True
            elif siblings and (siblings & US_OTC_VENUES) and not (siblings & US_MAJOR_VENUES):
                is_us_otc = True

        # 是否直接為綜合代碼列（raw_exch == norm_exch，例如 US/JP/KS/HK）
        is_composite = 0 if raw_exch == norm_exch else 1
        otc_penalty = 1 if is_us_otc else 0
        country_rank = pref_idx.get(norm_exch, len(pref) + default_idx.get(norm_exch, 99))
        type2_rank = SEC_TYPE2_RANK.get(sec_type2, 9)
        ticker_len = len(raw_ticker)

        scored.append((otc_penalty, country_rank, type2_rank, is_composite, ticker_len, pair))

    if not scored:
        return None
    scored.sort()
    return scored[0][5]


def query_openfigi_batch(isins: list[str]) -> list[dict]:
    payload = json.dumps(
        [{"idType": "ID_ISIN", "idValue": isin, "marketSecDes": "Equity"} for isin in isins],
        ensure_ascii=False,
    ).encode("utf-8")

    for attempt in range(1, MAX_RETRIES + 1):
        req = urllib.request.Request(
            OPENFIGI_URL,
            data=payload,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "User-Agent": USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            if err.code == 429:
                retry_after = err.headers.get("Retry-After")
                wait = float(retry_after) if retry_after and retry_after.isdigit() else 60.0
                print(f"  OpenFIGI 429 限流，等待 {wait:.0f}s 後重試（{attempt}/{MAX_RETRIES}）", file=sys.stderr)
                time.sleep(wait)
                continue
            if 500 <= err.code < 600 and attempt < MAX_RETRIES:
                wait = 5.0 * attempt
                print(f"  OpenFIGI HTTP {err.code}，等待 {wait:.0f}s 後重試（{attempt}/{MAX_RETRIES}）", file=sys.stderr)
                time.sleep(wait)
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as err:
            if attempt < MAX_RETRIES:
                wait = 5.0 * attempt
                print(f"  連線失敗（{err}），等待 {wait:.0f}s 後重試（{attempt}/{MAX_RETRIES}）", file=sys.stderr)
                time.sleep(wait)
                continue
            raise

    raise RuntimeError(f"OpenFIGI 批次查詢重試 {MAX_RETRIES} 次仍失敗")


def write_ts_file(out_path: Path, mapping: dict[str, str], today_str: str) -> None:
    lines = [
        "/* 由 scripts/gen_isin_ticker.py 透過 OpenFIGI API 自動產生，請勿手動修改。",
        f" * 產生日期：{today_str}（共 {len(mapping)} 筆）",
        " * 重跑方式：python scripts/gen_isin_ticker.py（保留既有對照、僅補查新 ISIN；加 --refresh 全量重查）",
        " */",
        "",
        "export const ISIN_TICKER: Record<string, string> = {",
    ]
    for isin in sorted(mapping):
        lines.append(f"  '{isin}': '{mapping[isin]}',")
    lines.append("};")
    lines.append("")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description="透過 OpenFIGI 產生 ISIN →「代號 交易所」對照表")
    ap.add_argument("--top10", type=Path, default=DEFAULT_TOP10, help="top10.json 路徑")
    ap.add_argument("--etfs", type=Path, default=DEFAULT_ETFS, help="etfs.json 路徑（用來排除債券／槓反 ETF）")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="輸出的 isinTicker.ts 路徑")
    ap.add_argument("--refresh", action="store_true", help="忽略既有對照，全量重新查詢")
    ap.add_argument("--dry-run", action="store_true", help="僅統計並印出結果，不寫檔")
    args = ap.parse_args()

    all_isins = collect_stock_isins(args.top10, args.etfs)
    mapping = {} if args.refresh else load_existing_map(args.out)
    pending = [isin for isin in all_isins if isin not in mapping]

    print(f"top10.json 非台股股票 ISIN 共 {len(all_isins)} 筆，既有對照 {len(mapping)} 筆，待查詢 {len(pending)} 筆")

    added = 0
    unmatched: list[str] = []
    total_batches = (len(pending) + BATCH_SIZE - 1) // BATCH_SIZE

    for idx in range(0, len(pending), BATCH_SIZE):
        batch = pending[idx : idx + BATCH_SIZE]
        batch_no = idx // BATCH_SIZE + 1
        print(f"[{batch_no}/{total_batches}] 查詢 {len(batch)} 筆：{batch[0]} .. {batch[-1]}")
        results = query_openfigi_batch(batch)
        for isin, res in zip(batch, results):
            items = res.get("data") if isinstance(res, dict) else None
            picked = pick_best_openfigi(isin, items or [])
            if picked:
                mapping[isin] = picked
                added += 1
            else:
                unmatched.append(isin)
        if batch_no < total_batches:
            time.sleep(THROTTLE_SECONDS)

    print(f"新增對照 {added} 筆，未對應 {len(unmatched)} 筆，總計 {len(mapping)} 筆")
    if unmatched:
        print(f"未對應 ISIN（前 20 筆）：{', '.join(unmatched[:20])}")

    if args.dry_run:
        print("--dry-run 模式，未寫入檔案。")
        return

    write_ts_file(args.out, mapping, date.today().isoformat())
    print(f"已寫入 {args.out}")


if __name__ == "__main__":
    main()
