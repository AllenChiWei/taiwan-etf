/* 民生必需股（defensive.json，scripts/fetch_defensive.py 每天算）：便宜／合理／昂貴價與現在落在哪一區。純函式，沒有 React。
 * 主要用「這檔自己近 10 年的殖利率分布」（殖利率河流）：便宜＝最近全年股利 ÷ 第 80 百分位殖利率，合理 ÷ 第 50，昂貴 ÷ 第 20；
 * 本益比、淨值比區間與傳統股利法（平均股利 × 16／20／32）當參考。
 *
 * 2026-11-26：將 scripts/fetch_defensive.py 的 10 年區間算法移植為純函式 computeDefensiveRow()，
 * 讓瀏覽器端「自選存股」與每日排程算出的數字口徑一致，並提供失真提醒與持有 ETF 篩選。 */

import { CYCLICAL } from './valuation.ts';
import { holdersOf, type Holder } from './holders.ts';
import type { ActiveData } from './active.ts';
import type { Top10Data } from './top10.ts';

export const DEFENSIVE_YEARS = 10;
export const DEFENSIVE_PCT = [0.2, 0.5, 0.8] as const;

export interface Band { cheap: number; fair: number; rich: number; q?: number[] }

export interface DefRow {
  c: string; n: string; cat: string; m?: string | null; i?: string | null;
  price: number; pdate: string; chg1y: number | null; hi52: number | null; lo52: number | null;
  /** 最近一次全年現金股利、所屬年份、近 5 年平均、連續配息年數、近 8 年 [年, 股利] */
  div: number | null; divYear: string | null; avg5: number | null; streak: number; divs: Array<[string, number]>;
  /** 從股利資料第一年就連續配息（實際可能更久） */
  streakMin?: boolean;
  /** 現在殖利率（%）與在近 10 年的百分位（0～1，高＝殖利率高＝股價相對便宜） */
  yield: number | null; yieldRank: number | null;
  pe: number | null; pb: number | null; peRank: number | null; pbRank: number | null;
  byYield: Band | null; byPe: Band | null; byPb: Band | null; byClassic: Band | null;
  since: string;
}

export interface DefData {
  meta: { updated: string; date: string; years: number; source: string; errors: string[] };
  rows: DefRow[];
}

export type Zone = 'cheap' | 'fairLow' | 'fairHigh' | 'rich';
export const ZONE_LABEL: Record<Zone, string> = {
  cheap: '便宜', fairLow: '合理偏低', fairHigh: '合理偏高', rich: '昂貴',
};
export const ZONE_HINT: Record<Zone, string> = {
  cheap: '在便宜價以下：歷史上少見的價位，可以分批買',
  fairLow: '介於便宜和合理之間：可以持有、逢低加碼',
  fairHigh: '介於合理和昂貴之間：持有，不追價',
  rich: '在昂貴價以上：歷史上偏貴，不追，可以考慮減碼',
};
export const ZONE_ORDER: Zone[] = ['cheap', 'fairLow', 'fairHigh', 'rich'];

export function zoneOf(price: number, b: Band | null): Zone | null {
  if (!b || !(price > 0)) return null;
  if (price <= b.cheap) return 'cheap';
  if (price <= b.fair) return 'fairLow';
  if (price <= b.rich) return 'fairHigh';
  return 'rich';
}

/** 條狀圖的刻度：從便宜價再往下 15% 到昂貴價再往上 15%（股價超出就延伸），回傳 0～1 的位置 */
export function scale(price: number, b: Band): { lo: number; hi: number; at: (v: number) => number } {
  const lo = Math.min(b.cheap * 0.85, price * 0.97);
  const hi = Math.max(b.rich * 1.15, price * 1.03);
  return { lo, hi, at: v => Math.min(1, Math.max(0, (v - lo) / (hi - lo))) };
}

/** 依區排序（便宜的在前），同區依殖利率百分位高到低 */
export function sortRows(rows: DefRow[]): DefRow[] {
  const zi = (r: DefRow) => { const z = zoneOf(r.price, r.byYield); return z ? ZONE_ORDER.indexOf(z) : 9; };
  return [...rows].sort((a, b) => zi(a) - zi(b) || (b.yieldRank ?? 0) - (a.yieldRank ?? 0));
}

/* ── 瀏覽器端 10 年區間算法（對齊 scripts/fetch_defensive.py）────── */

export interface FinMindPerRow {
  date?: string | null;
  PER?: number | string | null;
  PBR?: number | string | null;
  dividend_yield?: number | string | null;
}

export interface FinMindPriceRow {
  date?: string | null;
  close?: number | string | null;
}

export interface FinMindDividendRow {
  date?: string | null;
  CashEarningsDistribution?: number | string | null;
  CashStatutorySurplus?: number | string | null;
  CashExDividendTradingDate?: string | null;
}

export interface ComputeDefensiveInput {
  code: string;
  name?: string | null;
  cat?: string;
  market?: string | null;
  industry?: string | null;
  /** 台北日期（YYYY-MM-DD），決定 10 年視窗起點與今年度 */
  today: string;
  per: readonly FinMindPerRow[];
  px: readonly FinMindPriceRow[];
  dv: readonly FinMindDividendRow[];
}

/** 台北日期（YYYY-MM-DD），與 scripts/fetch_defensive.py 的 UTC+8 一致。 */
export function todayTaipei(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD 加減日曆天數（UTC，不受瀏覽器時區或夏令時間影響）。 */
export function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 與 Python 3 round() 相同的銀行家四捨五入（exact half 取偶），並消去 -0。 */
function roundN(x: number, digits: number): number {
  const f = 10 ** digits;
  const scaled = x * f;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const res = diff === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(scaled);
  const out = res / f;
  return out === 0 ? 0 : out;
}

function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 線性內插分位數（p 介於 0～1），與 scripts/fetch_defensive.py 的 quantile() 一致。 */
export function quantile(xs: readonly number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const k = (s.length - 1) * p;
  const f = Math.floor(k);
  const c = Math.min(f + 1, s.length - 1);
  return s[f] + (s[c] - s[f]) * (k - f);
}

/** x 在歷史樣本中 ≤ x 的比例（0～1），與 scripts/fetch_defensive.py 的 rank() 一致。 */
export function rankLe(xs: readonly number[], x: number): number | null {
  if (!xs.length) return null;
  let n = 0;
  for (const v of xs) if (v <= x) n += 1;
  return n / xs.length;
}

function computeBand(base: number | null, qs: readonly number[], invert = false): Band | null {
  if (base === null || !(base > 0) || !qs.length) return null;
  const q = DEFENSIVE_PCT.map(p => quantile(qs, p)!);
  if (invert) {
    // 殖利率：高殖利率＝便宜（第 80 百分位對應便宜價，第 20 百分位對應昂貴價）
    return {
      cheap: roundN(base / (q[2] / 100), 2),
      fair: roundN(base / (q[1] / 100), 2),
      rich: roundN(base / (q[0] / 100), 2),
      q: q.map(v => roundN(v, 2)),
    };
  }
  return {
    cheap: roundN(base * q[0], 2),
    fair: roundN(base * q[1], 2),
    rich: roundN(base * q[2], 2),
    q: q.map(v => roundN(v, 2)),
  };
}

/**
 * 依 FinMind 的 TaiwanStockPER、TaiwanStockPrice、TaiwanStockDividend 計算單檔區間。
 * 缺乏股價或本益比資料時回 null。演算法與 scripts/fetch_defensive.py 的 compute() 完全對齊。
 */
export function computeDefensiveRow(input: ComputeDefensiveInput): DefRow | null {
  const { code, name, cat = '自選', market = null, industry = null, today } = input;
  const start10 = shiftDays(today, -365 * DEFENSIVE_YEARS);

  const per = input.per
    .filter((r): r is FinMindPerRow & { date: string } => typeof r.date === 'string' && r.date.length >= 10 && r.date >= start10)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const px = input.px
    .map(r => ({ date: typeof r.date === 'string' ? r.date : '', close: toNum(r.close) }))
    .filter(r => r.date.length >= 10 && r.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (!per.length || !px.length) return null;

  const lastPx = px[px.length - 1];
  const price = lastPx.close;
  const pdate = lastPx.date;
  const closes = px.map(r => r.close);
  const last250 = closes.slice(-250);

  // 每年現金股利（依除息日的年份合計；同年多次配息加總）
  const byYear: Record<string, number> = {};
  for (const r of input.dv) {
    const cash = toNum(r.CashEarningsDistribution) + toNum(r.CashStatutorySurplus);
    const d = (r.CashExDividendTradingDate || r.date || '').trim();
    if (cash > 0 && d.length >= 4) {
      const yr = d.slice(0, 4);
      byYear[yr] = roundN((byYear[yr] ?? 0) + cash, 4);
    }
  }

  const years = Object.keys(byYear).sort();
  const todayYear = Number(today.slice(0, 4));
  const thisYear = String(todayYear);
  const doneYears = years.filter(y => y < thisYear);
  const lastDiv = byYear[thisYear] ?? (doneYears.length ? byYear[doneYears[doneYears.length - 1]] : null);
  const last5Done = doneYears.slice(-5);
  const avg5 = last5Done.length ? last5Done.reduce((s, y) => s + byYear[y], 0) / last5Done.length : null;

  const hasThisYear = thisYear in byYear;
  let streak = 0;
  let yCursor = hasThisYear ? todayYear : todayYear - 1;
  while (String(yCursor) in byYear) {
    streak += 1;
    yCursor -= 1;
  }
  const streakCap = hasThisYear ? thisYear : String(todayYear - 1);
  const streakMin = years.length > 0 && streak >= years.filter(y => y <= streakCap).length;

  const ys: number[] = [];
  const pes: number[] = [];
  const pbs: number[] = [];
  for (const r of per) {
    const yv = toNum(r.dividend_yield);
    const pev = toNum(r.PER);
    const pbv = toNum(r.PBR);
    if (yv > 0) ys.push(yv);
    if (pev > 0) pes.push(pev);
    if (pbv > 0) pbs.push(pbv);
  }

  const now = per[per.length - 1];
  const peNow = toNum(now.PER);
  const pbNow = toNum(now.PBR);
  const yNow = lastDiv !== null && lastDiv > 0 ? (lastDiv / price) * 100 : null;

  let hi52: number | null = null;
  let lo52: number | null = null;
  for (const c of last250) {
    if (hi52 === null || c > hi52) hi52 = c;
    if (lo52 === null || c < lo52) lo52 = c;
  }

  return {
    c: code,
    n: name?.trim() || code,
    cat,
    m: market,
    i: industry,
    price,
    pdate,
    chg1y: closes.length >= 250 ? roundN(price / closes[closes.length - 250] - 1, 4) : null,
    hi52,
    lo52,
    div: lastDiv,
    divYear: hasThisYear ? thisYear : (doneYears.length ? doneYears[doneYears.length - 1] : null),
    avg5: avg5 !== null ? roundN(avg5, 3) : null,
    streak,
    streakMin,
    divs: years.slice(-8).map(y => [y, byYear[y]] as [string, number]),
    yield: yNow !== null ? roundN(yNow, 2) : null,
    yieldRank: yNow !== null && ys.length ? roundN(rankLe(ys, yNow)!, 3) : null,
    pe: peNow > 0 ? peNow : null,
    pb: pbNow > 0 ? pbNow : null,
    peRank: peNow > 0 && pes.length ? roundN(rankLe(pes, peNow)!, 3) : null,
    pbRank: pbNow > 0 && pbs.length ? roundN(rankLe(pbs, pbNow)!, 3) : null,
    byYield: computeBand(lastDiv, ys, true),
    byPe: computeBand(peNow > 0 ? price / peNow : null, pes, false),
    byPb: computeBand(pbNow > 0 ? price / pbNow : null, pbs, false),
    byClassic: avg5 !== null ? { cheap: roundN(avg5 * 16, 2), fair: roundN(avg5 * 20, 2), rich: roundN(avg5 * 32, 2) } : null,
    since: per[0].date,
  };
}

/**
 * 檢查 10 年殖利率／本益比區間是否可能失真，回傳白話提醒（空陣列＝無明顯失真訊號）。
 * 虧損、無配息、配息中斷／起伏大、歷史不足 3 年，或自選股屬景氣循環產業時會自動提示。
 */
export function distortionWarnings(row: DefRow, opts?: { custom?: boolean }): string[] {
  const out: string[] = [];
  if (row.pe === null) {
    out.push('近四季虧損（無本益比），殖利率與本益比區間可能失真，配息持續性須留意');
  }
  if (row.div === null || !(row.div > 0)) {
    out.push('近年查無現金股利紀錄，無法以殖利率區間估價');
  } else {
    if (row.streak === 0) {
      out.push(`近兩年未配發現金股利，目前殖利率沿用 ${row.divYear ?? '較早'} 年度股利，區間容易失真`);
    } else if (row.streak < 5) {
      out.push(`連續配息僅 ${row.streak} 年（未滿 5 年），配息紀錄尚短或曾中斷，歷史區間參考度較低`);
    }
    const recent = row.divs.slice(-5).map(([, v]) => v).filter(v => v > 0);
    let volatile = false;
    if (row.avg5 !== null && row.avg5 > 0) {
      const ratio = row.div / row.avg5;
      if (ratio < 0.6 || ratio > 1.6) volatile = true;
    }
    if (!volatile && recent.length >= 3) {
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length;
      if (mean > 0 && Math.sqrt(variance) / mean >= 0.4) volatile = true;
    }
    if (volatile) {
      out.push('近年現金股利起伏較大（配息不穩），以最近一年股利換算的殖利率區間可能失真');
    }
  }
  if (row.since && row.pdate && row.since.length >= 10 && row.pdate.length >= 10) {
    const spanDays = (Date.parse(`${row.pdate}T00:00:00Z`) - Date.parse(`${row.since}T00:00:00Z`)) / 86_400_000;
    if (Number.isFinite(spanDays) && spanDays < 365 * 3) {
      const yrs = Math.max(0.1, spanDays / 365);
      out.push(`歷史估值資料僅約 ${yrs.toFixed(1)} 年（未滿 3 年），尚未涵蓋完整多空循環`);
    }
  }
  if (opts?.custom && row.i && CYCLICAL.has(row.i)) {
    out.push(`屬景氣循環產業（${row.i}），獲利與配息隨景氣起伏，殖利率與本益比區間可能失真，可併看淨值比`);
  }
  return out;
}

/**
 * 目前持有該檔股票的 ETF（封裝 lib/holders.ts 的 holdersOf）。
 * holdersOf 會連同近期已「剔除」（股數與權重皆為 0）的主動式 ETF 一併列出；
 * 統計「持有該股的 ETF 數」時排除已清倉的標的，只計目前仍持有者。
 */
export function currentEtfHolders(
  stock: string,
  monthly: Top10Data | null,
  active: ActiveData | null,
  names: Record<string, string> = {},
): Holder[] {
  return holdersOf(stock, monthly, active, names).filter(
    h => h.kind === 'monthly' || (h.shares ?? 0) > 0 || (h.weight ?? 0) > 0,
  );
}

/** 清理並驗證台股代號輸入（4～6 碼英數大寫）；不合格式回 null。 */
export function normalizeStockCode(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return /^[0-9A-Z]{4,6}$/.test(s) ? s : null;
}
