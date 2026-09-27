/* 美國總經：把 macro.json 的原始數列換成畫面要看的指標。
 *
 * 資料端（scripts/fetch_macro.py）存的是 FRED／EIA 的原始數字，年增率、月增、利差
 * 這些衍生數字一律在這裡算 —— 要對帳時 JSON 跟原始來源一模一樣，算法則有測試盯著。
 *
 * 兩個容易錯的地方：
 * - **CPI 要看年增率，不是指數本身。** 指數 334 沒有意義，334 比去年同月高 2.9% 才有。
 *   同一個月對同一個月（'2026-08' 對 '2025-08'），不是往前數 12 筆 —— 數列中間缺一個月時
 *   數 12 筆會對錯月份。
 * - **非農要看月增，不是總數。** 1.59 億人是存量，市場在看的是這個月多了幾萬人。
 */

export type Freq = 'D' | 'W' | 'M' | 'Q';

export interface MacroSeries {
  id: string;
  label: string;
  unit: string;
  freq: Freq;
  src: string;
  d: string[];
  v: number[];
}

export interface MacroCurve {
  tenors: string[];
  dates: { now: string | null; m1: string | null; y1: string | null };
  now: (number | null)[];
  m1: (number | null)[];
  y1: (number | null)[];
}

export interface MacroData {
  meta: { updated: string; source: string; errors: string[] };
  series: Record<string, MacroSeries>;
  curve: MacroCurve | null;
}

export interface Point { d: string; v: number }

export function points(s: MacroSeries | undefined): Point[] {
  if (!s) return [];
  const out: Point[] = [];
  for (let i = 0; i < s.d.length && i < s.v.length; i++) {
    if (Number.isFinite(s.v[i])) out.push({ d: s.d[i], v: s.v[i] });
  }
  return out;
}

/** 年增率（%）：同一個月對去年同一個月。去年那個月沒有資料就不算那一點。 */
export function yoy(pts: Point[]): Point[] {
  const byMonth = new Map(pts.map(p => [p.d.slice(0, 7), p.v]));
  const out: Point[] = [];
  for (const p of pts) {
    const y = Number(p.d.slice(0, 4));
    const base = byMonth.get(`${y - 1}${p.d.slice(4, 7)}`);
    if (base !== undefined && base !== 0) out.push({ d: p.d, v: (p.v / base - 1) * 100 });
  }
  return out;
}

/** 與前一筆的差（非農月增）。第一筆沒有前一筆，不輸出。 */
export function diff(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 1; i < pts.length; i++) out.push({ d: pts[i].d, v: pts[i].v - pts[i - 1].v });
  return out;
}

/** 移動平均（初領失業金看 4 週平均，單週的雜訊很大）。前 n−1 筆不輸出。 */
export function movingAvg(pts: Point[], n: number): Point[] {
  const out: Point[] = [];
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    sum += pts[i].v;
    if (i >= n) sum -= pts[i - n].v;
    if (i >= n - 1) out.push({ d: pts[i].d, v: sum / n });
  }
  return out;
}

/** a − b，只取兩邊都有的日期（10Y−2Y 利差）。 */
export function spread(a: Point[], b: Point[]): Point[] {
  const bm = new Map(b.map(p => [p.d, p.v]));
  const out: Point[] = [];
  for (const p of a) {
    const x = bm.get(p.d);
    if (x !== undefined) out.push({ d: p.d, v: p.v - x });
  }
  return out;
}

export const scale = (pts: Point[], k: number): Point[] => pts.map(p => ({ d: p.d, v: p.v * k }));

/** 最後一個日期往回 years 年（含）。 */
export function lastYears(pts: Point[], years: number): Point[] {
  if (!pts.length) return pts;
  const last = pts[pts.length - 1].d;
  const cut = `${Number(last.slice(0, 4)) - years}${last.slice(4)}`;
  return pts.filter(p => p.d >= cut);
}

/**
 * 日資料畫十年是兩千多個點，畫面只有幾百像素寬。每週留最後一個交易日，
 * 形狀不變、路徑小一個數量級。週以「該週星期一」分組。
 */
export function thinWeekly(pts: Point[]): Point[] {
  if (pts.length < 600) return pts;
  const out: Point[] = [];
  let key = '';
  for (const p of pts) {
    const t = new Date(`${p.d}T00:00:00Z`);
    const monday = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86_400_000);
    const k = monday.toISOString().slice(0, 10);
    if (k === key) out[out.length - 1] = p;
    else { out.push(p); key = k; }
  }
  return out;
}

export interface Latest { last: Point; prev: Point | null; delta: number | null }

export function latest(pts: Point[]): Latest | null {
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  const prev = pts.length > 1 ? pts[pts.length - 2] : null;
  return { last, prev, delta: prev ? last.v - prev.v : null };
}

/** 一年前那一點（含以前最近的）。畫面上的「一年前」比較用。 */
export function yearAgo(pts: Point[]): Point | null {
  if (!pts.length) return null;
  const last = pts[pts.length - 1].d;
  const cut = `${Number(last.slice(0, 4)) - 1}${last.slice(4)}`;
  let hit: Point | null = null;
  for (const p of pts) {
    if (p.d > cut) break;
    hit = p;
  }
  return hit;
}

export interface Indicator {
  key: string;
  group: '通膨' | '就業' | '成長' | '利率' | '能源';
  title: string;
  unit: string;
  digits: number;
  pts: Point[];
  /** 參考線（通膨目標 2%、利差 0） */
  guides: number[];
  src: string;
  freq: Freq;
  note: string;
}

/** 畫面上的指標清單。原始數列缺了的那一項就不出現，不會變成一張空卡。 */
export function buildIndicators(data: MacroData): Indicator[] {
  const s = data.series;
  const p = (k: string) => points(s[k]);
  const list: Indicator[] = [
    { key: 'cpi', group: '通膨', title: 'CPI 年增率', unit: '%', digits: 1,
      pts: yoy(p('cpi')), guides: [2], src: 'BLS', freq: 'M',
      note: '消費者物價指數對去年同月。虛線是聯準會的 2% 目標（聯準會正式看的是 PCE）。' },
    { key: 'core_cpi', group: '通膨', title: '核心 CPI 年增率', unit: '%', digits: 1,
      pts: yoy(p('core_cpi')), guides: [2], src: 'BLS', freq: 'M',
      note: '扣除食物與能源，波動較小、比較看得出趨勢。' },
    { key: 'core_pce', group: '通膨', title: '核心 PCE 年增率', unit: '%', digits: 1,
      pts: yoy(p('core_pce')), guides: [2], src: 'BEA', freq: 'M',
      note: '聯準會 2% 通膨目標實際採用的指標，比 CPI 晚兩週左右公佈。' },
    { key: 'unrate', group: '就業', title: '失業率', unit: '%', digits: 1,
      pts: p('unrate'), guides: [], src: 'BLS', freq: 'M',
      note: '每月第一個星期五與非農就業一起公佈。' },
    { key: 'payems', group: '就業', title: '非農新增就業', unit: '千人', digits: 0,
      pts: diff(p('payems')), guides: [0], src: 'BLS', freq: 'M',
      note: '非農就業人數的月增。之後兩個月會修正，最新一個月的數字最不準。' },
    { key: 'claims', group: '就業', title: '初領失業救濟金（4 週平均）', unit: '千人', digits: 0,
      pts: scale(movingAvg(p('claims'), 4), 1 / 1000), guides: [], src: 'DOL', freq: 'W',
      note: '每週四公佈，是最即時的就業指標。單週雜訊大，所以看 4 週平均。' },
    { key: 'gdp', group: '成長', title: '實質 GDP 成長率', unit: '%', digits: 1,
      pts: p('gdp'), guides: [0], src: 'BEA', freq: 'Q',
      note: '季增年率（這一季比上一季，換算成一年的速度），不是年增率。' },
    { key: 'fed', group: '利率', title: '聯邦基金利率（目標上限）', unit: '%', digits: 2,
      pts: p('fed_upper'), guides: [], src: 'Fed', freq: 'D',
      note: '聯準會的政策利率。目標是一個區間，這裡畫上限。' },
    { key: 'y10', group: '利率', title: '10 年期公債殖利率', unit: '%', digits: 2,
      pts: p('y10'), guides: [], src: 'Fed', freq: 'D',
      note: '房貸、企業借錢與股票評價的基準利率。' },
    { key: 's10_2', group: '利率', title: '10 年減 2 年利差', unit: '百分點', digits: 2,
      pts: spread(p('y10'), p('y2')), guides: [0], src: 'Fed', freq: 'D',
      note: '低於 0 叫「殖利率曲線倒掛」，過去幾次衰退前都出現過，但從倒掛到衰退的時間差很大，'
        + '也不是每次倒掛都接著衰退。' },
    { key: 's10_3m', group: '利率', title: '10 年減 3 個月利差', unit: '百分點', digits: 2,
      pts: spread(p('y10'), p('y3m')), guides: [0], src: 'Fed', freq: 'D',
      note: '紐約聯準會的衰退機率模型用的是這一組，不是 10 年減 2 年。' },
    { key: 'wti', group: '能源', title: 'WTI 原油現貨', unit: '美元/桶', digits: 2,
      pts: p('wti'), guides: [], src: 'EIA', freq: 'D',
      note: '美國西德州原油的現貨價。' },
    { key: 'crude', group: '能源', title: '原油商業庫存', unit: '百萬桶', digits: 1,
      pts: scale(p('crude'), 1 / 1000), guides: [], src: 'EIA', freq: 'W',
      note: '不含戰略儲備。每週三公佈，庫存意外增加通常壓低油價。' },
  ];
  return list.filter(i => i.pts.length > 1);
}

/** 殖利率曲線有沒有倒掛：10Y 低於 3M。缺天期時回 null。 */
export function curveInverted(c: MacroCurve | null): boolean | null {
  if (!c) return null;
  const i3 = c.tenors.indexOf('3M');
  const i10 = c.tenors.indexOf('10Y');
  const a = c.now[i3];
  const b = c.now[i10];
  if (i3 < 0 || i10 < 0 || a == null || b == null) return null;
  return b < a;
}

export const FREQ_LABEL: Record<Freq, string> = { D: '日', W: '週', M: '月', Q: '季' };
