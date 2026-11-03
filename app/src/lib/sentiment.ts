/* 自算的美股恐懼貪婪指數與 VIX。純函式，沒有 React。
 *
 * **這不是 CNN 的數字。** CNN 的資料端點對表明身分的程式回 HTTP 418，要拿只能
 * 假裝成瀏覽器，這個專案不做（見 scripts/fetch_chips.py 檔頭）。所以照 CNN 公開
 * 的七項方法自己算，其中兩項用代理：
 *
 *   市場動能   S&P 500 相對 125 日均線的乖離          高 = 貪婪
 *   股價強度   S&P 500 離 52 週高點多遠               代理 CNN 的「NYSE 新高減新低家數」
 *   市場寬度   等權重（RSP）÷ 市值權重（SPY）相對 50 日均線   代理 CNN 的「漲跌量能」
 *   Put/Call  CBOE 全市場 Put/Call 5 日平均（反向）   偏高 = 恐懼
 *   波動率     VIX 相對 50 日均線的乖離（反向）        VIX 偏高 = 恐懼
 *   避險需求   近 20 日 股票（SPY）− 公債（TLT）報酬   股票贏 = 貪婪
 *   垃圾債需求 近 20 日 高收益債（HYG）− 投資級債（LQD）報酬   垃圾債贏 = 貪婪
 *
 * 每一項用「今天的值在過去一年排第幾」換成 0–100 分，七項平均 —— 跟 CNN 一樣是
 * 相對於自身歷史的位置，不是絕對門檻。
 *
 * 2026-11-03 對 CNN 歷史（2011～2022-08，GitHub alexey-formalmethods/datasets）校正：
 * 原本只有四項，和 CNN 平均差 12.4 分（2017～2022），常常比 CNN 極端很多（2026-11-02
 * 自算 4、CNN 23）；補成七項後平均差 10.0、2026 年五個已知的 CNN 值平均差 19.5 → 9.9。
 * 研究腳本在站主電腦 D:\ai\_tmp\scripts_iso\fg_calib*.py（不在這個儲存庫）。
 *
 * 價格一律是含息還原價：債券 ETF 每月配息，用純價格算 20 日報酬，配息日那天會
 * 被當成債券大跌，「避險需求」每個月誤判一次。
 */

export interface UsSeries {
  dates: string[];
  spx: (number | null)[];
  vix: (number | null)[];
  spy: (number | null)[];
  tlt: (number | null)[];
  hyg: (number | null)[];
  lqd: (number | null)[];
  /** 等權重 S&P 500（RSP）。2026-11-03 以前的 chips.json 沒有 */
  rsp?: (number | null)[];
  /** CBOE 全市場 Put/Call（不是價格）。2026-11-03 以前的 chips.json 沒有 */
  pc?: (number | null)[];
}

/** 往前補值：某檔某天沒資料（休市或還沒更新）就沿用前一天。開頭的 null 留著。 */
export function ffill(xs: (number | null)[]): (number | null)[] {
  let last: number | null = null;
  return xs.map(v => {
    if (v !== null && Number.isFinite(v) && v > 0) last = v;
    return last;
  });
}

/** n 日簡單均線。不滿 n 天是 null。 */
export function sma(xs: (number | null)[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  let count = 0;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (v === null) { out.push(null); sum = 0; count = 0; continue; }
    sum += v;
    count++;
    if (count > n) { sum -= xs[i - n]!; count = n; }
    out.push(count === n ? sum / n : null);
  }
  return out;
}

/** 近 n 天（含今天）的最高值。開頭不滿 n 天是 null。 */
export function rollingMax(xs: (number | null)[], n: number): (number | null)[] {
  return xs.map((_, i) => {
    if (i < n - 1) return null;
    let m: number | null = null;
    for (let j = i - n + 1; j <= i; j++) {
      const v = xs[j];
      if (v !== null && (m === null || v > m)) m = v;
    }
    return m;
  });
}

/** n 日報酬（小數）。 */
export function ret(xs: (number | null)[], n: number): (number | null)[] {
  return xs.map((v, i) => {
    const a = i >= n ? xs[i - n] : null;
    return v !== null && a ? v / a - 1 : null;
  });
}

/**
 * 在前 window 個有值的樣本裡排第幾（0–100）。
 *
 * 用百分位而不是 z 分數：這幾項的分布都很偏（VIX 會突然翻倍），z 分數會被
 * 少數幾天拉走。樣本不滿半個窗口時回 null，太少的排名只是雜訊。
 */
export function rollingPercentile(xs: (number | null)[], window = 252): (number | null)[] {
  return xs.map((v, i) => {
    if (v === null) return null;
    const hist: number[] = [];
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      const h = xs[j];
      if (h !== null) hist.push(h);
    }
    if (hist.length < window / 2) return null;
    const below = hist.filter(h => h < v).length;
    const equal = hist.filter(h => h === v).length;
    return ((below + (equal - 1) / 2) / (hist.length - 1 || 1)) * 100;
  });
}

export type ComponentKey =
  'momentum' | 'strength' | 'breadth' | 'putCall' | 'volatility' | 'safeHaven' | 'junk';

/** 順序照 CNN 頁面 */
export const COMPONENT_LABEL: Record<ComponentKey, string> = {
  momentum: '市場動能',
  strength: '股價強度',
  breadth: '市場寬度',
  putCall: 'Put/Call',
  volatility: '波動率',
  safeHaven: '避險需求',
  junk: '垃圾債需求',
};

/** 七項原始值（越大越貪婪）。舊的 chips.json 沒有 RSP／Put/Call，那兩項整列是 null。 */
export function components(us: UsSeries): Record<ComponentKey, (number | null)[]> {
  const none = us.dates.map(() => null);
  const spx = ffill(us.spx);
  const vix = ffill(us.vix);
  const spy = ffill(us.spy);
  const tlt = ffill(us.tlt);
  const hyg = ffill(us.hyg);
  const lqd = ffill(us.lqd);
  const ma125 = sma(spx, 125);
  const hi252 = rollingMax(spx, 252);
  const vma50 = sma(vix, 50);
  const diff = (a: (number | null)[], b: (number | null)[]) =>
    a.map((v, i) => (v !== null && b[i] !== null ? v - b[i]! : null));
  // 市場寬度：等權重相對市值權重走強 = 不只少數大型股在漲
  const rel = us.rsp ? ffill(us.rsp).map((v, i) => (v !== null && spy[i] ? v / spy[i]! : null)) : none;
  const rel50 = sma(rel, 50);
  // Put/Call 5 日平均；買賣權比偏高 = 避險買盤多 = 恐懼，所以取負號
  const pc5 = us.pc ? sma(ffill(us.pc), 5) : none;
  return {
    momentum: spx.map((v, i) => (v !== null && ma125[i] ? v / ma125[i]! - 1 : null)),
    strength: spx.map((v, i) => (v !== null && hi252[i] ? v / hi252[i]! - 1 : null)),
    breadth: rel.map((v, i) => (v !== null && rel50[i] ? v / rel50[i]! - 1 : null)),
    putCall: pc5.map(v => (v === null ? null : -v)),
    // VIX 高於均線 = 恐懼，所以取負號，讓四項都是「越大越貪婪」
    volatility: vix.map((v, i) => (v !== null && vma50[i] ? -(v / vma50[i]! - 1) : null)),
    safeHaven: diff(ret(spy, 20), ret(tlt, 20)),
    junk: diff(ret(hyg, 20), ret(lqd, 20)),
  };
}

export type Mood = '極度恐懼' | '恐懼' | '中性' | '貪婪' | '極度貪婪';

/** 分數 -> 文字。區間照 CNN 的畫法：25／45／55／75。 */
export function mood(score: number): Mood {
  if (score < 25) return '極度恐懼';
  if (score < 45) return '恐懼';
  if (score <= 55) return '中性';
  if (score <= 75) return '貪婪';
  return '極度貪婪';
}

export interface FearGreed {
  dates: string[];
  /** 每天的指數（0–100），有資料的項目缺兩項以上（或不到三項）的日子是 null */
  index: (number | null)[];
  latest: {
    date: string;
    score: number;
    mood: Mood;
    parts: { key: ComponentKey; score: number | null; raw: number | null }[];
  } | null;
}

export function fearGreed(us: UsSeries, window = 252): FearGreed {
  const raw = components(us);
  // 舊的 chips.json 沒有 RSP／Put/Call：只用有資料的項目，畫面也不列空的那幾項
  const keys = (Object.keys(COMPONENT_LABEL) as ComponentKey[])
    .filter(k => raw[k].some(v => v !== null));
  const scores = Object.fromEntries(
    keys.map(k => [k, rollingPercentile(raw[k], window)]),
  ) as Record<ComponentKey, (number | null)[]>;
  const need = Math.max(3, keys.length - 1);

  const index = us.dates.map((_, i) => {
    const got = keys.map(k => scores[k][i]).filter((v): v is number => v !== null);
    return got.length >= need ? got.reduce((a, b) => a + b, 0) / got.length : null;
  });

  let latest: FearGreed['latest'] = null;
  for (let i = index.length - 1; i >= 0; i--) {
    const score = index[i];
    if (score === null) continue;
    latest = {
      date: us.dates[i], score, mood: mood(score),
      parts: keys.map(k => ({ key: k, score: scores[k][i], raw: raw[k][i] })),
    };
    break;
  }
  return { dates: us.dates, index, latest };
}

export interface VixView {
  date: string;
  close: number;
  /** 與前一個交易日的差（點） */
  change: number | null;
  /** 過去一年排第幾（0–100） */
  pct: number | null;
}

/** VIX 最新值、日變化與一年百分位。 */
export function vixView(us: UsSeries): VixView | null {
  const idx: number[] = [];
  us.vix.forEach((v, i) => { if (v !== null && v > 0) idx.push(i); });
  if (idx.length === 0) return null;
  const last = idx[idx.length - 1];
  const prev = idx.length > 1 ? idx[idx.length - 2] : null;
  const close = us.vix[last]!;
  const year = idx.slice(-252).map(i => us.vix[i]!);
  return {
    date: us.dates[last],
    close,
    change: prev === null ? null : close - us.vix[prev]!,
    pct: year.length >= 60 ? (year.filter(v => v < close).length / year.length) * 100 : null,
  };
}
