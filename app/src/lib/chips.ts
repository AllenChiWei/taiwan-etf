/* 籌碼面資料的型別與純計算。
 *
 * 與 lib/ 其他檔案一樣不引入 React，tests/ 才能直接用 node --test 跑真的函式。
 * 相對匯入要寫 .ts 副檔名 —— Vite 不需要，但 Node 的 ESM 需要。
 *
 * 單位在這裡收斂乾淨，因為三個來源的單位都不一樣：
 *   期交所契約金額   千元      -> 億元（toYi）
 *   法人買賣超股數   股        -> 張（sharesToLots）
 *   買賣超估算金額   元        -> 億元（yuanToYi）
 * JSON 裡一律保留原始單位，換算只在畫面上做，免得回頭看數字時搞不清楚乘過幾次。
 */

import type { Tone } from './format.ts';

export interface ChipsMeta {
  /** 資料日期（交易日） */
  date: string;
  updated: string;
  source: string;
  note: string;
}

/** 三大法人在某個期貨契約的部位。n/a 是未平倉淨額的口數與契約金額（千元）。 */
export interface FutRow {
  c: string; w: string;
  n: number; a: number;
  /** 當日交易淨額：口數、契約金額（千元） */
  tn: number; ta: number;
  /** 多方／空方未平倉口數 */
  bn: number; sn: number;
}

/** 三大法人的選擇權部位，買權賣權分計。 */
export interface OptRow {
  cp: string; w: string;
  n: number; a: number;
  bn: number; ba: number;
  sn: number; sa: number;
}

/** 大額交易人未沖銷部位。b5/s5 前五大買賣方，b10/s10 前十大，oi 全市場。 */
export interface LargeRow {
  id: string; name: string;
  cp: string | null;
  term: string;
  who: string;
  b5: number; s5: number; b10: number; s10: number; oi: number;
}

export interface TopRow {
  code: string; name: string;
  shares: number;
  /** 估算金額（元）。當天沒成交、取不到均價時是 null。 */
  amount: number | null;
}

export interface TopSide { buy: TopRow[]; sell: TopRow[] }
export type TopByWho = Record<string, TopSide>;

export interface ChipsData {
  meta: ChipsMeta;
  futures: FutRow[];
  futHistory: {
    dates: string[];
    /** 契約名稱 -> 身份別 -> 每日未平倉淨口數（沒交易的日子是 null） */
    contracts: Record<string, Record<string, (number | null)[]>>;
  };
  options: OptRow[];
  /** Put/Call Ratio：vol 是成交量比、oi 是未平倉量比，單位都是 % */
  pc: { dates: string[]; vol: number[]; oi: number[] };
  large: { fut: LargeRow[]; opt: LargeRow[] };
  top: { twse: TopByWho | null; tpex: TopByWho | null };
}

/** 畫面上三大法人固定這個順序：外資部位最大、最常被看。 */
export const WHO_ORDER = ['外資', '投信', '自營商'] as const;

/** 一億元 = 100,000 千元。 */
export function toYi(thousand: number): number {
  return thousand / 100_000;
}

/** 估算金額是「元」，跟契約金額不同單位，不要共用同一個換算。 */
export function yuanToYi(yuan: number): number {
  return yuan / 100_000_000;
}

export const SHARES_PER_LOT = 1000;

export function sharesToLots(shares: number): number {
  return shares / SHARES_PER_LOT;
}

/**
 * 紅漲綠跌 —— 買超與淨多單是紅的，賣超與淨空單是綠的。
 *
 * 與 format.ts 的 returnTone 同一套慣例，但這裡收的是數字而不是字串：
 * 籌碼的數字是 JSON 裡的 number，不是 ETF 表格那種 'N/A' 可能出現的字串。
 */
export function netTone(n: number): Tone {
  if (!Number.isFinite(n)) return 'na';
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return 'flat';
}

/**
 * 前五大／前十大佔全市場未沖銷部位的比例（%）。
 *
 * 這是大額交易人表真正要看的東西：口數本身沒有絕對意義，佔比才看得出
 * 「這個契約有多集中在少數人手上」。全市場為 0 時回 null 而不是 0 ——
 * 沒有部位跟集中度為零是兩回事。
 */
export function sharePct(part: number, oi: number): number | null {
  if (!oi) return null;
  return (part / oi) * 100;
}

/** 某個契約的三大法人歷史數列。找不到契約時回空物件，呼叫端不必先檢查。 */
export function contractSeries(
  hist: ChipsData['futHistory'], contract: string,
): Record<string, (number | null)[]> {
  return hist.contracts[contract] ?? {};
}

export interface LinePoint { x: number; y: number }

/**
 * 把一串數字換成 SVG 折線的座標。
 *
 * null（當天沒有這個契約的資料）直接跳過而不是當成 0 —— 當成 0 會在圖上
 * 畫出一根不存在的暴跌。值域固定含 0，因為這些數列的正負本身就是重點，
 * 只看相對高低會讓「由多翻空」看起來只是往下一點點。
 */
export function linePoints(
  values: (number | null)[], width: number, height: number, pad = 2,
): LinePoint[] {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0) return [];
  const min = Math.min(0, ...nums);
  const max = Math.max(0, ...nums);
  const span = max - min || 1;
  const n = values.length;
  const stepX = n > 1 ? (width - pad * 2) / (n - 1) : 0;
  const out: LinePoint[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    out.push({ x: pad + i * stepX, y });
  });
  return out;
}

export function linePath(points: LinePoint[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
}

/**
 * 0 在圖上的高度。畫一條零軸才看得出翻多翻空，
 * 沒有零軸的話 -5 萬口與 +5 萬口長得一模一樣。
 */
export function zeroY(
  values: (number | null)[], height: number, pad = 2,
): number | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0) return null;
  const min = Math.min(0, ...nums);
  const max = Math.max(0, ...nums);
  const span = max - min || 1;
  return pad + (1 - (0 - min) / span) * (height - pad * 2);
}

/** 數列最後一個有值的元素。停牌或契約還沒上市時尾端會是 null。 */
export function lastValue(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && Number.isFinite(v)) return v;
  }
  return null;
}

/** 大額交易人表裡，契約的顯示順序。台指是主角，個股期貨這裡沒收。 */
const LARGE_ORDER = ['臺股期貨', '電子期貨', '金融期貨', '臺指選擇權'];

/** 到期月份的順序：所有契約 → 週契約 → 各月份。 */
function termRank(term: string): number {
  if (term === '所有契約') return 0;
  if (term === '週契約') return 1;
  return 2;
}

/**
 * 整理大額交易人的列：去掉重複的，再照可讀的順序排。
 *
 * 期交所對每個契約會給「所有契約」與各到期月份兩種列。多數契約只有一個近月
 * 在交易，於是兩列數字一模一樣（差別只在全市場口數多了個位數的遠月部位），
 * 畫面上就變成同一張卡片連出現兩次。數字相同的月份列直接併掉，
 * 留「所有契約」那一列 —— 它才是完整的。
 */
export function prepareLarge(rows: LargeRow[]): LargeRow[] {
  const totals = new Map<string, LargeRow>();
  const key = (r: LargeRow) => `${r.id}|${r.cp ?? ''}|${r.who}`;
  for (const r of rows) if (r.term === '所有契約') totals.set(key(r), r);

  const kept = rows.filter(r => {
    if (r.term === '所有契約') return true;
    const t = totals.get(key(r));
    if (!t) return true;
    return !(t.b5 === r.b5 && t.s5 === r.s5 && t.b10 === r.b10 && t.s10 === r.s10);
  });

  return kept.sort((a, b) => {
    const ai = LARGE_ORDER.indexOf(a.name);
    const bi = LARGE_ORDER.indexOf(b.name);
    if (ai !== bi) return (ai < 0 ? LARGE_ORDER.length : ai) - (bi < 0 ? LARGE_ORDER.length : bi);
    if (a.cp !== b.cp) return (a.cp ?? '') < (b.cp ?? '') ? -1 : 1;
    const at = termRank(a.term);
    const bt = termRank(b.term);
    if (at !== bt) return at - bt;
    return a.term < b.term ? -1 : 1;
  });
}

export interface Bar {
  x: number;
  /** 柱子的頂端（SVG 座標，往下為正） */
  y: number;
  w: number;
  h: number;
  /** 正數（淨多單／買超）為 true，畫紅色 */
  up: boolean;
}

/**
 * 把一串數字換成柱狀圖的矩形。
 *
 * 柱狀圖比折線適合這種資料：每天的未平倉淨額是一個獨立的量，不是連續變化的
 * 軌跡，而且正負一眼要分得出來（紅多綠空）。折線在跨越零軸時反而不明顯。
 *
 * 與 linePoints 一樣：null 跳過（不是當成 0），值域固定含 0 —— 柱子本來就從
 * 零軸長出來，值域不含 0 的話柱高會變成沒有意義的相對量。
 * 每根至少 1px 寬、0.8px 高，否則接近 0 的那幾天會整根消失。
 */
export function bars(
  values: (number | null)[], width: number, height: number, pad = 2,
): Bar[] {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0) return [];
  const min = Math.min(0, ...nums);
  const max = Math.max(0, ...nums);
  const span = max - min || 1;
  const inner = height - pad * 2;
  const slot = (width - pad * 2) / values.length;
  const w = Math.max(1, slot * 0.72);
  const zero = pad + (1 - (0 - min) / span) * inner;

  const out: Bar[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return;
    const y = pad + (1 - (v - min) / span) * inner;
    const top = Math.min(y, zero);
    const h = Math.max(0.8, Math.abs(zero - y));
    out.push({ x: pad + i * slot + (slot - w) / 2, y: top, w, h, up: v > 0 });
  });
  return out;
}
