/* 可轉債：型別、統計看板、產業整理、篩選排序。純函式，沒有 React。
 *
 * 資料是 scripts/fetch_cb.py 從櫃買中心整理的（行情表＋資訊看板＋發行資料）。
 * 價格口徑：當天有成交用收市價，沒成交用櫃買「明日參價」（參考價）——
 * 官方免費資料沒有委買價，所以跟 XQ 那類看板的「委買價」不是同一個數字。
 *
 *   轉換價值 ＝ 100 × 標的股價 ÷ 轉換價
 *   溢價率   ＝ 可轉債價格 ÷ 轉換價值 − 1
 */

export interface CbBond {
  /** 債券代號，例如 11011 */
  c: string;
  n: string;
  /** 標的股票代號（代號前四碼）與名稱、產業、市場 */
  s: string;
  sn: string;
  ind: string;
  mk: string;
  /** 價格：收市價，沒成交是參考價 */
  px: number | null;
  /** 當天收市價；null 就是沒成交 */
  close: number | null;
  chg: number | null;
  /** 成交張數（櫃買的「單位」，一張面額十萬）與金額（元） */
  vol: number | null;
  val: number | null;
  /** 轉換價與它的生效日（櫃買看板給的是「下次生效日之後」的轉換價） */
  cp: number | null;
  cpEff: string | null;
  /** 標的股價；exch＝交換債，股價取自看板而不是代號前四碼的股票 */
  sp: number | null;
  exch: boolean;
  cv: number | null;
  prem: number | null;
  convS: string | null;
  convE: string | null;
  putS: string | null;
  putE: string | null;
  putP: number | null;
  callS: string | null;
  callP: number | null;
  end: string | null;
  halt: string | null;
  /** 原始發行總額、上月底餘額（元） */
  tot: number | null;
  out: number | null;
  coupon: number | null;
  issue: string | null;
  mat: string | null;
  g: string | null;
}

export interface CbUpcoming {
  c: string;
  n: string;
  issuer: string;
  s: string;
  ind: string;
  issue: string | null;
  list: string | null;
  mat: string | null;
  /** 發行總額（元） */
  amt: number | null;
  /** 發行時轉換價 */
  cp: number | null;
  g: string;
  y: number | null;
}

export interface CbData {
  meta: {
    date: string;
    board: string;
    updated: string;
    count: number;
    traded: number;
    source: string;
    errors: string[];
  };
  bonds: CbBond[];
  upcoming: CbUpcoming[];
}

/* ── 價格區間（照使用者給的 XQ 看板：<95、95~100、100~105、105~110、110~120、≥120） ── */

export interface Bucket {
  id: string;
  label: string;
  /** [lo, hi)；lo 為 -Infinity、hi 為 Infinity 表示開放端 */
  lo: number;
  hi: number;
}

export const BUCKETS: Bucket[] = [
  { id: 'lt95', label: '<95', lo: -Infinity, hi: 95 },
  { id: '95', label: '95~100', lo: 95, hi: 100 },
  { id: '100', label: '100~105', lo: 100, hi: 105 },
  { id: '105', label: '105~110', lo: 105, hi: 110 },
  { id: '110', label: '110~120', lo: 110, hi: 120 },
  { id: 'ge120', label: '≥120', lo: 120, hi: Infinity },
];

/** 使用者另外要看的高價段：≥120 再拆成 120~150 與 ≥150 */
export const HIGH_BUCKETS: Bucket[] = [
  { id: '120', label: '120~150', lo: 120, hi: 150 },
  { id: 'ge150', label: '≥150', lo: 150, hi: Infinity },
];

export function inBucket(px: number, b: Bucket): boolean {
  return px >= b.lo && px < b.hi;
}

/**
 * 百分位數，線性內插（等同 Excel PERCENTILE.INC）。p 是 0～100。
 * XQ 看板的「PR75 最高價」「PR90 高高價」就是這個。
 */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (v.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return v[lo] + (v[hi] - v[lo]) * (rank - lo);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export interface BucketRow {
  bucket: Bucket;
  count: number;
  /** 累計到這一格佔有效樣本的比例（%） */
  cum: number;
  /** 這一格自己佔的比例（%） */
  share: number;
}

export interface CbStats {
  total: number;
  /** 有效樣本：有價格的那些（onlyTraded 時只算當天有成交的） */
  valid: number;
  /** 當天沒成交的檔數（只用參考價的） */
  untraded: number;
  buckets: BucketRow[];
  high: BucketRow[];
  avgPx: number | null;
  pr75: number | null;
  pr90: number | null;
  avgCv: number | null;
  avgPrem: number | null;
  /** 轉換價值 ≥ 100（價內）那些的平均溢價率 */
  avgPremItm: number | null;
  cvGe100: number;
  cvGe120: number;
  premGt0: number;
  premGe50: number;
  premGe100: number;
}

/**
 * 看板上的統計。onlyTraded＝只算當天有成交的（比較接近「有人在買」），
 * 否則沒成交的用參考價一起算。
 */
export function cbStats(bonds: CbBond[], onlyTraded = false): CbStats {
  const rows = bonds.filter(b => b.px !== null && (!onlyTraded || b.close !== null));
  const px = rows.map(b => b.px as number);
  const count = (bk: Bucket) => px.filter(p => inBucket(p, bk)).length;
  let run = 0;
  const pct = (n: number) => (rows.length ? (n / rows.length) * 100 : 0);
  const buckets = BUCKETS.map(bucket => {
    const n = count(bucket);
    run += n;
    return { bucket, count: n, cum: pct(run), share: pct(n) };
  });
  const high = HIGH_BUCKETS.map(bucket => {
    const n = count(bucket);
    return { bucket, count: n, cum: NaN, share: pct(n) };
  });
  const withCv = rows.filter(b => b.cv !== null && b.prem !== null);
  return {
    total: bonds.length,
    valid: rows.length,
    untraded: bonds.filter(b => b.close === null).length,
    buckets,
    high,
    avgPx: mean(px),
    pr75: percentile(px, 75),
    pr90: percentile(px, 90),
    avgCv: mean(withCv.map(b => b.cv as number)),
    avgPrem: mean(withCv.map(b => b.prem as number)),
    avgPremItm: mean(withCv.filter(b => (b.cv as number) >= 100).map(b => b.prem as number)),
    cvGe100: withCv.filter(b => (b.cv as number) >= 100).length,
    cvGe120: withCv.filter(b => (b.cv as number) >= 120).length,
    premGt0: withCv.filter(b => (b.prem as number) > 0).length,
    premGe50: withCv.filter(b => (b.prem as number) >= 50).length,
    premGe100: withCv.filter(b => (b.prem as number) >= 100).length,
  };
}

/* ── 產業整理 ─────────────────────────────────────────────── */

export interface IndustryRow {
  ind: string;
  /** 掛牌中的可轉債檔數、發行公司家數 */
  bonds: number;
  issuers: number;
  /** 上月底餘額合計（元） */
  outstanding: number;
  /** 近 N 天新發行的檔數（依發行日） */
  recent: number;
  /** 待發行檔數 */
  upcoming: number;
  /** 這個產業的公司，各自的代號與名稱（去重） */
  names: Array<{ s: string; sn: string }>;
}

/** 日期字串加減天數，YYYY-MM-DD。 */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * 依產業整理發行公司。recentDays 內發行的算「近期」—— 看同一個產業
 * 是不是最近集中發債（通常代表那個產業在擴產、或股價在高檔好轉換）。
 * 排序：近期＋待發行多的在前，再看掛牌檔數。
 */
export function byIndustry(bonds: CbBond[], upcoming: CbUpcoming[], asOf: string,
                           recentDays = 180): IndustryRow[] {
  const since = addDays(asOf, -recentDays);
  const map = new Map<string, IndustryRow & { _s: Set<string> }>();
  const row = (ind: string) => {
    let r = map.get(ind);
    if (!r) {
      r = { ind, bonds: 0, issuers: 0, outstanding: 0, recent: 0, upcoming: 0, names: [], _s: new Set() };
      map.set(ind, r);
    }
    return r;
  };
  for (const b of bonds) {
    const r = row(b.ind || '其他');
    r.bonds += 1;
    r.outstanding += b.out ?? 0;
    if (b.issue && b.issue >= since && b.issue <= asOf) r.recent += 1;
    if (!r._s.has(b.s)) { r._s.add(b.s); r.names.push({ s: b.s, sn: b.sn || b.n }); }
  }
  for (const u of upcoming) {
    const r = row(u.ind || '其他');
    r.upcoming += 1;
    if (!r._s.has(u.s)) { r._s.add(u.s); r.names.push({ s: u.s, sn: u.issuer }); }
  }
  return [...map.values()]
    .map(({ _s, ...r }) => ({ ...r, issuers: _s.size }))
    .sort((a, b) => (b.recent + b.upcoming) - (a.recent + a.upcoming) || b.bonds - a.bonds
      || a.ind.localeCompare(b.ind, 'zh-Hant'));
}

/* ── 清單篩選與排序 ───────────────────────────────────────── */

export type CbSort = 'prem' | 'px' | 'cv' | 'val' | 'outPct' | 'mat' | 'issue';

export const CB_SORTS: Array<{ id: CbSort; label: string; desc: boolean }> = [
  { id: 'val', label: '成交金額', desc: true },
  { id: 'prem', label: '溢價率', desc: false },
  { id: 'px', label: '價格', desc: true },
  { id: 'cv', label: '轉換價值', desc: true },
  { id: 'outPct', label: '餘額比例', desc: false },
  { id: 'issue', label: '發行日', desc: true },
  { id: 'mat', label: '到期日', desc: false },
];

/** 餘額佔原始發行的比例（%）。低代表大多已經轉換成股票（或被賣回）。 */
export function outPct(b: CbBond): number | null {
  return b.tot && b.out !== null ? (b.out / b.tot) * 100 : null;
}

function sortKey(b: CbBond, s: CbSort): number | string | null {
  switch (s) {
    case 'prem': return b.prem;
    case 'px': return b.px;
    case 'cv': return b.cv;
    case 'val': return b.val ?? 0;
    case 'outPct': return outPct(b);
    case 'mat': return b.mat;
    case 'issue': return b.issue;
  }
}

export interface CbFilter {
  q: string;
  bucket: string | null;
  ind: string | null;
  onlyTraded: boolean;
  sort: CbSort;
  desc: boolean;
}

export function filterBonds(bonds: CbBond[], f: CbFilter): CbBond[] {
  const q = f.q.trim().toLowerCase();
  const bk = [...BUCKETS, ...HIGH_BUCKETS].find(b => b.id === f.bucket) ?? null;
  const rows = bonds.filter(b =>
    (!q || b.c.includes(q) || b.s.includes(q) || b.n.toLowerCase().includes(q) || b.sn.toLowerCase().includes(q))
    && (!bk || (b.px !== null && inBucket(b.px, bk)))
    && (!f.ind || b.ind === f.ind)
    && (!f.onlyTraded || b.close !== null));
  // 空值一律排最後，不管升冪降冪 —— 不然「沒有溢價率」會擠在最便宜的前面
  return rows.sort((a, b) => {
    const x = sortKey(a, f.sort);
    const y = sortKey(b, f.sort);
    if (x === null && y === null) return a.c.localeCompare(b.c);
    if (x === null) return 1;
    if (y === null) return -1;
    const c = x < y ? -1 : x > y ? 1 : 0;
    return (f.desc ? -c : c) || a.c.localeCompare(b.c);
  });
}

/** 「1.5 億」「8,000 萬」。金額是元。 */
export function yi(v: number | null): string {
  if (v === null) return '—';
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toLocaleString('zh-TW', { maximumFractionDigits: 1 })} 億`;
  return `${Math.round(v / 1e4).toLocaleString('zh-TW')} 萬`;
}
