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
  /** 轉換分析（2026-11-05，參考 XQ）：最近 1／3 個月底餘額減少幾張（多半是轉換成股票，賣回那個月也算進來）、最近一筆是哪個月底 */
  cv1?: number | null;
  cv3?: number | null;
  cvM?: string | null;
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

/** 籌備中：重大訊息主旨提到轉換公司債（董事會決議、申報生效…），之後還沒發新債的 */
export interface CbPlanned {
  s: string;
  name: string;
  ind: string;
  subject: string;
  /** 公告日 */
  d: string;
  u: string;
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
  /** 舊版 cb.json 沒有 */
  planned?: CbPlanned[];
}

/** 市場溫度計歷史（cb_market.json）：每天一列，欄位名在 cols */
export interface CbMarket {
  cols: string[];
  rows: Array<Array<string | number | null>>;
}

/** 單檔走勢（cb_series/<代號>.json）：[日期, 價格, 標的股價, 溢價率] */
export type CbSeriesPoint = [string, number, number | null, number | null];

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

export type CbSort = 'code' | 'vol' | 'prem' | 'px' | 'cv' | 'val' | 'outPct' | 'mat' | 'issue' | 'ytp' | 'ytm' | 'put' | 'conv' | 'cbas';

export const CB_SORTS: Array<{ id: CbSort; label: string; desc: boolean }> = [
  { id: 'vol', label: '成交量', desc: true },
  { id: 'code', label: '代號', desc: false },
  { id: 'val', label: '成交金額', desc: true },
  { id: 'prem', label: '溢價率', desc: false },
  { id: 'px', label: '價格', desc: true },
  { id: 'cv', label: '轉換價值', desc: true },
  { id: 'ytp', label: '賣回殖利率', desc: true },
  { id: 'ytm', label: '到期殖利率', desc: true },
  { id: 'put', label: '賣回日', desc: false },
  { id: 'outPct', label: '餘額比例', desc: false },
  { id: 'conv', label: '近一月轉換', desc: true },
  { id: 'cbas', label: 'CBAS 權利金', desc: false },
  { id: 'issue', label: '發行日', desc: true },
  { id: 'mat', label: '到期日', desc: false },
];

/** 餘額佔原始發行的比例（%）。低代表大多已經轉換成股票（或被賣回）。 */
export function outPct(b: CbBond): number | null {
  return b.tot && b.out !== null ? (b.out / b.tot) * 100 : null;
}

const DAY_MS = 86_400_000;

/** 兩個 YYYY-MM-DD 相差幾天（b − a）。 */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** 賣回日：申請期間的最後一天（櫃買給起迄，錢在截止後才付，用迄日比較保守）。 */
export function putDate(b: CbBond): string | null {
  return b.putE ?? b.putS;
}

/**
 * 年化報酬（%）：用 px 買、在 day 拿回 redeem。距離不到 30 天的不算 ——
 * 幾天的報酬年化之後會變成好幾百 %，排序時把真正有意義的擠掉。
 */
function annualised(px: number | null, redeem: number | null, asOf: string, day: string | null): number | null {
  if (!px || !redeem || !day) return null;
  const d = daysBetween(asOf, day);
  if (d < 30) return null;
  return (Math.pow(redeem / px, 365 / d) - 1) * 100;
}

/** 賣回殖利率：現在買、到最近賣回日用賣回價賣回的年化報酬（%）。沒有賣回權就是 null。 */
export function ytp(b: CbBond, asOf: string): number | null {
  const d = putDate(b);
  return d && d >= asOf ? annualised(b.px, b.putP, asOf, d) : null;
}

/** 到期殖利率：假設到期以面額 100 償還（台灣可轉債多半零票面、到期還本 100）。 */
export function ytm(b: CbBond, asOf: string): number | null {
  return b.mat && b.mat >= asOf ? annualised(b.px, 100, asOf, b.mat) : null;
}

/** 剩餘年期（年，到期日 − 資料日）；XQ 的資料項也有這一欄（2026-11-05 使用者要參考 XQ） */
export function yearsLeft(b: CbBond, asOf: string): number | null {
  return b.mat && b.mat >= asOf ? daysBetween(asOf, b.mat) / 365.25 : null;
}

/** 近一個月轉換（餘額減少）佔原始發行的比例（%）；面額十萬一張 */
export function convPct(b: CbBond): number | null {
  return b.cv1 != null && b.tot ? (b.cv1 * 1e5 / b.tot) * 100 : null;
}

/** 每月底餘額（張），cb_conv.json：{代號: [[YYYY-MM, 張], …]} */
export type CbConv = Record<string, Array<[string, number]>>;

/** 每月轉換（餘額減少）張數：[[月, 張]]，第一個月沒有前一筆不算；餘額增加（極少見）記 0 */
export function monthlyConv(rows: Array<[string, number]>): Array<[string, number]> {
  return rows.slice(1).map(([m, v], i) => [m, Math.max(0, rows[i][1] - v)]);
}

/**
 * CBAS 權利金粗估（每 100 元面額）＝ 可轉債價格 − 債底。債底＝最近一次賣回（有、而且還沒過）用賣回價、否則到期用 100，
 * 以 CBAS_RATE 年利率折現到今天。CBAS（可轉債資產交換）買的就是這段「選擇權」，券商報價還會看信用、利率與流動性，所以只是粗估。
 */
export const CBAS_RATE = 0.02;

export function bondFloor(b: CbBond, asOf: string, rate = CBAS_RATE): number | null {
  const pd = putDate(b);
  const [redeem, day] = pd && pd >= asOf && b.putP ? [b.putP, pd] : b.mat && b.mat >= asOf ? [100, b.mat] : [null, null];
  if (redeem === null || day === null) return null;
  return redeem / Math.pow(1 + rate, daysBetween(asOf, day) / 365);
}

export function cbasPrem(b: CbBond, asOf: string, rate = CBAS_RATE): number | null {
  const f = bondFloor(b, asOf, rate);
  return f === null || b.px === null ? null : b.px - f;
}

/** 已經進入轉換期間 */
export function convertible(b: CbBond, asOf: string): boolean {
  return Boolean(b.convS && b.convS <= asOf && (!b.convE || b.convE >= asOf));
}

function sortKey(b: CbBond, s: CbSort, asOf: string): number | string | null {
  switch (s) {
    case 'code': return b.c;
    case 'prem': return b.prem;
    case 'px': return b.px;
    case 'cv': return b.cv;
    case 'val': return b.val ?? 0;
    case 'vol': return b.vol ?? 0;
    case 'outPct': return outPct(b);
    case 'mat': return b.mat;
    case 'issue': return b.issue;
    case 'ytp': return ytp(b, asOf);
    case 'ytm': return ytm(b, asOf);
    case 'conv': return convPct(b);
    case 'cbas': return cbasPrem(b, asOf);
    case 'put': { const d = putDate(b); return d && d >= asOf ? d : null; }
  }
}

/** 數值區間；null 表示不限 */
export interface Range { min: number | null; max: number | null }

export const ANY: Range = { min: null, max: null };

export interface CbFilter {
  q: string;
  bucket: string | null;
  ind: string | null;
  onlyTraded: boolean;
  sort: CbSort;
  desc: boolean;
  px?: Range;
  prem?: Range;
  cv?: Range;
  /** 餘額比例（%） */
  out?: Range;
  /** 賣回殖利率（%） */
  ytp?: Range;
  /** 到期殖利率（%） */
  ytm?: Range;
  /** 剩餘年期（年） */
  yrs?: Range;
  /** 近一月轉換佔發行（%） */
  conv?: Range;
  /** CBAS 權利金粗估（每 100 元面額） */
  cbas?: Range;
  /** 距最近賣回日幾天內（null＝不限） */
  putWithin?: number | null;
  /** 發行幾天內（null＝不限） */
  issuedWithin?: number | null;
  /** '有擔保' | '無擔保' | null */
  guarantee?: string | null;
  /** 只看已進入轉換期間 */
  convertibleOnly?: boolean;
  /** 今天成交張數至少 */
  minVol?: number | null;
  /** 只看收藏 */
  favs?: ReadonlySet<string> | null;
  /** 判斷「幾天內」「已可轉換」的基準日（資料日期） */
  asOf?: string;
}

const inRange = (v: number | null, r?: Range) =>
  !r || (r.min === null && r.max === null)
  || (v !== null && (r.min === null || v >= r.min) && (r.max === null || v <= r.max));

/** 預設策略：一鍵套用一組條件（使用者 11-04 要的「可轉債篩選器」） */
export interface CbPreset {
  id: string;
  label: string;
  hint: string;
  f: Partial<CbFilter>;
}

export const CB_PRESETS: CbPreset[] = [
  { id: 'safe', label: '低價保本', hint: '價格 ≤ 105、一年內可賣回：下檔有賣回價撐著，上檔留給股價',
    f: { px: { min: null, max: 105 }, putWithin: 365, sort: 'ytp', desc: true } },
  { id: 'atm', label: '平價股性', hint: '溢價率 ≤ 5%、價格 ≤ 115：跟股票連動高、還沒漲太多',
    f: { prem: { min: null, max: 5 }, px: { min: null, max: 115 }, sort: 'prem', desc: false } },
  { id: 'neg', label: '負溢價', hint: '溢價率 < 0 且已可轉換：轉成股票賣掉比賣債多（要扣交易成本與轉換天數）',
    f: { prem: { min: null, max: -0.01 }, convertibleOnly: true, sort: 'prem', desc: false } },
  { id: 'new', label: '新上市', hint: '發行 90 天內：新債的蜜月期',
    f: { issuedWithin: 90, sort: 'issue', desc: true } },
  { id: 'call', label: '強贖警戒', hint: '轉換價值 ≥ 130：股價連續 30 個營業日超過轉換價 30% 時公司可以提前贖回',
    f: { cv: { min: 130, max: null }, sort: 'cv', desc: true } },
  { id: 'low', label: '餘額偏低', hint: '餘額 < 20%：大多已轉換，剩不到 10% 時公司可以收回（流動性也差）',
    f: { out: { min: null, max: 20 }, sort: 'outPct', desc: false } },
];

export function filterBonds(bonds: CbBond[], f: CbFilter): CbBond[] {
  const q = f.q.trim().toLowerCase();
  const bk = [...BUCKETS, ...HIGH_BUCKETS].find(b => b.id === f.bucket) ?? null;
  const asOf = f.asOf ?? new Date().toISOString().slice(0, 10);
  const rows = bonds.filter(b =>
    (!q || b.c.includes(q) || b.s.includes(q) || b.n.toLowerCase().includes(q) || b.sn.toLowerCase().includes(q))
    && (!bk || (b.px !== null && inBucket(b.px, bk)))
    && (!f.ind || b.ind === f.ind)
    && (!f.onlyTraded || b.close !== null)
    && inRange(b.px, f.px) && inRange(b.prem, f.prem) && inRange(b.cv, f.cv)
    && inRange(outPct(b), f.out) && inRange(ytp(b, asOf), f.ytp)
    && inRange(ytm(b, asOf), f.ytm) && inRange(yearsLeft(b, asOf), f.yrs)
    && inRange(convPct(b), f.conv) && inRange(cbasPrem(b, asOf), f.cbas)
    && (f.putWithin == null || (() => { const d = putDate(b); return Boolean(d && d >= asOf && daysBetween(asOf, d) <= f.putWithin!); })())
    && (f.issuedWithin == null || Boolean(b.issue && b.issue <= asOf && daysBetween(b.issue, asOf) <= f.issuedWithin))
    && (!f.guarantee || b.g === f.guarantee)
    && (!f.convertibleOnly || convertible(b, asOf))
    && (f.minVol == null || (b.vol ?? 0) >= f.minVol)
    && (!f.favs || f.favs.has(b.c)));
  // 空值一律排最後，不管升冪降冪 —— 不然「沒有溢價率」會擠在最便宜的前面
  return rows.sort((a, b) => {
    const x = sortKey(a, f.sort, asOf);
    const y = sortKey(b, f.sort, asOf);
    if (x === null && y === null) return a.c.localeCompare(b.c);
    if (x === null) return 1;
    if (y === null) return -1;
    const c = x < y ? -1 : x > y ? 1 : 0;
    return (f.desc ? -c : c) || a.c.localeCompare(b.c);
  });
}

/* ── 行事曆：賣回、到期、轉換價生效、強制贖回、新上櫃、開始可轉換 ── */

/** 跟 lib/calendar.ts 的 CalEvent 同形（不 import，避免兩邊互相引用） */
export interface CbEvent {
  d: string;
  kind: 'cb';
  /** 可轉債代號，「只看我的」用收藏比對 */
  code: string;
  title: string;
  detail: string;
}

const f2 = (v: number | null) => (v === null ? '—' : v.toLocaleString('zh-TW', { maximumFractionDigits: 2 }));

export function cbEvents(data: CbData | null, from: string, to: string): CbEvent[] {
  if (!data) return [];
  const out: CbEvent[] = [];
  const push = (d: string | null, code: string, title: string, detail: string) => {
    if (d && d >= from && d <= to) out.push({ d, kind: 'cb', code, title, detail });
  };
  for (const b of data.bonds) {
    const who = b.n;
    push(b.putS, b.c, `${who} 開始受理賣回`, `賣回價 ${f2(b.putP)}，申請到 ${b.putE ?? '—'}；現價 ${f2(b.px)}`);
    if (b.putE !== b.putS) push(b.putE, b.c, `${who} 賣回申請截止`, `賣回價 ${f2(b.putP)}；現價 ${f2(b.px)}`);
    push(b.mat, b.c, `${who} 到期`, `餘額 ${yi(b.out)}`);
    push(b.cpEff, b.c, `${who} 轉換價 ${f2(b.cp)} 生效`, `標的 ${b.sn || b.s} 現價 ${f2(b.sp)}`);
    push(b.callS, b.c, `${who} 強制贖回`, `贖回價 ${f2(b.callP)}`);
    push(b.end, b.c, `${who} 終止櫃檯買賣`, '');
    push(b.convS, b.c, `${who} 開始可轉換`, `轉換價 ${f2(b.cp)}`);
  }
  for (const u of data.upcoming) {
    push(u.list || u.issue, u.c, `${u.n} 新上櫃`, `發行 ${yi(u.amt)}，轉換價 ${f2(u.cp)}，${u.y ? `${u.y} 年・` : ''}${u.g}`);
  }
  return out.sort((a, b) => a.d.localeCompare(b.d) || a.code.localeCompare(b.code));
}

/* ── 收藏（localStorage；跟 ETF 收藏分開，因為代號空間不同） ── */

export const CB_FAV_KEY = 'twetf.cbFav';

export function loadCbFavs(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(CB_FAV_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveCbFavs(favs: ReadonlySet<string>): void {
  try {
    localStorage.setItem(CB_FAV_KEY, JSON.stringify([...favs].sort()));
  } catch {
    /* 私密模式等存不了，就只在這次有效 */
  }
}

/* ── 市場溫度計歷史 ─────────────────────────────────────── */

export interface MarketMetric {
  id: string;
  label: string;
  /** 從一列算出這個指標 */
  get: (row: Record<string, number | null>) => number | null;
  unit: '%' | '';
}

const share = (k: string[]) => (r: Record<string, number | null>) =>
  r.n ? (k.reduce((s, x) => s + (r[x] ?? 0), 0) / r.n) * 100 : null;

export const MARKET_METRICS: MarketMetric[] = [
  { id: 'hot', label: '價格 ≥ 120 比例', get: share(['b120p']), unit: '%' },
  { id: 'h150', label: '價格 ≥ 150 比例', get: share(['h150p']), unit: '%' },
  { id: 'cheap', label: '價格 < 100 比例', get: share(['b95', 'b100']), unit: '%' },
  { id: 'avg', label: '平均價格', get: r => r.avg, unit: '' },
  { id: 'pr90', label: 'PR90 高高價', get: r => r.pr90, unit: '' },
  { id: 'prem', label: '平均溢價率', get: r => r.prem, unit: '%' },
  { id: 'premItm', label: '價內平均溢價率', get: r => r.premItm, unit: '%' },
  { id: 'cv', label: '平均轉換價值', get: r => r.cv, unit: '' },
  { id: 'n', label: '可轉債檔數', get: r => r.n, unit: '' },
];

export function marketRows(m: CbMarket): Array<{ d: string; r: Record<string, number | null> }> {
  return m.rows.map(row => {
    const r: Record<string, number | null> = {};
    m.cols.forEach((c, i) => { if (i > 0) r[c] = row[i] === null ? null : Number(row[i]); });
    return { d: String(row[0]), r };
  });
}

/** 目前值在歷史裡的百分位（0～100）：越高代表比過去大多數時候都高 */
export function rankInHistory(values: number[], v: number): number | null {
  if (!values.length) return null;
  return (values.filter(x => x <= v).length / values.length) * 100;
}

/** 「1.5 億」「8,000 萬」。金額是元。 */
export function yi(v: number | null): string {
  if (v === null) return '—';
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toLocaleString('zh-TW', { maximumFractionDigits: 1 })} 億`;
  return `${Math.round(v / 1e4).toLocaleString('zh-TW')} 萬`;
}
