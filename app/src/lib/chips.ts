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
import type { UsSeries } from './sentiment.ts';

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
  /** 未平倉：買方口數／金額、賣方口數／金額、淨額口數／金額（金額單位千元） */
  bn: number; ba: number;
  sn: number; sa: number;
  n: number; a: number;
  /** 當日交易：同樣三組。舊版的 chips.json 沒有這幾個欄位 */
  vbn?: number; vba?: number;
  vsn?: number; vsa?: number;
  vn?: number; va?: number;
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

/** 一個類股的成交統計。agg=1 是彙總類（電子、化學生技醫療）。 */
export interface SectorRow {
  n: string;
  /** 成交金額（元） */
  v: number;
  sh: number | null;
  tx: number | null;
  agg: 0 | 1;
  /** 佔各細類合計的百分比 */
  pct: number;
}

export interface ChipsData {
  meta: ChipsMeta;
  futures: FutRow[];
  futHistory: {
    dates: string[];
    /** 契約名稱 -> 身份別 -> 每日未平倉淨口數（沒交易的日子是 null） */
    contracts: Record<string, Record<string, (number | null)[]>>;
    /** 契約名稱 -> 每日全市場未沖銷口數（只有小台、微台）。舊版的 chips.json 沒有 */
    oi?: Record<string, (number | null)[]>;
  };
  options: OptRow[];
  /** Put/Call Ratio：vol 是成交量比、oi 是未平倉量比，單位都是 % */
  pc: { dates: string[]; vol: number[]; oi: number[] };
  large: { fut: LargeRow[]; opt: LargeRow[] };
  top: { twse: TopByWho | null; tpex: TopByWho | null };
  /** 各類股成交比重（上市）。舊版的 chips.json 沒有這個欄位。 */
  sectors?: SectorRow[];
  /** 定期定額交易戶數排行（證交所月報）。舊版的 chips.json 沒有這個欄位。 */
  dca?: DcaRank | null;
  /** 上市融資融券餘額與維持率。舊版沒有 */
  margin?: MarginData;
  /** VIX 與自算恐懼貪婪的原料（美股日期）。舊版沒有 */
  us?: UsSeries;
}

export interface MarginData {
  dates: string[];
  /** 融資金額（元） */
  money: number[];
  /** 融資餘額（張） */
  lots: number[];
  /** 融券餘額（張） */
  short: number[];
  /** 最新一天的大盤融資維持率（自算，只有上市） */
  maint: { date: string; ratio: number; value: number; money: number; n: number } | null;
}

/** 定期定額交易戶數。這是這一頁唯一一份「散戶在買什麼」的官方數字。 */
export interface DcaRow {
  code: string;
  name: string;
  /** 交易戶數 */
  n: number;
}

export interface DcaRank {
  etfs: DcaRow[];
  stocks: DcaRow[];
  /** HTTP Last-Modified —— 這份端點沒有期別欄位，只能用它當資料時間 */
  modified: string;
}

/** 畫面上三大法人固定這個順序：外資部位最大、最常被看。 */
export const WHO_ORDER = ['外資', '投信', '自營商'] as const;

/** 一億元 = 100,000 千元。 */
export function toYi(thousand: number): number {
  return thousand / 100_000;
}

/**
 * 契約金額（千元）的顯示字串。
 *
 * 不足 0.01 億就改用萬元：投信的選擇權部位常常只有幾十萬，顯示成「0 億」等於
 * 沒有資訊。1 萬元 = 10 千元。
 */
export function contractAmount(thousand: number | null | undefined,
                               signed = false): string {
  if (thousand === null || thousand === undefined || !Number.isFinite(thousand)) {
    return '—';
  }
  const yi = toYi(thousand);
  const sign = signed && thousand > 0 ? '+' : '';
  if (Math.abs(yi) >= 0.01) return `${sign}${yi.toFixed(2)} 億`;
  if (thousand === 0) return '0 億';
  return `${sign}${(thousand / 10).toFixed(1)} 萬`;
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

/* ── 散戶未平倉（推算） ─────────────────────────────────────
 *
 * 期交所不公佈散戶部位。每一口未平倉同時有一個多方與一個空方，所以
 *   散戶多單 = 全市場未沖銷 − 三大法人多方未平倉
 *   散戶空單 = 全市場未沖銷 − 三大法人空方未平倉
 *   散戶淨額 = −（三大法人淨額）
 *   多空比   = 散戶淨額 ÷ 全市場未沖銷
 * 「散戶」其實是三大法人以外的所有人，畫面上要講明是推算。
 */

export interface Retail {
  long: number; short: number; net: number; oi: number;
  /** 多空比（%） */
  ratio: number;
}

/** 最新一日的散戶部位。要三家法人齊全且有全市場未沖銷量，少一樣就回 null。 */
export function retailLatest(rows: FutRow[], oi: number | null): Retail | null {
  if (!oi) return null;
  const inst = WHO_ORDER.map(w => rows.find(r => r.w === w));
  if (inst.some(r => !r)) return null;
  const bn = inst.reduce((a, r) => a + r!.bn, 0);
  const sn = inst.reduce((a, r) => a + r!.sn, 0);
  const long = oi - bn;
  const short = oi - sn;
  return { long, short, net: long - short, oi, ratio: ((long - short) / oi) * 100 };
}

/**
 * 每日散戶多空比（%）。那天缺全市場量或任何一家法人就是 null ——
 * 少算一家法人的淨額會讓散戶淨額整個偏掉，而不是只偏一點點。
 */
export function retailRatioSeries(
  hist: ChipsData['futHistory'], contract: string,
): (number | null)[] {
  const oi = hist.oi?.[contract];
  if (!oi) return [];
  const whos = contractSeries(hist, contract);
  return oi.map((total, i) => {
    if (!total) return null;
    let inst = 0;
    for (const w of WHO_ORDER) {
      const v = whos[w]?.[i];
      if (v === null || v === undefined) return null;
      inst += v;
    }
    return (-inst / total) * 100;
  });
}

/* ── 台指期約當部位 ─────────────────────────────────────────
 *
 * 大台、小台、微台是同一個標的、不同大小：小台一口是大台的 1/4、微台是 1/20
 * （期交所大額交易人表也是這樣換算：TX + MTX/4 + TMF/20）。分成三張卡片看，
 * 外資大台空 2 萬口、小台多 3 千口到底合起來是多少得自己心算 —— 這裡合成一個數字。
 */

export const TX_EQUIV: Record<string, number> = {
  臺股期貨: 1,
  小型臺指期貨: 1 / 4,
  微型臺指期貨: 1 / 20,
};

/**
 * 某個身份別每天的大台約當淨口數。三個契約都要有那天的數字才算 ——
 * 少一個就回 null，而不是只加有的那幾個（那會畫出一根假的跳動）。
 */
export function txEquivalent(hist: ChipsData['futHistory'], who: string): (number | null)[] {
  return hist.dates.map((_, i) => {
    let sum = 0;
    for (const [contract, w] of Object.entries(TX_EQUIV)) {
      const v = hist.contracts[contract]?.[who]?.[i];
      if (v === null || v === undefined) return null;
      sum += v * w;
    }
    return sum;
  });
}

/** 最新一日的大台約當淨口數與多空方口數（同樣換算）。缺任何一個契約回 null。 */
export function txEquivalentLatest(rows: FutRow[], who: string):
  { n: number; bn: number; sn: number } | null {
  let n = 0, bn = 0, sn = 0;
  for (const [contract, w] of Object.entries(TX_EQUIV)) {
    const r = rows.find(x => x.c === contract && x.w === who);
    if (!r) return null;
    n += r.n * w; bn += r.bn * w; sn += r.sn * w;
  }
  return { n, bn, sn };
}

/* ── 每日摘要 ─────────────────────────────────────────────── */

export interface SummaryTile {
  key: string;
  label: string;
  value: number;
  /** 與前一個交易日的差；沒有前一天時 null */
  change: number | null;
  /** 顯示格式 */
  unit: 'lots' | 'pct' | 'yi' | 'pt';
  /** 顏色依什麼：值本身的正負（淨多空）、變化的正負，或不上色 */
  tone: 'value' | 'change' | 'none';
  hint: string;
}

/** 數列最後兩個有值的元素。 */
export function lastTwo(values: (number | null)[]): [number | null, number | null] {
  let last: number | null = null;
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) continue;
    if (last === null) last = v;
    else return [last, v];
  }
  return [last, null];
}

/**
 * 籌碼頁頂端那一排：每項一個數字，加上跟前一天比。
 *
 * 只收 chips.json 裡有的東西，所以缺哪段就少哪格 —— 不會出現一格「—」佔位置。
 * 每一格的算法跟它在下面那個區塊裡的算法是同一個函式，數字才對得上。
 */
export function summaryTiles(data: ChipsData): SummaryTile[] {
  const out: SummaryTile[] = [];
  const hist = data.futHistory;

  const [fx, fxPrev] = lastTwo(txEquivalent(hist, '外資'));
  if (fx !== null) {
    out.push({ key: 'foreign', label: '外資台指期', value: fx,
      change: fxPrev === null ? null : fx - fxPrev, unit: 'lots', tone: 'value',
      hint: '大台約當淨口數' });
  }

  const [rr, rrPrev] = lastTwo(retailRatioSeries(hist, '小型臺指期貨'));
  if (rr !== null) {
    out.push({ key: 'retail', label: '小台散戶多空比', value: rr,
      change: rrPrev === null ? null : rr - rrPrev, unit: 'pct', tone: 'value',
      hint: '推算，偏多為正' });
  }

  const [pc, pcPrev] = lastTwo(data.pc.oi);
  if (pc !== null) {
    out.push({ key: 'pc', label: 'P/C 未平倉比', value: pc,
      change: pcPrev === null ? null : pc - pcPrev, unit: 'pct', tone: 'none',
      hint: '賣權 ÷ 買權' });
  }

  const m = data.margin;
  if (m && m.money.length) {
    const [mv, mvPrev] = lastTwo(m.money);
    out.push({ key: 'margin', label: '融資餘額', value: yuanToYi(mv!),
      change: mvPrev === null ? null : yuanToYi(mv! - mvPrev), unit: 'yi', tone: 'change',
      hint: '上市' });
  }
  if (m?.maint) {
    out.push({ key: 'maint', label: '融資維持率', value: m.maint.ratio,
      change: null, unit: 'pct', tone: 'none', hint: '上市，自算' });
  }
  return out;
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

/* ── 定期定額人氣榜 ─────────────────────────────────────────
 *
 * 證交所每月公佈定期定額交易戶數的前二十名。這份數字的特別之處是它**不是部位**，
 * 是「有多少人每個月扣款買這一檔」—— 三大法人那幾張表講的是機構，這張講的是
 * 真的有人設定了扣款。所以它比較接近「人氣」而不是「籌碼」。
 */

export interface DcaJoined extends DcaRow {
  /** 佔榜上合計戶數的百分比 */
  share: number;
  /** 近一年報酬（%）。個股榜與清單裡沒有的標的是 null */
  r12: number | null;
  /** 殖利率（%） */
  yield: number | null;
}

/**
 * 把人氣榜跟 ETF 清單接起來，順便算出每一檔佔榜上的比重。
 *
 * 接不到就留 null —— **不要把接不到當成 0**，那會讓「還沒配息」和「查不到」
 * 看起來一樣，與台股頁對 N/A 的處理一致。
 */
export function joinDca(
  rows: DcaRow[],
  lookup: Map<string, { r12: string | null; yield: string | null }>,
): DcaJoined[] {
  const total = rows.reduce((a, r) => a + r.n, 0);
  const numOrNull = (v: string | null | undefined) => {
    if (v === null || v === undefined || v === '' || v === 'N/A') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return rows.map(r => {
    const hit = lookup.get(r.code);
    return {
      ...r,
      share: total > 0 ? (r.n / total) * 100 : 0,
      r12: numOrNull(hit?.r12),
      yield: numOrNull(hit?.yield),
    };
  });
}
