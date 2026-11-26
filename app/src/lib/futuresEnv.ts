/* 期貨對帳單 × 站內市場環境交叉復盤。純函式，沒有 React、沒有網路請求。
 *
 * **所有計算都在瀏覽器端完成，對帳單不會離開裝置。**
 *
 * 依對帳單每筆交易的結算日（平倉日 `Trade.date`）對齊站內四個市場環境維度：
 *   1. 大盤融資維持率（證交所口徑，< 165% vs ≥ 165%，門檻沿用 lib/chips.ts 的 MAINT_T.calm）
 *   2. 結算日（實際月選＋週三／週五週選到期日 vs 非結算日，來源 settle.json ∪ atm.json）
 *   3. 市場波動（臺指 VIX 或台指日振幅歷史前 20% 高波動日 vs 一般日）
 *   4. 星期幾（週一～週五，沿用 lib/atm.ts 的 weekdayOf／WEEKDAY_LABEL）
 *
 * 各組同時統計「全部合計」與 lib/futures.ts 既有的三種交易方式（程式／主觀／選擇權）。
 * 有效交易日少於 10 天標示 lowSample（不具統計代表性）；不在環境資料涵蓋期間內的日子
 * 單獨計入 unmatchedDays，不硬歸類為正常日／非結算日以免汙染統計。
 */

import { STRATEGIES, type Strategy, type Trade } from './futures.ts';
import { MAINT_T, maintSeries, type ChipsData } from './chips.ts';
import { weekdayOf, WEEKDAY_LABEL, type AtmData } from './atm.ts';
import { settleDates } from './settle.ts';
import type { NextdayData } from './nextday.ts';

/** 證交所口徑大盤融資維持率正常區下緣（165%，沿用 lib/chips.ts 的 MAINT_T.calm）。 */
export const ENV_MAINT_THRESHOLD = MAINT_T.calm;

/** 高波動日門檻：站內歷史前 20%（第 80 百分位）。 */
export const HIGH_VOL_QUANTILE = 0.8;

/** 計算前 20% 波動門檻所需的最少歷史天數，避免樣本太少時門檻失真。 */
export const MIN_VOL_HISTORY_DAYS = 10;

/** 單一環境分組少於此有效交易日數時標示不具統計代表性。 */
export const MIN_SAMPLE_DAYS = 10;

/** 外部環境資料來源（全部可選，任一檔缺席時僅影響對應維度、整頁正常運作）。 */
export interface MarketEnvSources {
  chips?: ChipsData | null;
  settle?: Array<{ d: string }> | null;
  atm?: AtmData | null;
  nextday?: NextdayData | null;
}

export interface EnvCell {
  /** 有平倉交易的天數 */
  days: number;
  /** 當日合計淨損益 > 0 的天數 */
  winDays: number;
  /** 日勝率（0–1）；無交易日時為 null */
  dayWinRate: number | null;
  /** 平倉筆數 */
  trades: number;
  /** 單筆淨損益 > 0 的筆數 */
  winTrades: number;
  /** 單筆勝率（0–1）；無交易時為 null */
  tradeWinRate: number | null;
  /** 合計已實現淨損益（元，已扣手續費與期交稅） */
  net: number;
  /** 日均損益（net ÷ days）；無交易日時為 null */
  avgDailyNet: number | null;
  /** 有效交易日介於 1～9 天（少於 10 天標示不具代表性） */
  lowSample: boolean;
}

export interface EnvBucketRow {
  id: string;
  label: string;
  all: EnvCell;
  byStrategy: Record<Strategy, EnvCell>;
}

export type EnvDimensionId = 'maint' | 'settle' | 'volatility' | 'weekday';

export interface EnvDimension {
  id: EnvDimensionId;
  title: string;
  criterion: string;
  available: boolean;
  unavailableReason?: string;
  coverage: { from: string; to: string } | null;
  /** 本維度成功對齊的交易日數（合計） */
  matchedDays: number;
  /** 不在環境資料涵蓋範圍內而未計入本維度的交易日數 */
  unmatchedDays: number;
  rows: EnvBucketRow[];
}

export type MaintSourceKind = 'chips-keep' | 'chips-maint' | 'nextday-fallback' | null;

export interface EnvReview {
  totalDays: number;
  totalTrades: number;
  dateRange: { from: string; to: string } | null;
  meta: {
    maintSource: MaintSourceKind;
    maintLatest: string | null;
    settleLatest: string | null;
    ampThreshold: number | null;
    ampDays: number;
    ampLatest: string | null;
    vixThreshold: number | null;
    vixDays: number;
    vixLatest: string | null;
  };
  dimensions: EnvDimension[];
}

/** 排序後線性內插分位數（與 scripts/fetch_nextday.py 的 quantile 公式一致）。 */
export function quantile(values: number[], q: number): number | null {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const clamped = Math.min(1, Math.max(0, q));
  const k = (s.length - 1) * clamped;
  const lo = Math.floor(k);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (k - lo);
}

interface DayAgg {
  net: number;
  trades: number;
  winTrades: number;
}

const EMPTY_CELL: EnvCell = {
  days: 0,
  winDays: 0,
  dayWinRate: null,
  trades: 0,
  winTrades: 0,
  tradeWinRate: null,
  net: 0,
  avgDailyNet: null,
  lowSample: false,
};

function summarizeDays(list: DayAgg[]): EnvCell {
  const days = list.length;
  if (days === 0) return { ...EMPTY_CELL };
  let winDays = 0;
  let trades = 0;
  let winTrades = 0;
  let net = 0;
  for (const x of list) {
    if (x.net > 0) winDays += 1;
    trades += x.trades;
    winTrades += x.winTrades;
    net += x.net;
  }
  return {
    days,
    winDays,
    dayWinRate: winDays / days,
    trades,
    winTrades,
    tradeWinRate: trades > 0 ? winTrades / trades : null,
    net,
    avgDailyNet: net / days,
    lowSample: days < MIN_SAMPLE_DAYS,
  };
}

function dateBounds(dates: Iterable<string>): { from: string; to: string } | null {
  let from = '';
  let to = '';
  for (const d of dates) {
    if (!d) continue;
    if (!from || d < from) from = d;
    if (!to || d > to) to = d;
  }
  return from ? { from, to } : null;
}

/**
 * 建立每日大盤融資維持率對照表（{ YYYY-MM-DD -> % }）。
 *
 * 優先使用 chips.json 的 maintSeries（證交所口徑 2009 起）；若 chips.json 缺檔
 * （例：本機環境或某次部署缺籌碼），退回使用 nextday.json 的 series[].mt：
 * fetch_nextday.py 把前一交易日收盤的維持率寫在隔日那列，所以 series[i].mt 對應 series[i - 1].d。
 */
function buildMaintMap(sources: MarketEnvSources): {
  map: Map<string, number>;
  source: MaintSourceKind;
} {
  const map = new Map<string, number>();
  const margin = sources.chips?.margin;
  if (margin) {
    const { rows } = maintSeries(margin);
    for (const [d, v] of rows) {
      if (d && Number.isFinite(v) && v > 0) map.set(d, v);
    }
    if (map.size > 0) {
      return { map, source: margin.keepHist?.length ? 'chips-keep' : 'chips-maint' };
    }
  }

  const series = sources.nextday?.series;
  if (series && series.length >= 2) {
    for (let i = 1; i < series.length; i++) {
      const prevDay = series[i - 1]?.d;
      const mt = series[i]?.mt;
      if (prevDay && typeof mt === 'number' && Number.isFinite(mt) && mt > 0) {
        map.set(prevDay, mt);
      }
    }
    if (map.size > 0) return { map, source: 'nextday-fallback' };
  }

  return { map, source: null };
}

/**
 * 建立實際結算日集合與已記錄區間。
 * 涵蓋月選、週三週選與週五週選（含國定假日順延）；超出已記錄區間的舊日期不誤判為非結算日。
 */
function buildSettleIndex(sources: MarketEnvSources): {
  settles: Set<string>;
  coverage: { from: string; to: string } | null;
} {
  const settles = new Set<string>();
  const knownDays: string[] = [];

  if (sources.settle?.length) {
    for (const r of sources.settle) {
      if (r.d) {
        settles.add(r.d);
        knownDays.push(r.d);
      }
    }
  }
  if (sources.atm?.rows?.length) {
    for (const e of settleDates(sources.atm.rows)) settles.add(e);
    for (const r of sources.atm.rows) {
      if (r.d) knownDays.push(r.d);
    }
  }

  return { settles, coverage: dateBounds(knownDays) };
}

/**
 * 建立台指日振幅（nextday.json 的 series，近 500 日）與臺指 VIX（chips.json 的 tw.vix）對照表。
 * 刻意不使用美股 us.vix：美股收盤晚於台股收盤，同日對齊會引入收盤後的未來資訊。
 */
function buildVolatilityIndex(sources: MarketEnvSources): {
  ampMap: Map<string, number>;
  ampThreshold: number | null;
  vixMap: Map<string, number>;
  vixThreshold: number | null;
  coverage: { from: string; to: string } | null;
} {
  const ampMap = new Map<string, number>();
  for (const p of sources.nextday?.series ?? []) {
    if (p.f || p.h === undefined || p.l === undefined || !(p.b > 0) || !p.d) continue;
    const amp = (p.h - p.l) / p.b;
    if (Number.isFinite(amp) && amp >= 0) ampMap.set(p.d, amp);
  }
  const ampThreshold = ampMap.size >= MIN_VOL_HISTORY_DAYS
    ? quantile([...ampMap.values()], HIGH_VOL_QUANTILE)
    : null;

  const vixMap = new Map<string, number>();
  for (const [d, v] of sources.chips?.tw?.vix ?? []) {
    if (d && Number.isFinite(v) && v > 0) vixMap.set(d, v);
  }
  const vixThreshold = vixMap.size >= MIN_VOL_HISTORY_DAYS
    ? quantile([...vixMap.values()], HIGH_VOL_QUANTILE)
    : null;

  const allDates: string[] = [];
  if (ampThreshold !== null) for (const d of ampMap.keys()) allDates.push(d);
  if (vixThreshold !== null) for (const d of vixMap.keys()) allDates.push(d);

  return {
    ampMap,
    ampThreshold,
    vixMap,
    vixThreshold,
    coverage: dateBounds(allDates),
  };
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

/**
 * 將對帳單交易紀錄依平倉日對齊站內四個市場環境維度，計算各組天數、損益、勝率與策略拆解。
 */
export function analyzeFuturesEnv(trades: Trade[], sources: MarketEnvSources): EnvReview {
  // 先依平倉日聚合每日合計與三種策略：各策略只計算自己真的有交易的日子
  const dayAll = new Map<string, DayAgg>();
  const dayByStrat: Record<Strategy, Map<string, DayAgg>> = {
    程式: new Map(),
    主觀: new Map(),
    選擇權: new Map(),
  };

  for (const t of trades) {
    if (!t.date) continue;
    const add = (m: Map<string, DayAgg>) => {
      const cur = m.get(t.date);
      if (cur) {
        cur.net += t.net;
        cur.trades += 1;
        if (t.net > 0) cur.winTrades += 1;
      } else {
        m.set(t.date, { net: t.net, trades: 1, winTrades: t.net > 0 ? 1 : 0 });
      }
    };
    add(dayAll);
    add(dayByStrat[t.strategy]);
  }

  const tradeDays = [...dayAll.keys()].sort();
  const dateRange = dateBounds(tradeDays);

  function buildDimension(
    id: EnvDimensionId,
    title: string,
    criterion: string,
    buckets: Array<{ id: string; label: string }>,
    available: boolean,
    coverage: { from: string; to: string } | null,
    classify: (date: string) => string | null,
    unavailableReason?: string,
  ): EnvDimension {
    if (!available) {
      return {
        id,
        title,
        criterion,
        available: false,
        unavailableReason,
        coverage,
        matchedDays: 0,
        unmatchedDays: tradeDays.length,
        rows: [],
      };
    }

    const bucketDays = new Map<string, string[]>(buckets.map(b => [b.id, []]));
    let matchedDays = 0;
    let unmatchedDays = 0;

    for (const d of tradeDays) {
      const key = classify(d);
      if (key !== null && bucketDays.has(key)) {
        bucketDays.get(key)!.push(d);
        matchedDays += 1;
      } else {
        unmatchedDays += 1;
      }
    }

    const rows: EnvBucketRow[] = buckets.map(b => {
      const ds = bucketDays.get(b.id)!;
      const allList = ds.map(d => dayAll.get(d)!);
      const byStrategy = {} as Record<Strategy, EnvCell>;
      for (const st of STRATEGIES) {
        const stMap = dayByStrat[st];
        const stList: DayAgg[] = [];
        for (const d of ds) {
          const item = stMap.get(d);
          if (item) stList.push(item);
        }
        byStrategy[st] = summarizeDays(stList);
      }
      return {
        id: b.id,
        label: b.label,
        all: summarizeDays(allList),
        byStrategy,
      };
    });

    return {
      id,
      title,
      criterion,
      available: true,
      coverage,
      matchedDays,
      unmatchedDays,
      rows,
    };
  }

  // 1. 大盤融資維持率（< 165% vs ≥ 165%）
  const maint = buildMaintMap(sources);
  const maintCov = dateBounds(maint.map.keys());
  const maintCriterion = maint.source === 'nextday-fallback'
    ? `證交所口徑，門檻 ${ENV_MAINT_THRESHOLD}%（由隔日漲跌資料備援）`
    : maint.source === 'chips-maint'
      ? `自算融資維持率，門檻 ${ENV_MAINT_THRESHOLD}%`
      : `證交所口徑（官方＋換算），門檻 ${ENV_MAINT_THRESHOLD}%`;
  const maintDim = buildDimension(
    'maint',
    '大盤融資維持率',
    maintCriterion,
    [
      { id: 'low', label: `維持率 < ${ENV_MAINT_THRESHOLD}%` },
      { id: 'normal', label: `維持率 ≥ ${ENV_MAINT_THRESHOLD}%` },
    ],
    maint.map.size > 0,
    maintCov,
    d => {
      const v = maint.map.get(d);
      if (v === undefined) return null;
      return v < ENV_MAINT_THRESHOLD ? 'low' : 'normal';
    },
    '大盤融資維持率資料暫時讀不到',
  );

  // 2. 結算日（實際月選＋週選結算日 vs 非結算日）
  const settle = buildSettleIndex(sources);
  const settleDim = buildDimension(
    'settle',
    '結算日與否',
    '月選、週三與週五週選實際結算日（含假日順延）',
    [
      { id: 'yes', label: '結算日' },
      { id: 'no', label: '非結算日' },
    ],
    settle.settles.size > 0 && settle.coverage !== null,
    settle.coverage,
    d => {
      if (!settle.coverage || d < settle.coverage.from || d > settle.coverage.to) return null;
      return settle.settles.has(d) ? 'yes' : 'no';
    },
    '結算日資料暫時讀不到',
  );

  // 3. 高波動日（臺指 VIX 或台指日振幅前 20%）
  const vol = buildVolatilityIndex(sources);
  const volParts: string[] = [];
  if (vol.vixThreshold !== null) volParts.push(`臺指 VIX ≥ ${vol.vixThreshold.toFixed(1)}`);
  if (vol.ampThreshold !== null) volParts.push(`台指日振幅 ≥ ${fmtPct(vol.ampThreshold)}`);
  const volCriterion = volParts.length
    ? `${volParts.join(' 或 ')}（站內歷史前 20%）`
    : '臺指 VIX 或台指日振幅前 20%';
  const volDim = buildDimension(
    'volatility',
    '市場波動（前 20%）',
    volCriterion,
    [
      { id: 'high', label: '高波動日（前 20%）' },
      { id: 'normal', label: '一般波動日' },
    ],
    vol.ampThreshold !== null || vol.vixThreshold !== null,
    vol.coverage,
    d => {
      const hasAmp = vol.ampThreshold !== null && vol.ampMap.has(d);
      const hasVix = vol.vixThreshold !== null && vol.vixMap.has(d);
      if (!hasAmp && !hasVix) return null;
      const high = (hasAmp && vol.ampMap.get(d)! >= vol.ampThreshold!)
        || (hasVix && vol.vixMap.get(d)! >= vol.vixThreshold!);
      return high ? 'high' : 'normal';
    },
    '波動率與台指日振幅資料暫時讀不到',
  );

  // 4. 星期幾（週一～週五）
  const wdDim = buildDimension(
    'weekday',
    '星期幾',
    '依平倉日所屬星期（週一～週五）',
    WEEKDAY_LABEL.map((label, i) => ({ id: String(i), label })),
    true,
    dateRange,
    d => {
      const wd = weekdayOf(d);
      return wd === null ? null : String(wd);
    },
  );

  const ampCov = dateBounds(vol.ampMap.keys());
  const vixCov = dateBounds(vol.vixMap.keys());

  return {
    totalDays: tradeDays.length,
    totalTrades: trades.length,
    dateRange,
    meta: {
      maintSource: maint.source,
      maintLatest: maintCov?.to ?? null,
      settleLatest: settle.coverage?.to ?? null,
      ampThreshold: vol.ampThreshold,
      ampDays: vol.ampMap.size,
      ampLatest: ampCov?.to ?? null,
      vixThreshold: vol.vixThreshold,
      vixDays: vol.vixMap.size,
      vixLatest: vixCov?.to ?? null,
    },
    dimensions: [maintDim, settleDim, volDim, wdDim],
  };
}
