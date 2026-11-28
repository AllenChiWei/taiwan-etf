#!/usr/bin/env python3
"""從 top10.json 與 etf_holdings.json 收集非台股股票類 ISIN，呼叫 OpenFIGI v3 mapping API
轉成「代號 交易所」，讀寫 app/public/data/isin_ticker.json。

特性：
- 免 API key（無 key 上限每分鐘 25 次請求、每次最多 10 筆，本腳本每批 10 筆並節流 2.6 秒，遇 429/5xx 自動重試）。
- 增量補齊：保留既有 isin_ticker.json（首次建檔時以 app/src/lib/isinTicker.ts 作種子），只查詢新 ISIN；
  查無股票對照者記在 miss，30 天內不重查；--max N（預設 300）限制單次查詢筆數。
- 排除非股票成分：債券／票券／基金／ETF／REIT 類型與名稱、XS／US912／US9128／TW 開頭、
  利率＋到期日債券格式（如 T 4 3/4 05/15/55）與台股代號。
- 每個 ISIN 優先挑選主要交易所綜合代碼（US/JP/KS/KQ/HK/CH/LN/GR/FP/NA/SW/CN/AU/IN/VN...），
  刻意壓低美國場外粉紅單（Foreign Sh. / OTC），避免日／港／歐股被誤配到美股 OTC 代號。
- 網路或 API 失敗不讓整支掛掉，保留已完成進度與既有檔案。
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
DEFAULT_HOLDINGS = ROOT / "app" / "public" / "data" / "etf_holdings.json"
DEFAULT_ETFS = ROOT / "app" / "public" / "data" / "etfs.json"
DEFAULT_SEED_TS = ROOT / "app" / "src" / "lib" / "isinTicker.ts"
DEFAULT_OUT = ROOT / "app" / "public" / "data" / "isin_ticker.json"

OPENFIGI_URL = "https://api.openfigi.com/v3/mapping"
USER_AGENT = (
    "Mozilla/5.0 (compatible; TaiwanETF/1.0; +https://allenchiwei.github.io/taiwan-etf/) "
    "ISIN ticker mapper"
)
BATCH_SIZE = 10
THROTTLE_SECONDS = 2.6
MAX_RETRIES = 4
DEFAULT_MAX_QUERIES = 300
MISS_COOLDOWN_DAYS = 30

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")
# XS＝歐洲債、US912＝美國國庫券／公債（含 US9127／US9128）、TW＝台股
SKIP_ISIN_PREFIXES = ("XS", "US912", "TW")
NON_STOCK_TYPE_RE = re.compile(
    r"公債|公司債|金融債|可轉債|債券|債|短期票券|票券|附買回|"
    r"期貨|期指|選擇權|權證|"
    r"受益憑證|共同基金|境外基金|貨幣市場基金|基金|"
    r"不動產投資信託|(?<![A-Z])(?:ETF|ETP|ETN|REITs?)(?![A-Z])",
    re.IGNORECASE,
)
NON_STOCK_NAME_RE = re.compile(
    r"期貨|期指|公債|公司債|金融債|可轉債|債券|短期票券|票券|附買回|"
    r"共同基金|境外基金|貨幣市場基金|房產基金|不動產投資信託|"
    r"(?<![A-Z])(?:ETF|ETP|ETN|REITs?)(?![A-Z])|"
    r"\b(?:TREASURY|T-BILL|BOND|NOTES?|DEBENTURE|MTN|GMTN|COUPON|GILTS?|MUTUAL\s+FUND|INDEX\s+FUND|NEXT\s+FUNDS)\b",
    re.IGNORECASE,
)
# 排除常見債券名稱：利率（整數／小數／分數／V浮動）＋到期日（如 T 4 3/4 05/15/55、MSFT 2.921 03/17/52、CVS 6% 01JUN2044）
BOND_COUPON_MATURITY_RE = re.compile(
    r"(?:^|[\s(])V?\d{1,2}(?:\.\d+|\s+\d+/\d+)?%?\s+"
    r"(?:0?[1-9]|1[0-2])/(?:0?[1-9]|[12]\d|3[01])/\d{2,4}(?:\b|$)"
    r"|\d{1,2}(?:\.\d+)?\s*(?:%|PCT)\s+"
    r"(?:\d{1,2}[-\s]?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-\s]?\d{2,4}"
    r"|\d{2}/\d{2}/\d{2,4}|(?:19|20|21)\d{2})\b",
    re.IGNORECASE,
)
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


def _ensure_utf8_stdio() -> None:
    """Windows 本機預設 cp950 時安全切為 UTF-8，避免中文日誌噴編碼錯。"""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:  # noqa: BLE001
                pass


def is_stock_isin_candidate(sid: str, name: str = "", row_type: str = "") -> bool:
    """判斷單一持股列是否為應向 OpenFIGI 查詢的非台股股票 ISIN。"""
    code = str(sid or "").strip().upper()
    if not ISIN_RE.match(code):
        return False
    if code.startswith(SKIP_ISIN_PREFIXES):
        return False
    rtype = str(row_type or "").strip()
    if rtype and NON_STOCK_TYPE_RE.search(rtype):
        return False
    nm = str(name or "").strip()
    if nm and (NON_STOCK_NAME_RE.search(nm) or BOND_COUPON_MATURITY_RE.search(nm)):
        return False
    return True


def load_ts_seed(ts_path: Path | None) -> dict[str, str]:
    if not ts_path or not ts_path.exists():
        return {}
    text = ts_path.read_text(encoding="utf-8")
    return {m.group(1): m.group(2) for m in EXISTING_PAIR_RE.finditer(text)}


def load_existing_state(
    out_path: Path,
    seed_ts_path: Path | None = None,
) -> tuple[dict[str, str], dict[str, str]]:
    """讀取既有 isin_ticker.json（map 與 miss）；首次尚未建檔時以 isinTicker.ts 作種子。"""
    mapping: dict[str, str] = {}
    miss: dict[str, str] = {}
    if out_path.exists():
        try:
            doc = json.loads(out_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as err:
            print(f"警告：既有 {out_path} 讀取失敗（{err}），改以種子對照表起算", file=sys.stderr)
            mapping.update(load_ts_seed(seed_ts_path))
            return mapping, miss
        if isinstance(doc, dict):
            raw_map = doc.get("map")
            if isinstance(raw_map, dict):
                for k, v in raw_map.items():
                    ks = str(k or "").strip().upper()
                    vs = str(v or "").strip()
                    if ISIN_RE.match(ks) and vs:
                        mapping[ks] = vs
            raw_miss = doc.get("miss")
            if isinstance(raw_miss, dict):
                for k, v in raw_miss.items():
                    ks = str(k or "").strip().upper()
                    vs = str(v or "").strip()
                    if ISIN_RE.match(ks) and vs and ks not in mapping:
                        miss[ks] = vs
        return mapping, miss

    mapping.update(load_ts_seed(seed_ts_path))
    return mapping, miss


def should_skip_miss(
    last_queried: str | None,
    today: date,
    cooldown_days: int = MISS_COOLDOWN_DAYS,
) -> bool:
    """查不到的 ISIN 在冷卻天數內（預設 30 天）不重查。"""
    if not last_queried or cooldown_days <= 0:
        return False
    try:
        last_d = date.fromisoformat(str(last_queried).strip()[:10])
    except ValueError:
        return False
    return (today - last_d).days < cooldown_days


def select_pending_isins(
    all_isins: list[str],
    mapping: dict[str, str],
    miss: dict[str, str],
    today: date,
    *,
    max_queries: int = DEFAULT_MAX_QUERIES,
    cooldown_days: int = MISS_COOLDOWN_DAYS,
    refresh: bool = False,
) -> tuple[list[str], int, int]:
    """回傳 (本次待查清單, 待查總筆數, 因 miss 冷卻跳過筆數)。"""
    pending: list[str] = []
    skipped_miss = 0
    for isin in all_isins:
        if not refresh and isin in mapping:
            continue
        if not refresh and should_skip_miss(miss.get(isin), today, cooldown_days):
            skipped_miss += 1
            continue
        pending.append(isin)
    total_pending = len(pending)
    limit = max(0, int(max_queries))
    return pending[:limit], total_pending, skipped_miss


def collect_stock_isins(
    top10_path: Path | None,
    etfs_path: Path | None,
    holdings_path: Path | None = None,
) -> list[str]:
    """從 top10.json 與 etf_holdings.json 收集非台股股票類 ISIN。"""
    skip_codes: set[str] = set()
    if etfs_path and etfs_path.exists():
        etfs_doc = json.loads(etfs_path.read_text(encoding="utf-8"))
        for etf in etfs_doc.get("etfs", []):
            if etf.get("sec") in SKIP_ETF_SECS and etf.get("code"):
                skip_codes.add(etf["code"])

    isins: set[str] = set()

    if top10_path and top10_path.exists():
        top10_doc = json.loads(top10_path.read_text(encoding="utf-8"))
        for code, entry in (top10_doc.get("etfs") or {}).items():
            if code in skip_codes or not isinstance(entry, dict):
                continue
            for row in entry.get("rows") or []:
                if not isinstance(row, list) or len(row) < 4:
                    continue
                row_type = str(row[1] or "")
                sid = str(row[2] or "").strip().upper()
                name = str(row[3] or "")
                if is_stock_isin_candidate(sid, name, row_type):
                    isins.add(sid)

    if holdings_path and holdings_path.exists():
        holdings_doc = json.loads(holdings_path.read_text(encoding="utf-8"))
        for code, entry in (holdings_doc.get("etfs") or {}).items():
            if code in skip_codes or not isinstance(entry, dict):
                continue
            for row in entry.get("holdings") or []:
                if not isinstance(row, list) or len(row) < 2:
                    continue
                sid = str(row[0] or "").strip().upper()
                name = str(row[1] or "")
                row_type = str(row[4] or "") if len(row) >= 5 else ""
                if is_stock_isin_candidate(sid, name, row_type):
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
            if err.code == 429 and attempt < MAX_RETRIES:
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


def write_json_file(
    out_path: Path,
    mapping: dict[str, str],
    miss: dict[str, str],
    today_str: str,
) -> None:
    clean_map = {k: mapping[k] for k in sorted(mapping)}
    clean_miss = {k: miss[k] for k in sorted(miss) if k not in clean_map}
    doc = {
        "meta": {
            "updated": today_str,
            "count": len(clean_map),
        },
        "map": clean_map,
        "miss": clean_miss,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def run_update(
    *,
    top10_path: Path | None,
    holdings_path: Path | None,
    etfs_path: Path | None,
    out_path: Path,
    seed_ts_path: Path | None = DEFAULT_SEED_TS,
    max_queries: int = DEFAULT_MAX_QUERIES,
    cooldown_days: int = MISS_COOLDOWN_DAYS,
    refresh: bool = False,
    dry_run: bool = False,
    today: date | None = None,
    throttle_seconds: float = THROTTLE_SECONDS,
) -> dict[str, int | bool]:
    today = today or date.today()
    today_str = today.isoformat()
    out_existed = out_path.exists()

    all_isins = collect_stock_isins(top10_path, etfs_path, holdings_path)
    if refresh:
        mapping, miss = {}, {}
    else:
        mapping, miss = load_existing_state(out_path, seed_ts_path)

    to_query, total_pending, skipped_miss = select_pending_isins(
        all_isins,
        mapping,
        miss,
        today,
        max_queries=max_queries,
        cooldown_days=cooldown_days,
        refresh=refresh,
    )

    print(
        f"股票類海外 ISIN 共 {len(all_isins)} 筆，既有對照 {len(mapping)} 筆，"
        f"{cooldown_days} 天內未對應跳過 {skipped_miss} 筆，待查詢 {total_pending} 筆"
        f"（本次上限 {max(0, int(max_queries))}，實際查詢 {len(to_query)} 筆）"
    )

    added = 0
    newly_missed = 0
    unmatched: list[str] = []
    had_error = False
    total_batches = (len(to_query) + BATCH_SIZE - 1) // BATCH_SIZE

    for idx in range(0, len(to_query), BATCH_SIZE):
        batch = to_query[idx : idx + BATCH_SIZE]
        batch_no = idx // BATCH_SIZE + 1
        print(f"[{batch_no}/{total_batches}] 查詢 {len(batch)} 筆：{batch[0]} .. {batch[-1]}")
        try:
            results = query_openfigi_batch(batch)
            if not isinstance(results, list) or len(results) != len(batch):
                raise ValueError(
                    f"OpenFIGI 回傳筆數異常（預期 {len(batch)}，實得 {type(results).__name__}）"
                )
        except Exception as err:  # noqa: BLE001
            had_error = True
            print(
                f"  OpenFIGI 批次 {batch_no} 失敗（{err}），中止剩餘查詢並保留已完成進度",
                file=sys.stderr,
            )
            break

        for isin, res in zip(batch, results):
            items = res.get("data") if isinstance(res, dict) else None
            picked = pick_best_openfigi(isin, items or [])
            if picked:
                mapping[isin] = picked
                miss.pop(isin, None)
                added += 1
            else:
                miss[isin] = today_str
                newly_missed += 1
                unmatched.append(isin)
        if batch_no < total_batches and throttle_seconds > 0:
            time.sleep(throttle_seconds)

    print(
        f"新增對照 {added} 筆，未對應 {len(unmatched)} 筆（已記進 miss），"
        f"總計對照 {len(mapping)} 筆、miss {len(miss)} 筆"
    )
    if unmatched:
        print(f"本次未對應 ISIN（前 20 筆）：{', '.join(unmatched[:20])}")

    wrote = False
    if dry_run:
        print("--dry-run 模式，未寫入檔案。")
    elif had_error and added == 0 and newly_missed == 0 and out_existed:
        print("本次查詢失敗且無新增進度，保留既有檔案不覆寫。", file=sys.stderr)
    elif out_existed and not refresh and added == 0 and newly_missed == 0:
        print("無新增待查或變動，既有對照檔維持不變。")
    else:
        write_json_file(out_path, mapping, miss, today_str)
        wrote = True
        print(f"已寫入 {out_path}")

    return {
        "collected": len(all_isins),
        "pending": total_pending,
        "queried": len(to_query),
        "skipped_miss": skipped_miss,
        "added": added,
        "missed": newly_missed,
        "total_map": len(mapping),
        "total_miss": len(miss),
        "had_error": had_error,
        "wrote": wrote,
    }


def main() -> None:
    _ensure_utf8_stdio()
    ap = argparse.ArgumentParser(description="透過 OpenFIGI 增量補齊 ISIN →「代號 交易所」對照檔")
    ap.add_argument("--top10", type=Path, default=DEFAULT_TOP10, help="top10.json 路徑")
    ap.add_argument("--holdings", type=Path, default=DEFAULT_HOLDINGS, help="etf_holdings.json 路徑")
    ap.add_argument("--etfs", type=Path, default=DEFAULT_ETFS, help="etfs.json 路徑（用來排除債券／槓反 ETF）")
    ap.add_argument("--seed-ts", type=Path, default=DEFAULT_SEED_TS, help="首次建檔用的內建 isinTicker.ts 路徑")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="讀寫的 isin_ticker.json 路徑")
    ap.add_argument("--max", dest="max_queries", type=int, default=DEFAULT_MAX_QUERIES, help="單次最多查詢筆數（預設 300）")
    ap.add_argument("--miss-days", type=int, default=MISS_COOLDOWN_DAYS, help="miss 冷卻天數（預設 30）")
    ap.add_argument("--refresh", action="store_true", help="忽略既有對照與 miss，全量重新查詢")
    ap.add_argument("--dry-run", action="store_true", help="僅統計並印出結果，不寫檔")
    args = ap.parse_args()

    try:
        run_update(
            top10_path=args.top10,
            holdings_path=args.holdings,
            etfs_path=args.etfs,
            out_path=args.out,
            seed_ts_path=args.seed_ts,
            max_queries=args.max_queries,
            cooldown_days=args.miss_days,
            refresh=args.refresh,
            dry_run=args.dry_run,
        )
    except Exception as err:  # noqa: BLE001
        print(f"gen_isin_ticker.py 發生未預期錯誤（保留既有資料）：{err}", file=sys.stderr)


if __name__ == "__main__":
    main()
