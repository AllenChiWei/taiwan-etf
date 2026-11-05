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
  /**
   * Put/Call Ratio：vol 是成交量比、oi 是未平倉量比，單位都是 %。
   * oiAdj／volAdj 是扣掉投信賣出買權（掩護性買權 ETF）後的比率，itcOi 是投信買權賣方未平倉口數；
   * 某天沒有投信資料是 null。舊版的 chips.json 沒有這三個欄位。
   */
  pc: {
    dates: string[]; vol: number[]; oi: number[];
    oiAdj?: (number | null)[]; volAdj?: (number | null)[]; itcOi?: (number | null)[];
  };
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
  /** 臺指 VIX、期貨正逆價差、上市漲跌家數。舊版沒有 */
  tw?: TwMood;
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
  /**
   * 證交所信用交易儀表板（官方），每天一列：
   * [日期, 全市場擔保維持率%, 追繳戶數（整戶維持率 < 130%）, 當日通知追繳戶數, 追繳金額(元),
   *  處分戶數, 處分金額(元), 信用交易戶數, 信用交易戶數占比%, 信用交易成交值(元)]。舊版沒有。
   */
  credit?: CreditRow[];
  /** 大盤融資維持率（上市＋上櫃）每天一列 [日期, %]：2009 起 FinLab 回補＋每天累積。舊版沒有 */
  maintHist?: Array<[string, number]>;
  /** 融券（上市＋上櫃）每天一列 [日期, 融券張數, 融資張數, 加權指數]：2009 起 FinLab 回補＋每天累積。舊版沒有 */
  shortHist?: ShortRow[];
  /** 借券賣出餘額（個股，上市＋上櫃，不含 ETF）每天一列 [日期, 張]：2009 起。舊版沒有 */
  sblHist?: Array<[string, number]>;
  /** 融資金額（上市＋上櫃，億元）每天一列 [日期, 億]：2009 起（2026-11-05）。舊版沒有 */
  moneyHist?: Array<[string, number]>;
}

export type ShortRow = [string, number, number, number];

/** 台股情緒（2026-11-04）。舊版沒有 */
export interface TwMood {
  /** 臺指選擇權波動率指數 [日期, 指數]（期交所只給近 3 個月，2026-08 起累積） */
  vix: Array<[string, number]>;
  /** [日期, 台指期近月收盤, 加權指數]（2021-10 起） */
  basis: Array<[string, number, number]>;
  /** 上市股票 [日期, 上漲家數, 下跌家數]（2009 起） */
  breadth: Array<[string, number, number]>;
}

/** 騰落線：從第一天起累加（上漲 − 下跌）家數 */
export function adLine(rows: Array<[string, number, number]>): Array<[string, number]> {
  let acc = 0;
  return rows.map(([d, a, b]) => { acc += a - b; return [d, acc]; });
}

/**
 * 期貨正逆價差（點）＝台指期近月 − 加權指數；正＝正價差。取 n 日平均：
 * 台指期 13:45 才收、加權指數 13:30 就收，最後 15 分鐘的漲跌會整個算進當天的價差（2026-11-04 實測單日 −240～+336 來回跳），
 * 平均掉才看得出趨勢。前 n−1 天不足 n 日就用已有的天數平均。
 */
export function basisPoints(rows: Array<[string, number, number]>, n = 5): Array<[string, number]> {
  const raw = rows.map(([, tx, idx]) => tx - idx);
  return rows.map(([d], i) => {
    const w = raw.slice(Math.max(0, i - n + 1), i + 1);
    return [d, Math.round((w.reduce((a, b) => a + b, 0) / w.length) * 100) / 100];
  });
}

export interface AlignedSeries {
  /** 共用的日期軸（所有數列在 cut 之後出現過的交易日，抽樣到最多 maxPts 點） */
  dates: string[];
  /** 每條數列在每個軸點的值；那段還沒有資料就是 null（VIX 2026-08 才開始） */
  values: (number | null)[][];
  /** 軸上的刻度 [軸點索引, 標籤]（1 月標年份；空字串＝只畫格線、不標字），疏密看區間長度 */
  ticks: Array<[number, string]>;
}

/**
 * 把幾條 [日期, 值] 數列對到同一條日期軸上（站主 2026-11-05：台股情緒各圖要按日期對齊才看得懂）。
 * 抽樣時每個軸點取「上一個軸點之後、到這一天為止」這條數列最後一筆，所以哪天缺一筆也不會斷線。
 */
export function alignByDate(series: Array<Array<[string, number]>>, cut: string, maxPts = 500): AlignedSeries {
  const all = new Set<string>();
  for (const s of series) for (const [d] of s) if (d >= cut) all.add(d);
  const full = [...all].sort();
  const step = Math.max(1, Math.ceil(full.length / maxPts));
  const dates = full.filter((_, i) => i % step === 0 || i === full.length - 1);
  const values = series.map(s => {
    const rows = s.filter(r => r[0] >= cut);
    let j = 0;
    return dates.map(d => {
      let v: number | null = null;
      while (j < rows.length && rows[j][0] <= d) v = rows[j++][1];
      return v;
    });
  });
  const ticks: Array<[number, string]> = [];
  if (dates.length > 1) {
    const years = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / (365.25 * 864e5);
    // 站主 2026-11-05：「至少加上 6 月或 7 月，才抓得到日期」→ 格線加密、年中也標；標籤空字串＝只畫格線
    // 半年內每月標；1 年每月格線、隔月標；2 年內每季標；7 年內每季格線、標年份與 7 月；更長每年格線、年份隔 2／4 年標
    const yearEvery = years <= 14 ? 2 : 4;
    dates.forEach((d, i) => {
      if (i === 0 || d.slice(0, 7) === dates[i - 1].slice(0, 7)) return;
      const y = Number(d.slice(0, 4));
      const m = Number(d.slice(5, 7));
      const name = m === 1 ? String(y) : `${m}月`;
      if (years <= 0.6) ticks.push([i, name]);
      else if (years <= 1.1) ticks.push([i, m % 2 === 1 ? name : '']);
      else if (years <= 2.2) { if (m % 3 === 1) ticks.push([i, name]); }
      else if (years <= 7) { if (m % 3 === 1) ticks.push([i, m === 1 || m === 7 ? name : '']); }
      else if (m === 1) ticks.push([i, y % yearEvery === 0 ? String(y) : '']);
    });
  }
  return { dates, values, ticks };
}

export interface MaintEpisode {
  /** 跌破門檻的第一天、回到門檻以上的前一天（還沒回來就是最後一天） */
  start: string;
  end: string;
  /** 期間最低那天與數值 */
  low: string;
  min: number;
  days: number;
  ongoing: boolean;
}

/**
 * 維持率跌破 threshold 的每一段（斷頭賣壓期）。間隔不到 gap 個交易日的兩段併成一段 ——
 * 不然 2011 年那種在 140 上下來回的會被切成十幾段，看不出是同一波。新到舊。
 */
export function maintEpisodes(hist: Array<[string, number]>, threshold = 140, gap = 10): MaintEpisode[] {
  const out: MaintEpisode[] = [];
  let cur: MaintEpisode | null = null;
  let lastBelow = -Infinity;
  hist.forEach(([d, v], i) => {
    if (v >= threshold) return;
    if (cur && i - lastBelow <= gap) {
      cur.end = d;
      cur.days += 1;
      if (v < cur.min) { cur.min = v; cur.low = d; }
    } else {
      cur = { start: d, end: d, low: d, min: v, days: 1, ongoing: false };
      out.push(cur);
    }
    lastBelow = i;
  });
  if (cur && hist.length && hist.length - 1 - lastBelow <= 0) (cur as MaintEpisode).ongoing = true;
  return out.reverse();
}

/**
 * 粗估大盤還要跌多少（%）維持率才會到 target：假設融資部位跟大盤同漲同跌、融資金額不變，
 * 維持率跟市值成正比 → 1 − target ÷ 現在。實際上融資股多半是中小型股，跌得比大盤兇，所以只是參考。
 */
export function dropToReach(current: number, target: number): number | null {
  return current > target ? (1 - target / current) * 100 : null;
}

/**
 * 維持率分區（2026-11-05 使用者：研究結論放上網站、快到門檻時警示）。研究 `D:\ai\_tmp\scripts_iso\maint_accel.py`（2009～2026-11）：
 * 跌的日子平均跌幅隨維持率往下放大（≥160 約 −0.7%，140～145 約 −1.6%）；150～140 是加速區（第一次跌破 145 後 10 天內再跌中位 −5%），
 * 跌破 140 多半是斷頭賣完、之後 20 天平均反彈。
 * level：0 正常、1 接近加速區（再跌 5% 以內就到 150）、2 加速區、3 斷頭區
 */
export const MAINT_ZONES = [
  { id: 'calm', lo: 160, hi: Infinity, label: '160% 以上' },
  { id: 'watch', lo: 150, hi: 160, label: '150～160%' },
  { id: 'accel', lo: 140, hi: 150, label: '140～150%' },
  { id: 'margin', lo: 0, hi: 140, label: '140% 以下' },
] as const;

/** 站主 2026-11-05：維持率 < 160% 就開始在頁首警示（原本是再跌 5% 內到 150） */
export function maintLevel(cur: number): 0 | 1 | 2 | 3 {
  if (cur < 140) return 3;
  if (cur < 150) return 2;
  return cur < 160 ? 1 : 0;
}

/**
 * 融資 vs 大盤（站主 2026-11-05：融資增幅 ≤ 大盤漲幅可接受，超過太多可能洗／殺融資）。
 * money＝融資金額 [日期, 億]（上市＋上櫃），指數取 shortHist 的加權指數；兩邊都有的日子才算。
 * cum：從最近 days 個交易日的第一天起算的累積漲跌幅（%）；gap：每天「過去 days 天融資增幅 − 指數漲幅」（百分點）。
 */
export function marginVsIndex(money: Array<[string, number]>, shorts: ShortRow[], days: number) {
  const px = new Map(shorts.filter(r => r[3] > 0).map(r => [r[0], r[3]]));
  const rows = money.filter(r => px.has(r[0]) && r[1] > 0).map(r => [r[0], r[1], px.get(r[0]) as number] as const);
  const w = rows.slice(-(days + 1));
  const base = w[0];
  const cum = base ? {
    m: w.map(r => [r[0], (r[1] / base[1] - 1) * 100] as [string, number]),
    x: w.map(r => [r[0], (r[2] / base[2] - 1) * 100] as [string, number]),
  } : { m: [], x: [] };
  const gap: Array<[string, number]> = [];
  for (let i = days; i < rows.length; i++) {
    gap.push([rows[i][0], ((rows[i][1] / rows[i - days][1]) - (rows[i][2] / rows[i - days][2])) * 100]);
  }
  return { cum, gap };
}

/** 融資增幅超過大盤幾個百分點算過熱：2009 起，20 天差距 ≥ +10 之後 20 天下跌機率 47%、最大跌幅中位 −3.3%（其他約 −1.7%） */
export const MARGIN_GAP_HOT = 10;

export interface MaintZoneStat {
  label: string;
  /** 天數、段數（間隔 > 20 個交易日算不同段） */
  days: number;
  episodes: number;
  /** 隔天下跌的那些日子平均跌幅（%） */
  downAvg: number | null;
  /** 已經在跌（前 5 天跌 > 3%）的日子，之後 10 天內最大跌幅的中位數（%） */
  ddAfterFall: number | null;
}

export interface MaintCross {
  threshold: number;
  /** 第一次跌破（之前 20 個交易日都在門檻以上）的次數、之後 10 天內最大跌幅中位數、之後 20 天平均報酬（%） */
  n: number;
  dd10: number | null;
  ret20: number | null;
}

const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * 依維持率分區的歷史統計＋第一次跌破門檻之後（指數用 shortHist 的加權指數，日期對齊維持率）。
 * 都是「當天收盤的維持率 → 之後的指數」，不偷看未來；跟 maint_accel.py 同一套定義。
 */
export function maintStats(hist: Array<[string, number]>, shorts: ShortRow[]): { zones: MaintZoneStat[]; cross: MaintCross[] } {
  const px = new Map(shorts.filter(r => r[3] > 0).map(r => [r[0], r[3]]));
  const rows = hist.filter(r => px.has(r[0])).map(r => ({ m: r[1], p: px.get(r[0]) as number }));
  const n = rows.length;
  const p = rows.map(r => r.p);
  const m = rows.map(r => r.m);
  const ret = (i: number, k: number) => (i + k < n ? (p[i + k] / p[i] - 1) * 100 : null);
  const back5 = (i: number) => (i >= 5 ? (p[i] / p[i - 5] - 1) * 100 : null);
  const minAfter = (i: number, k: number) => {
    if (i + k >= n) return null;
    let lo = Infinity;
    for (let j = i + 1; j <= i + k; j++) lo = Math.min(lo, p[j]);
    return (lo / p[i] - 1) * 100;
  };
  const episodes = (idx: number[]) => (idx.length ? 1 + idx.slice(1).filter((v, k) => v - idx[k] > 20).length : 0);
  const zones = MAINT_ZONES.map(z => {
    const idx = m.map((v, i) => (v >= z.lo && v < z.hi ? i : -1)).filter(i => i >= 0);
    const downs = idx.map(i => ret(i, 1)).filter((v): v is number => v !== null && v < 0);
    const dd = idx.filter(i => (back5(i) ?? 0) < -3).map(i => minAfter(i, 10)).filter((v): v is number => v !== null);
    return {
      label: z.label, days: idx.length, episodes: episodes(idx),
      downAvg: downs.length ? downs.reduce((a, b) => a + b, 0) / downs.length : null,
      ddAfterFall: median(dd),
    };
  });
  const cross = [150, 145, 140].map(th => {
    const ev: number[] = [];
    for (let i = 20; i < n; i++) if (m[i] < th && Math.min(...m.slice(i - 20, i)) >= th) ev.push(i);
    const r20 = ev.map(i => ret(i, 20)).filter((v): v is number => v !== null);
    return {
      threshold: th, n: ev.length,
      dd10: median(ev.map(i => minAfter(i, 10)).filter((v): v is number => v !== null)),
      ret20: r20.length ? r20.reduce((a, b) => a + b, 0) / r20.length : null,
    };
  });
  return { zones, cross };
}

export type CreditRow =[string, number | null, number | null, number | null, number | null,
  number | null, number | null, number | null, number | null, number | null];

/** 信用交易儀表板的欄位名，跟 CreditRow 的位置對應 */
export const CREDIT = { d: 0, keep: 1, below: 2, call: 3, callAmt: 4, exe: 5, exeAmt: 6, acc: 7, accRate: 8, amt: 9 } as const;

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

  // 有扣投信賣出買權的版本就用它：原始值被掩護性買權 ETF 長期壓在 100 以下
  const adj = data.pc.oiAdj && lastTwo(data.pc.oiAdj)[0] !== null;
  const [pc, pcPrev] = lastTwo(adj ? data.pc.oiAdj! : data.pc.oi);
  if (pc !== null) {
    out.push({ key: 'pc', label: 'P/C 未平倉比', value: pc,
      change: pcPrev === null ? null : pc - pcPrev, unit: 'pct', tone: 'none',
      hint: adj ? '已扣投信賣出買權' : '賣權 ÷ 買權' });
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
