/* 盤前作戰卡（#/nextday 最上方）：整合隔日漲跌區間、週選價平和／未平倉牆、大盤籌碼、結算日與台股行事曆。
 *
 * 純函式，沒有 React，讓 tests/premarket.test.ts 可以直接在 Node 底下測試點位合併、防重疊排布與缺檔容錯。
 * 相對匯入維持 .ts 副檔名（Node ESM 需要）。
 */

import { levelOf, type NextdayData } from './nextday.ts';
import { latestOf, type AtmData, type Series } from './atm.ts';
import {
  maintLevel, maintSeries, retailRatioSeries, txEquivalent, txEquivalentLatest, type ChipsData,
} from './chips.ts';
import { retailPoints, type RetailData } from './retail.ts';
import { ruleEvents, thirdWednesday, type CalendarData } from './calendar.ts';

/** 千分位整數（不依賴環境語系，負號統一用 U+2212）。 */
export function fmtInt(v: number): string {
  const n = Math.round(v);
  const sign = n < 0 ? '−' : '';
  return sign + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** '2026-11-25' -> '11/25' */
export function shortDate(iso: string | null | undefined): string {
  return iso && iso.length >= 10 ? iso.slice(5, 10).replace('-', '/') : '';
}

/* ── 週選合約挑選（價平和 ±1 倍區間 ＋ Call／Put 最大未平倉牆） ────────── */

export interface WallPeak {
  strike: number;
  oi: number;
}

export interface PremarketOptions {
  series: Series;
  contract: string;
  expiry: string;
  dte: number;
  /** 選擇權資料日（收盤日） */
  day: string;
  /** 價平和點數 */
  straddle: number;
  /** 價平和區間中心（atm.taiex[day]，缺少時退回同日收盤或價平履約價） */
  straddleIndex: number;
  straddleLow: number;
  straddleHigh: number;
  callWall: WallPeak | null;
  putWall: WallPeak | null;
  callOi: number | null;
  putOi: number | null;
  /** 剛換倉或配對過少：OI 牆參考性低 */
  thin: boolean;
}

/** 剛換倉合約總未平倉低於此門檻時標示偏薄（例：換倉首日總量不到一萬口）。 */
const THIN_TOTAL_OI = 15_000;

/**
 * 挑出目前有效的週三／週五合約（排除到期當日 dte === 0），並決定預設顯示哪一口。
 * 預設取「尚未到期（expiry >= targetDate）且最近到期」那一口；兩口到期日相同時取總未平倉較厚者。
 */
export function pickOptionContracts(
  atm: AtmData | null | undefined,
  targetDate: string,
  closeFallback?: { date: string; close: number },
): { list: PremarketOptions[]; defaultSeries: Series | null } {
  if (!atm || !atm.rows.length) return { list: [], defaultSeries: null };
  const taiex = atm.taiex ?? {};
  const list: PremarketOptions[] = [];

  for (const series of ['wed', 'fri'] as const) {
    const row = latestOf(atm.rows, { series, basis: 'data', excludeExpiry: true });
    if (!row) continue;
    const straddleIndex = taiex[row.d]
      ?? (closeFallback && closeFallback.date === row.d ? closeFallback.close : row.k);
    const callWall = row.cw && row.cw.length > 0 ? { strike: row.cw[0][0], oi: row.cw[0][1] } : null;
    const putWall = row.pw && row.pw.length > 0 ? { strike: row.pw[0][0], oi: row.pw[0][1] } : null;
    const callOi = row.coi ?? null;
    const putOi = row.poi ?? null;
    const totalOi = (callOi ?? 0) + (putOi ?? 0);
    const thin = row.thin === 1 || (totalOi > 0 && totalOi < THIN_TOTAL_OI);
    list.push({
      series,
      contract: row.c,
      expiry: row.e,
      dte: row.dte,
      day: row.d,
      straddle: row.sum,
      straddleIndex,
      straddleLow: straddleIndex - row.sum,
      straddleHigh: straddleIndex + row.sum,
      callWall,
      putWall,
      callOi,
      putOi,
      thin,
    });
  }

  if (list.length === 0) return { list, defaultSeries: null };

  const active = list.filter(o => o.expiry >= targetDate);
  const pool = [...(active.length ? active : list)].sort((a, b) => {
    if (a.expiry !== b.expiry) return a.expiry < b.expiry ? -1 : 1;
    if (a.dte !== b.dte) return a.dte - b.dte;
    const oa = (a.callOi ?? 0) + (a.putOi ?? 0);
    const ob = (b.callOi ?? 0) + (b.putOi ?? 0);
    if (oa !== ob) return ob - oa;
    return a.series === 'wed' ? -1 : 1;
  });

  // 畫面切換鈕依到期先後排，方便先看最近到期
  list.sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : a.dte - b.dte));
  return { list, defaultSeries: pool[0].series };
}

/* ── 水平點位軸模型與防重疊標籤排布 ──────────────────────────────────── */

export type AxisSide = 'top' | 'bottom';
export type AxisTone = 'up' | 'down' | 'accent' | 'yield' | 'ink';
export type MarkerKind =
  | 'limDn' | 'd99' | 'd95' | 'close' | 'u95' | 'u99' | 'limUp'
  | 'putWall' | 'straddleLow' | 'straddleHigh' | 'callWall';

export interface AxisMarker {
  id: string;
  side: AxisSide;
  value: number;
  label: string;
  /** 寬螢幕可併在標題旁的補充（例如 OI 口數） */
  sub?: string;
  /** Tooltip 用的完整說明 */
  detail: string;
  tone: AxisTone;
  priority: number;
  kinds: MarkerKind[];
}

export interface PremarketAxis {
  min: number;
  max: number;
  close: number;
  limDn: number;
  limUp: number;
  d95: number | null;
  u95: number | null;
  d99: number | null;
  u99: number | null;
  options: PremarketOptions | null;
  topMarkers: AxisMarker[];
  bottomMarkers: AxisMarker[];
}

interface RawMarker {
  kind: MarkerKind;
  side: AxisSide;
  value: number;
  label: string;
  sub?: string;
  detail: string;
  tone: AxisTone;
  priority: number;
  noMerge?: boolean;
}

function pctFromClose(v: number, close: number): string {
  if (!(close > 0)) return '';
  const p = ((v / close) - 1) * 100;
  return `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`;
}

function formatMergedLabel(cluster: RawMarker[]): string {
  if (cluster.length === 1) return cluster[0].label;
  const set = new Set(cluster.map(m => m.kind));
  if (set.has('limDn') && set.has('d95') && set.has('d99')) return '跌停/95%/99%';
  if (set.has('limDn') && set.has('d99')) return '跌停/99%';
  if (set.has('limDn') && set.has('d95')) return '跌停/95%';
  if (set.has('limUp') && set.has('u95') && set.has('u99')) return '漲停/95%/99%';
  if (set.has('limUp') && set.has('u99')) return '漲停/99%';
  if (set.has('limUp') && set.has('u95')) return '漲停/95%';
  if (set.has('d95') && set.has('d99') && set.size === 2) return '95%/99%下';
  if (set.has('u95') && set.has('u99') && set.size === 2) return '95%/99%上';
  return [...cluster].sort((a, b) => b.priority - a.priority).map(m => m.label).join('/');
}

/**
 * 合併同一側（上排或下排）重疊或幾乎重合的點位。
 * 例：高波動日 95%／99% 下緣都頂到跌停價時，併成單一「跌停/95%/99%」標籤，
 * 避免同一個 X 座標堆出三個重複數字。收盤點（noMerge）絕不與其他標籤合併。
 */
export function mergeCloseMarkers(raw: RawMarker[], threshold: number): AxisMarker[] {
  const fixed = raw.filter(m => m.noMerge);
  const mergeable = raw.filter(m => !m.noMerge).sort((a, b) => a.value - b.value);
  const clusters: RawMarker[][] = [];

  for (const m of mergeable) {
    const last = clusters[clusters.length - 1];
    if (last) {
      const anchor = last[0].value;
      const hasUp = last.some(x => x.tone === 'up');
      const hasDn = last.some(x => x.tone === 'down');
      const compatibleTone = !(hasUp && m.tone === 'down') && !(hasDn && m.tone === 'up');
      if (compatibleTone && Math.abs(m.value - anchor) <= threshold) {
        last.push(m);
        continue;
      }
    }
    clusters.push([m]);
  }

  const out: AxisMarker[] = clusters.map(cluster => {
    const rep = [...cluster].sort((a, b) => b.priority - a.priority)[0];
    const sub = cluster.find(x => x.sub)?.sub;
    return {
      id: cluster.map(x => x.kind).join('+'),
      side: rep.side,
      value: rep.value,
      label: formatMergedLabel(cluster),
      sub,
      detail: cluster.map(x => x.detail).join('；'),
      tone: rep.tone,
      priority: Math.max(...cluster.map(x => x.priority)),
      kinds: cluster.map(x => x.kind),
    };
  });

  for (const f of fixed) {
    out.push({
      id: f.kind,
      side: f.side,
      value: f.value,
      label: f.label,
      sub: f.sub,
      detail: f.detail,
      tone: f.tone,
      priority: f.priority,
      kinds: [f.kind],
    });
  }

  return out.sort((a, b) => a.value - b.value);
}

/** 組合盤前水平點位軸：值域涵蓋所有會畫出來的點位（含超出 ±10% 的 OI 牆），不截斷。 */
export function buildAxisModel(nd: NextdayData, opt: PremarketOptions | null): PremarketAxis {
  const close = nd.meta.close;
  const limit = nd.meta.limit;
  const limDn = levelOf(close, -limit);
  const limUp = levelOf(close, limit);
  const b95 = nd.bands.find(b => b.p === 0.95);
  const b99 = nd.bands.find(b => b.p === 0.99);
  const d95 = b95 ? levelOf(close, b95.dn) : null;
  const u95 = b95 ? levelOf(close, b95.up) : null;
  const d99 = b99 ? levelOf(close, b99.dn) : null;
  const u99 = b99 ? levelOf(close, b99.up) : null;

  const topRaw: RawMarker[] = [
    { kind: 'limDn', side: 'top', value: limDn, label: '跌停',
      detail: `明天跌停價 ${fmtInt(limDn)}（−${(limit * 100).toFixed(0)}%）`, tone: 'down', priority: 3 },
    { kind: 'close', side: 'top', value: close, label: '收盤',
      detail: `${nd.meta.date} 加權收盤 ${fmtInt(close)}`, tone: 'ink', priority: 5, noMerge: true },
    { kind: 'limUp', side: 'top', value: limUp, label: '漲停',
      detail: `明天漲停價 ${fmtInt(limUp)}（+${(limit * 100).toFixed(0)}%）`, tone: 'up', priority: 3 },
  ];
  if (d99 !== null) {
    topRaw.push({ kind: 'd99', side: 'top', value: d99, label: '99%下',
      detail: `99% 預測最低 ${fmtInt(d99)}（${pctFromClose(d99, close)}）`, tone: 'down', priority: 2 });
  }
  if (d95 !== null) {
    topRaw.push({ kind: 'd95', side: 'top', value: d95, label: '95%下',
      detail: `95% 預測最低 ${fmtInt(d95)}（${pctFromClose(d95, close)}）`, tone: 'down', priority: 4 });
  }
  if (u95 !== null) {
    topRaw.push({ kind: 'u95', side: 'top', value: u95, label: '95%上',
      detail: `95% 預測最高 ${fmtInt(u95)}（${pctFromClose(u95, close)}）`, tone: 'up', priority: 4 });
  }
  if (u99 !== null) {
    topRaw.push({ kind: 'u99', side: 'top', value: u99, label: '99%上',
      detail: `99% 預測最高 ${fmtInt(u99)}（${pctFromClose(u99, close)}）`, tone: 'up', priority: 2 });
  }

  const botRaw: RawMarker[] = [];
  if (opt) {
    if (opt.straddle > 0) {
      botRaw.push(
        { kind: 'straddleLow', side: 'bottom', value: opt.straddleLow, label: '價平−1×',
          detail: `${opt.contract} 價平和 −1 倍 ${fmtInt(opt.straddleLow)}（${pctFromClose(opt.straddleLow, opt.straddleIndex)}）`,
          tone: 'yield', priority: 3 },
        { kind: 'straddleHigh', side: 'bottom', value: opt.straddleHigh, label: '價平+1×',
          detail: `${opt.contract} 價平和 +1 倍 ${fmtInt(opt.straddleHigh)}（${pctFromClose(opt.straddleHigh, opt.straddleIndex)}）`,
          tone: 'yield', priority: 3 },
      );
    }
    if (opt.putWall) {
      botRaw.push({
        kind: 'putWall', side: 'bottom', value: opt.putWall.strike, label: 'Put牆',
        sub: `${fmtInt(opt.putWall.oi)}口`,
        detail: `${opt.contract} Put 最大未平倉支撐 ${fmtInt(opt.putWall.strike)}（${fmtInt(opt.putWall.oi)} 口，距收盤 ${pctFromClose(opt.putWall.strike, close)}）`,
        tone: 'down', priority: 4,
      });
    }
    if (opt.callWall) {
      botRaw.push({
        kind: 'callWall', side: 'bottom', value: opt.callWall.strike, label: 'Call牆',
        sub: `${fmtInt(opt.callWall.oi)}口`,
        detail: `${opt.contract} Call 最大未平倉壓力 ${fmtInt(opt.callWall.strike)}（${fmtInt(opt.callWall.oi)} 口，距收盤 ${pctFromClose(opt.callWall.strike, close)}）`,
        tone: 'up', priority: 4,
      });
    }
  }

  const allVals = [...topRaw, ...botRaw].map(m => m.value).filter(Number.isFinite);
  const rawMin = allVals.length ? Math.min(...allVals) : close * 0.9;
  const rawMax = allVals.length ? Math.max(...allVals) : close * 1.1;
  const rawSpan = rawMax - rawMin || Math.max(100, close * 0.05);
  const pad = rawSpan * 0.03;
  const mergeThr = Math.max(25, rawSpan * 0.008);

  return {
    min: rawMin - pad,
    max: rawMax + pad,
    close,
    limDn,
    limUp,
    d95,
    u95,
    d99,
    u99,
    options: opt,
    topMarkers: mergeCloseMarkers(topRaw, mergeThr),
    bottomMarkers: mergeCloseMarkers(botRaw, mergeThr),
  };
}

export interface PlacedLabel {
  id: string;
  anchorX: number;
  boxX: number;
  left: number;
  right: number;
  width: number;
  lane: number;
  value: number;
  titleText: string;
  valueText: string;
  detail: string;
  tone: AxisTone;
}

/** 保守估計 SVG 字串像素寬（多留餘裕避免不同系統中文字體度量差異造成碰撞）。 */
function estimateTextPx(text: string, mono: boolean): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    w += code >= 0x2e80 ? 11.2 : (mono ? 7.2 : 6.8);
  }
  return w;
}

/**
 * 區間著色防重疊排布：把同一側的標籤分配到最少層數（lane = 0, 1, 2…），
 * 保證同一層任兩個標籤至少間隔 gap 像素且不超出 [0, width]。
 *
 * 演算法：每個標籤先夾在畫布邊界內取得 [left, right]，依 left 由左到右貪婪指派
 * 最底層不重疊的 lane（經典 interval graph coloring 最佳解）。
 */
export function layoutAxisLabels(
  markers: AxisMarker[],
  min: number,
  max: number,
  width: number,
  padL: number,
  padR: number,
  compact = false,
): { items: PlacedLabel[]; lanes: number; gap: number } {
  const gap = compact ? 6 : 8;
  if (!markers.length) return { items: [], lanes: 0, gap };

  const safeW = Math.max(160, width);
  const inner = Math.max(1, safeW - padL - padR);
  const span = Math.max(1, max - min);
  const toX = (v: number) => padL + ((v - min) / span) * inner;

  const prepared = markers.map(m => {
    const anchorX = toX(m.value);
    const titleText = !compact && m.sub ? `${m.label} ${m.sub}` : m.label;
    const valueText = fmtInt(m.value);
    const rawW = Math.ceil(Math.max(estimateTextPx(titleText, false), estimateTextPx(valueText, true)) + 10);
    const w = Math.min(safeW - 4, rawW);
    const half = w / 2;
    const boxX = Math.max(half + 2, Math.min(safeW - half - 2, anchorX));
    return {
      m,
      anchorX,
      boxX,
      left: boxX - half,
      right: boxX + half,
      width: w,
      titleText,
      valueText,
    };
  });

  prepared.sort((a, b) => a.left - b.left || a.anchorX - b.anchorX || b.m.priority - a.m.priority);

  const laneRight: number[] = [];
  const items: PlacedLabel[] = prepared.map(p => {
    let lane = laneRight.findIndex(r => r + gap <= p.left);
    if (lane < 0) {
      lane = laneRight.length;
      laneRight.push(p.right);
    } else {
      laneRight[lane] = p.right;
    }
    return {
      id: p.m.id,
      anchorX: p.anchorX,
      boxX: p.boxX,
      left: p.left,
      right: p.right,
      width: p.width,
      lane,
      value: p.m.value,
      titleText: p.titleText,
      valueText: p.valueText,
      detail: p.m.detail,
      tone: p.m.tone,
    };
  });

  return { items, lanes: laneRight.length, gap };
}

/* ── 下方一行濃縮：籌碼、狀態、結算日、台股重要事件與各來源日期 ────────── */

export interface MaintTile {
  value: number;
  date: string;
  delta: number | null;
  /** true＝證交所官方、false＝換算推估、null＝從 nextday.json 讀取（證交所口徑） */
  official: boolean | null;
  level: 0 | 1 | 2 | 3;
  source: 'chips' | 'nextday';
}

export interface StateTile {
  fu: number;
  fd: number;
  wide: boolean;
  topReasons: string[];
  date: string;
}

export interface ForeignTxTile {
  net: number;
  delta: number | null;
  date: string;
}

export interface RetailMtxTile {
  ratio: number;
  delta: number | null;
  date: string;
  source: 'chips' | 'retail';
}

export interface SettleTile {
  isSettle: boolean;
  targetDate: string;
  contract: string | null;
  label: string;
  nextDate: string | null;
  nextContract: string | null;
  nextLabel: string | null;
  date: string | null;
  source: 'atm' | 'rule';
}

export interface EventsTile {
  targetDate: string;
  date: string | null;
  calendarLoaded: boolean;
  important: boolean;
  ruleTitles: string[];
  callsCount: number;
  exdivCount: number;
  meetingsCount: number;
  highlights: string[];
  summary: string;
  detail: string;
}

export interface SourceDateItem {
  key: string;
  label: string;
  date: string | null;
  note?: string;
}

export interface PremarketSummary {
  maint: MaintTile | null;
  state: StateTile | null;
  foreignTx: ForeignTxTile | null;
  retailMtx: RetailMtxTile | null;
  settle: SettleTile;
  events: EventsTile;
  dates: SourceDateItem[];
  /** 收盤類資料源之間出現不同交易日（例：價平和 19:00 已更新、維持率 21:30 還沒出） */
  hasDateMismatch: boolean;
}

/** 權值股與大型高股息 ETF：同一天有多筆法說／除息時優先浮在摘要上。 */
const MAJOR_CODES = new Set([
  '2330', '2317', '2454', '2308', '2382', '2881', '2882', '2412', '3711', '2303',
  '2886', '2891', '2345', '6669', '2603', '3017', '2357', '3034', '3008', '2379',
  '0050', '0056', '00878', '00919',
]);

function lastTwoWithDate(
  dates: string[],
  values: (number | null)[],
  fallbackDate: string,
): { value: number; prev: number | null; date: string } | null {
  let lastIdx = -1;
  let prevVal: number | null = null;
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) continue;
    if (lastIdx < 0) lastIdx = i;
    else {
      prevVal = v;
      break;
    }
  }
  if (lastIdx < 0) return null;
  return {
    value: values[lastIdx] as number,
    prev: prevVal,
    date: dates[lastIdx] ?? fallbackDate,
  };
}

function contractKind(codes: string[]): string {
  if (codes.some(c => /^\d{6}$/.test(c))) return '月結算';
  if (codes.some(c => /W\d$/.test(c))) return '週三週選';
  if (codes.some(c => /F\d$/.test(c))) return '週五週選';
  return '選擇權結算';
}

/** 202611F4 -> F4、202612W1 -> W1、202612 -> 月選 */
export function contractShort(c: string): string {
  if (/^\d{6}$/.test(c)) return '月選';
  return /[WF]\d$/.test(c) ? c.slice(-2) : c;
}

function buildSettleTile(targetDate: string, atm: AtmData | null | undefined): SettleTile {
  const byExpiry = new Map<string, Set<string>>();
  for (const r of atm?.rows ?? []) {
    if (!r.e || !r.c) continue;
    let s = byExpiry.get(r.e);
    if (!s) { s = new Set(); byExpiry.set(r.e, s); }
    s.add(r.c);
  }
  const expiries = [...byExpiry.keys()].sort();
  const atmDate = atm?.meta.latest ?? null;

  if (expiries.length > 0 && expiries[expiries.length - 1] >= targetDate) {
    const hit = byExpiry.get(targetDate);
    if (hit) {
      const codes = [...hit].sort();
      return {
        isSettle: true,
        targetDate,
        contract: codes.join('/'),
        label: contractKind(codes),
        nextDate: targetDate,
        nextContract: codes.join('/'),
        nextLabel: contractKind(codes),
        date: atmDate,
        source: 'atm',
      };
    }
    const next = expiries.find(e => e > targetDate) ?? null;
    const nextCodes = next ? [...byExpiry.get(next)!].sort() : [];
    return {
      isSettle: false,
      targetDate,
      contract: null,
      label: '非結算日',
      nextDate: next,
      nextContract: nextCodes.length ? nextCodes.join('/') : null,
      nextLabel: nextCodes.length ? contractKind(nextCodes) : null,
      date: atmDate,
      source: 'atm',
    };
  }

  // atm.json 缺檔或已過期時，改以規則推算台指期月結算（每月第三個星期三）
  const y = Number(targetDate.slice(0, 4));
  const m = Number(targetDate.slice(5, 7));
  const curMonthly = thirdWednesday(y, m);
  if (curMonthly === targetDate) {
    return {
      isSettle: true,
      targetDate,
      contract: null,
      label: '月結算（規則）',
      nextDate: curMonthly,
      nextContract: null,
      nextLabel: '月結算',
      date: null,
      source: 'rule',
    };
  }
  const nextMonthly = curMonthly > targetDate
    ? curMonthly
    : thirdWednesday(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
  return {
    isSettle: false,
    targetDate,
    contract: null,
    label: '非月結算',
    nextDate: nextMonthly,
    nextContract: null,
    nextLabel: '月結算（規則）',
    date: null,
    source: 'rule',
  };
}

function buildEventsTile(targetDate: string, cal: CalendarData | null | undefined): EventsTile {
  const rules = ruleEvents(targetDate, targetDate).filter(e => e.kind !== 'settle');
  const ruleTitles = rules.map(e => e.title);

  if (!cal) {
    return {
      targetDate,
      date: null,
      calendarLoaded: false,
      important: rules.length > 0,
      ruleTitles,
      callsCount: 0,
      exdivCount: 0,
      meetingsCount: 0,
      highlights: [],
      summary: rules.length > 0 ? rules[0].title.replace('公告期限', '期限') : '行事曆未載入',
      detail: rules.length > 0 ? '依規則推算（不含美總經）' : '無財報／營收期限・不含美總經',
    };
  }

  const calls = (cal.calls ?? []).filter(
    r => r.d === targetDate || (r.d < targetDate && r.end !== undefined && r.end >= targetDate),
  );
  const exdivMap = new Map<string, { code: string; name: string }>();
  for (const r of cal.exdiv) {
    if (r.d === targetDate) exdivMap.set(r.code, { code: r.code, name: r.name });
  }
  for (const n of cal.notices ?? []) {
    if (n.ex === targetDate && n.ck !== 'none' && !exdivMap.has(n.code)) {
      exdivMap.set(n.code, { code: n.code, name: n.name || n.code });
    }
  }
  const exdivs = [...exdivMap.values()];
  const meetings = cal.meetings.filter(r => r.d === targetDate);

  const majorHighlights: string[] = [];
  for (const r of calls) if (MAJOR_CODES.has(r.code)) majorHighlights.push(`${r.name}法說`);
  for (const r of exdivs) if (MAJOR_CODES.has(r.code)) majorHighlights.push(`${r.name}除息`);
  for (const r of meetings) if (MAJOR_CODES.has(r.code)) majorHighlights.push(`${r.name}股東會`);

  const fallbackHighlights: string[] = [];
  if (majorHighlights.length < 2) {
    for (const r of calls) if (!MAJOR_CODES.has(r.code)) fallbackHighlights.push(`${r.name}法說`);
    for (const r of exdivs) if (!MAJOR_CODES.has(r.code)) fallbackHighlights.push(`${r.name}除息`);
    for (const r of meetings) if (!MAJOR_CODES.has(r.code)) fallbackHighlights.push(`${r.name}股東會`);
  }

  const highlights = [...majorHighlights, ...fallbackHighlights].slice(0, 2);
  const parts: string[] = [];
  if (rules.length > 0) parts.push(rules[0].kind === 'revenue' ? '月營收期限' : '財報期限');
  if (calls.length > 0) parts.push(`法說 ${calls.length}`);
  if (exdivs.length > 0) parts.push(`除權息 ${exdivs.length}`);
  if (meetings.length > 0) parts.push(`股東會 ${meetings.length}`);

  const totalItems = calls.length + exdivs.length + meetings.length;
  const summary = parts.length > 0 ? parts.join('・') : '無重大排程';
  let detail: string;
  if (highlights.length > 0) {
    detail = `${highlights.join('、')}${totalItems > highlights.length ? '等' : ''}`;
  } else if (rules.length > 0) {
    detail = rules[0].title;
  } else {
    detail = '台股行事曆（不含美總經）';
  }

  return {
    targetDate,
    date: cal.meta.updated,
    calendarLoaded: true,
    important: rules.length > 0 || majorHighlights.length > 0,
    ruleTitles,
    callsCount: calls.length,
    exdivCount: exdivs.length,
    meetingsCount: meetings.length,
    highlights,
    summary,
    detail,
  };
}

export interface PremarketInputs {
  nextday: NextdayData;
  atm?: AtmData | null;
  chips?: ChipsData | null;
  retail?: RetailData | null;
  calendar?: CalendarData | null;
  /** 畫在點位軸上的那口週選（用來對齊來源日期標示） */
  selectedOption?: PremarketOptions | null;
}

/** 組合盤前作戰卡下方的六格濃縮摘要與各來源資料日期。 */
export function buildPremarketSummary(inp: PremarketInputs): PremarketSummary {
  const { nextday: nd, atm, chips, retail, calendar, selectedOption } = inp;
  const targetDate = nd.meta.next;

  // 1. 大盤融資維持率：chips.json（含晚間 21:45／23:55 補更新）與 nextday.json 取日期較新者
  const ks = chips?.margin ? maintSeries(chips.margin) : { rows: [], official: new Set<string>() };
  let chipsMaint: MaintTile | null = null;
  if (ks.rows.length > 0) {
    const [d, v] = ks.rows[ks.rows.length - 1];
    const prev = ks.rows.length > 1 ? ks.rows[ks.rows.length - 2][1] : null;
    chipsMaint = {
      value: v,
      date: d,
      delta: prev === null ? null : v - prev,
      official: ks.official.has(d),
      level: maintLevel(v),
      source: 'chips',
    };
  }
  const ndMaint: MaintTile | null = nd.maint && nd.maint.value !== null && nd.maint.date
    ? {
        value: nd.maint.value,
        date: nd.maint.date,
        delta: null,
        official: null,
        level: maintLevel(nd.maint.value),
        source: 'nextday',
      }
    : null;
  const maint = chipsMaint && (!ndMaint || chipsMaint.date >= ndMaint.date) ? chipsMaint : ndMaint;

  // 2. 狀態放寬倍數（nextday.json）
  let state: StateTile | null = null;
  if (nd.state) {
    const { fu, fd, whyDn, whyUp } = nd.state;
    const wide = fu > 1.05 || fd > 1.05;
    const picked: string[] = [];
    if (fd > 1.05) for (const w of whyDn) if (w.c > 0.03 && !picked.includes(w.label)) picked.push(w.label);
    if (fu > 1.05) for (const w of whyUp) if (w.c > 0.03 && !picked.includes(w.label)) picked.push(w.label);
    state = { fu, fd, wide, topReasons: picked.slice(0, 2), date: nd.meta.date };
  }

  // 3. 外資大台約當淨口數（chips.json）
  let foreignTx: ForeignTxTile | null = null;
  if (chips) {
    const hist = lastTwoWithDate(chips.futHistory.dates, txEquivalent(chips.futHistory, '外資'), chips.meta.date);
    if (hist) {
      foreignTx = { net: hist.value, delta: hist.prev === null ? null : hist.value - hist.prev, date: hist.date };
    } else {
      const lat = txEquivalentLatest(chips.futures, '外資');
      if (lat) foreignTx = { net: lat.n, delta: null, date: chips.meta.date };
    }
  }

  // 4. 小台散戶多空比（chips.json 為主，缺檔或較舊時退回進版控的 retail.json）
  let chipsRetail: RetailMtxTile | null = null;
  if (chips) {
    const hist = lastTwoWithDate(
      chips.futHistory.dates,
      retailRatioSeries(chips.futHistory, '小型臺指期貨'),
      chips.meta.date,
    );
    if (hist) {
      chipsRetail = {
        ratio: hist.value,
        delta: hist.prev === null ? null : hist.value - hist.prev,
        date: hist.date,
        source: 'chips',
      };
    }
  }
  let fallbackRetail: RetailMtxTile | null = null;
  if (retail) {
    const pts = retailPoints(retail, 'MTX');
    if (pts.length > 0) {
      const last = pts[pts.length - 1];
      const prev = pts.length > 1 ? pts[pts.length - 2] : null;
      fallbackRetail = {
        ratio: last.ratio,
        delta: prev ? last.ratio - prev.ratio : null,
        date: last.d,
        source: 'retail',
      };
    }
  }
  const retailMtx = chipsRetail && (!fallbackRetail || chipsRetail.date >= fallbackRetail.date)
    ? chipsRetail
    : fallbackRetail;

  // 5. 是否結算日（atm.json 到期日為主，缺檔退回月結算規則）
  const settle = buildSettleTile(targetDate, atm);

  // 6. 重要事件（calendar.json ＋ 規則事件）
  const events = buildEventsTile(targetDate, calendar);

  const atmDate = selectedOption?.day ?? atm?.meta.latest ?? null;
  const dates: SourceDateItem[] = [
    { key: 'nextday', label: '隔日區間', date: nd.meta.date },
    { key: 'atm', label: '週選價平和／OI', date: atmDate },
    {
      key: 'maint',
      label: '融資維持率',
      date: maint?.date ?? null,
      note: maint ? (maint.official === true ? '證交所' : maint.official === false ? '推估' : '證交所口徑') : undefined,
    },
    { key: 'foreign', label: '外資大台', date: foreignTx?.date ?? null },
    {
      key: 'retail',
      label: '散戶多空比',
      date: retailMtx?.date ?? null,
      note: retailMtx?.source === 'retail' ? '備援歷史檔' : undefined,
    },
    {
      key: 'calendar',
      label: '台股行事曆',
      date: events.date,
      note: events.calendarLoaded ? '不含美總經' : '僅規則事件',
    },
  ];

  // 只比較「收盤類」資料源的交易日（calendar.meta.updated 是抓取當日，不列入時間差比對）
  const closeDates = new Set(
    [nd.meta.date, atmDate, maint?.date, foreignTx?.date, retailMtx?.date].filter((d): d is string => Boolean(d)),
  );

  return {
    maint,
    state,
    foreignTx,
    retailMtx,
    settle,
    events,
    dates,
    hasDateMismatch: closeDates.size > 1,
  };
}
