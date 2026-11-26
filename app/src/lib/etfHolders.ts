/* ETF 受益人數與資金流向（集保股權分散表，每週累積，scripts/fetch_etf_holders.py）。純函式，沒有 React。
 *
 * 張數＝流通的受益權單位 ÷ 1000，週變化就是淨申購／贖回。
 * 第一週只有一個點，變化要等資料累積（集保只給最新一週，沒有歷史可補）。
 */

import type { Etf, FreqLabel, SectionId } from '../types.ts';
import type { YieldData } from './dividend.ts';

export interface EtfHoldersData {
  meta: { source: string; asof: string; weeks: number };
  dates: string[];
  /** 和 dates 對齊：[受益人數, 張數]，那週沒有資料是 null */
  etfs: Record<string, ([number, number] | null)[]>;
}

export interface HoldersView {
  asof: string;
  holders: number;
  lots: number;
  /** 和前一週、4 週前比（人數、張數）；沒有那一週就是 null */
  w1: { holders: number; lots: number } | null;
  w4: { holders: number; lots: number } | null;
  /** 有資料的週：[日期, 人數] */
  series: [string, number][];
}

function diffAt(row: ([number, number] | null)[], last: number, back: number) {
  const prev = last - back >= 0 ? row[last - back] : null;
  const cur = row[last];
  return prev && cur ? { holders: cur[0] - prev[0], lots: cur[1] - prev[1] } : null;
}

export function holdersFor(code: string, d: EtfHoldersData | null | undefined): HoldersView | null {
  const row = d?.etfs[code];
  if (!d || !row) return null;
  let last = row.length - 1;
  while (last >= 0 && !row[last]) last--;
  if (last < 0) return null;
  const [holders, lots] = row[last]!;
  return {
    asof: d.dates[last],
    holders,
    lots,
    w1: diffAt(row, last, 1),
    w4: diffAt(row, last, 4),
    series: row.flatMap((v, i) => (v ? [[d.dates[i], v[0]] as [string, number]] : [])),
  };
}

// ---- ETF 資金流向榜（2026-11-26）---------------------------------------------

export type FlowWindow = 'w1' | 'w4';
export type FlowMetric = 'flow' | 'holders' | 'lots' | 'totalHolders' | 'totalLots';
export type FlowDir = 'in' | 'out';
export type FlowCategory = 'all' | 'domestic' | 'foreign' | 'bond' | 'leveraged' | 'active';

export const FLOW_CATEGORIES: readonly { id: FlowCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'domestic', label: '台股' },
  { id: 'foreign', label: '海外' },
  { id: 'bond', label: '債券' },
  { id: 'leveraged', label: '槓桿/期貨' },
  { id: 'active', label: '主動式' },
];

export const FLOW_METRICS: readonly { id: FlowMetric; label: string; isDelta: boolean }[] = [
  { id: 'flow', label: '估算淨申贖', isDelta: true },
  { id: 'holders', label: '受益人變化', isDelta: true },
  { id: 'lots', label: '淨申贖張數', isDelta: true },
  { id: 'totalHolders', label: '最新受益人', isDelta: false },
  { id: 'totalLots', label: '最新流通張數', isDelta: false },
];

export interface SplitWarning {
  kind: 'split' | 'reverse';
  /** 相鄰有效快照的張數比（正向分割如 5.2，反分割如 0.14） */
  ratio: number;
  fromDate: string;
  toDate: string;
}

export interface FlowWindowStat {
  prevDate: string;
  /** 受益人數變化（人） */
  dHolders: number;
  /** 受益人數變化率（%） */
  dHoldersPct: number | null;
  /** 流通張數變化（張） */
  dLots: number;
  /** 流通張數變化率（%） */
  dLotsPct: number | null;
  /** 估算淨申贖金額（元）＝ Δ張數 × 最新收盤價 × 1000；缺收盤價或區間內疑似分割時為 null */
  estFlow: number | null;
  /** 區間內是否偵測到疑似分割／反分割 */
  split: SplitWarning | null;
}

export interface FlowRow {
  code: string;
  name: string;
  sec: SectionId;
  act: boolean;
  freq: FreqLabel;
  asof: string;
  holders: number;
  lots: number;
  /** 最新收盤價（來自 yields.json，缺席為 null） */
  price: number | null;
  /** 估算規模（元）＝ lots × price × 1000 */
  estAum: number | null;
  w1: FlowWindowStat | null;
  w4: FlowWindowStat | null;
}

export interface FlowSummary {
  /** 有估算淨申贖金額的檔數（扣除疑似分割） */
  pricedCount: number;
  /** 有該區間變化資料的總檔數 */
  totalCount: number;
  /** 受益人數合計淨變化 */
  netHolders: number;
  /** 估算淨申贖金額合計（元，扣除疑似分割） */
  netFlow: number;
  /** 估算淨申購合計（正值加總，元） */
  inflow: number;
  /** 估算淨贖回合計（負值加總，元） */
  outflow: number;
  /** 區間內偵測到疑似分割／反分割的代號 */
  splitCodes: string[];
}

const LEVERAGED_SECS = new Set<SectionId>([
  'cat-leveraged',
  'cat-futures',
  'cat-leveraged-futures',
]);

/**
 * 偵測比較區間 [fromIdx, toIdx] 內是否發生分割／反分割。
 *
 * 不依賴 calc/tw/*.json（一檔一個檔、部署時才產生且 calc/index.json 無 splits）：
 * 改由集保快照的結構特徵判斷 —— 分割時流通張數與「人均張數」會在相鄰有效週同步倍增
 * （允許中間因停牌夾著 null，如 00662 1 拆 5）；單純爆紅大吸金（如 00406A 4 週倍增）
 * 則是多週平緩累加且人均張數無劇烈跳變，不會被誤判。
 */
export function detectSplit(
  row: ([number, number] | null)[],
  dates: readonly string[],
  fromIdx: number,
  toIdx: number,
): SplitWarning | null {
  const valid: number[] = [];
  const start = Math.max(0, fromIdx);
  const end = Math.min(row.length - 1, toIdx);
  for (let i = start; i <= end; i++) {
    if (row[i]) valid.push(i);
  }
  for (let k = 1; k < valid.length; k++) {
    const iA = valid[k - 1];
    const iB = valid[k];
    const [prevH, prevL] = row[iA]!;
    const [curH, curL] = row[iB]!;
    if (prevL <= 0 || curL <= 0 || prevH <= 0 || curH <= 0) continue;
    // 排除極迷你基金零星申贖（例如 5 張變 10 張）與上市前掛名 1 人的異常基期
    if (Math.max(prevL, curL) < 500 || Math.min(prevH, curH) < 20) continue;

    const lotRatio = curL / prevL;
    const perHolderRatio = (curL / curH) / (prevL / prevH);

    if (lotRatio >= 1.8 && perHolderRatio >= 1.6) {
      return {
        kind: 'split',
        ratio: Math.round(lotRatio * 10) / 10,
        fromDate: dates[iA] ?? '',
        toDate: dates[iB] ?? '',
      };
    }
    if (lotRatio <= 0.55 && perHolderRatio <= 0.62) {
      return {
        kind: 'reverse',
        ratio: Math.round(lotRatio * 100) / 100,
        fromDate: dates[iA] ?? '',
        toDate: dates[iB] ?? '',
      };
    }
  }
  return null;
}

/** 取得目前選擇週期的起迄日期；累積週數不足時回 null。 */
export function windowRange(
  dates: readonly string[],
  win: FlowWindow,
): { prevDate: string; asof: string } | null {
  const back = win === 'w1' ? 1 : 4;
  const last = dates.length - 1;
  if (last - back < 0) return null;
  return { prevDate: dates[last - back], asof: dates[last] };
}

/**
 * 結合 etfs.json、etf_holders.json 與 yields.json 建立資金流向列。
 * 僅納入「全市場最新一週」有集保資料的標的，確保排行榜比較區間一致。
 */
export function buildFlowRows(
  etfs: readonly Etf[],
  holders: EtfHoldersData | null | undefined,
  yields: YieldData | null | undefined,
): FlowRow[] {
  if (!holders || !holders.dates.length) return [];
  const last = holders.dates.length - 1;
  const asof = holders.dates[last];
  const out: FlowRow[] = [];

  for (const e of etfs) {
    const row = holders.etfs[e.code];
    const cur = row?.[last];
    if (!cur) continue;

    const rawPrice = yields?.yields?.[e.code]?.price;
    const price = typeof rawPrice === 'number' && Number.isFinite(rawPrice) && rawPrice > 0
      ? rawPrice
      : null;

    const statFor = (back: number): FlowWindowStat | null => {
      const prevIdx = last - back;
      const prev = prevIdx >= 0 ? row[prevIdx] : null;
      if (!prev) return null;
      const dHolders = cur[0] - prev[0];
      const dLots = cur[1] - prev[1];
      const split = detectSplit(row, holders.dates, prevIdx, last);
      return {
        prevDate: holders.dates[prevIdx],
        dHolders,
        dHoldersPct: prev[0] > 0 ? (dHolders / prev[0]) * 100 : null,
        dLots,
        dLotsPct: prev[1] > 0 ? (dLots / prev[1]) * 100 : null,
        estFlow: price !== null && !split ? dLots * price * 1000 : null,
        split,
      };
    };

    out.push({
      code: e.code,
      name: e.name,
      sec: e.sec,
      act: e.act,
      freq: e.freq,
      asof,
      holders: cur[0],
      lots: cur[1],
      price,
      estAum: price !== null ? cur[1] * price * 1000 : null,
      w1: statFor(1),
      w4: statFor(4),
    });
  }

  return out;
}

export function matchesFlowCategory(row: FlowRow, category: FlowCategory): boolean {
  switch (category) {
    case 'all': return true;
    case 'domestic': return row.sec === 'cat-domestic';
    case 'foreign': return row.sec === 'cat-foreign';
    case 'bond': return row.sec === 'cat-bond';
    case 'leveraged': return LEVERAGED_SECS.has(row.sec);
    case 'active': return row.act;
  }
}

export function filterFlowRows(
  rows: readonly FlowRow[],
  category: FlowCategory,
  query = '',
): FlowRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter(r =>
    matchesFlowCategory(r, category) &&
    (!needle || r.code.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle)),
  );
}

function metricValue(row: FlowRow, win: FlowWindow, metric: FlowMetric): number | null {
  const s = row[win];
  switch (metric) {
    case 'flow': return s?.estFlow ?? null;
    case 'lots': return s && !s.split ? s.dLots : null;
    case 'holders': return s?.dHolders ?? null;
    case 'totalHolders': return row.holders;
    case 'totalLots': return row.lots;
  }
}

/** 排序：dir === 'in' 為高→低（淨申購／增加），'out' 為低→高（淨贖回／減少）。缺值與分割失真永遠沉底。 */
export function sortFlowRows(
  rows: readonly FlowRow[],
  win: FlowWindow,
  metric: FlowMetric,
  dir: FlowDir,
): FlowRow[] {
  const sign = dir === 'in' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = metricValue(a, win, metric);
    const y = metricValue(b, win, metric);
    if (x === null && y === null) return a.code.localeCompare(b.code);
    if (x === null) return 1;
    if (y === null) return -1;
    if (x !== y) return (x - y) * sign;
    return a.code.localeCompare(b.code);
  });
}

/** 彙總目前篩選清單的資金進出與人數變化（疑似分割標的排除於金額合計）。 */
export function summarizeFlow(rows: readonly FlowRow[], win: FlowWindow): FlowSummary {
  let pricedCount = 0;
  let totalCount = 0;
  let netHolders = 0;
  let netFlow = 0;
  let inflow = 0;
  let outflow = 0;
  const splitCodes: string[] = [];

  for (const r of rows) {
    const s = r[win];
    if (!s) continue;
    totalCount++;
    netHolders += s.dHolders;
    if (s.split) {
      splitCodes.push(r.code);
      continue;
    }
    if (s.estFlow !== null) {
      pricedCount++;
      netFlow += s.estFlow;
      if (s.estFlow > 0) inflow += s.estFlow;
      else if (s.estFlow < 0) outflow += s.estFlow;
    }
  }

  return { pricedCount, totalCount, netHolders, netFlow, inflow, outflow, splitCodes };
}

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 估算金額（元）→ 帶正負號的「億／萬」精簡字串，方便表格與手機卡片閱讀。 */
export function formatFlowYi(yuan: number): string {
  if (!Number.isFinite(yuan)) return '—';
  if (yuan === 0) return '0';
  const sign = yuan > 0 ? '+' : '-';
  const abs = Math.abs(yuan);
  if (abs >= 1e10) return `${sign}${nf1.format(abs / 1e8)} 億`;
  if (abs >= 1e8) return `${sign}${nf2.format(abs / 1e8)} 億`;
  if (abs >= 1e4) return `${sign}${nf0.format(Math.round(abs / 1e4))} 萬`;
  return `${sign}${nf0.format(Math.round(abs))} 元`;
}
