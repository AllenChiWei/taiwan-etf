/* 實盤權益分析（#/EQ，2026-10-06 使用者要求）：月／年損益、同期大盤、風險指標、自動觀察。純函式，測試在 tests/equityAnalysis.test.ts。
 *
 * 約定：傳進來的 rows 第一列是「基準日」（只取它的權益與指數當起點，不算它的損益）。
 *   選某一年時，用前一年最後一天當基準 → 每年從 0 重新算（「每年刷新」）。
 * 帳戶報酬：時間加權（每天 當日損益 ÷ 昨天權益總值 連乘），出入金不影響。
 * 大盤：tri＝加權報酬指數（含息，主要比較）；px＝加權股價指數（不含息）。缺值的日子（還沒公布）不算進大盤。
 * 「同資金放大盤」：每天把昨天的權益總值放在大盤（報酬指數）會賺多少，加總 → 跟實際損益同單位（元）比較。 */

import type { EquityRow } from './accountEquity.ts';

export interface BmRow extends EquityRow { tri?: number | null; px?: number | null }

export interface Day {
  d: string; tv: number; prevTv: number; pnl: number; flow: number; oi: number;
  ret: number;              // 帳戶當日報酬
  bm: number | null;        // 報酬指數當日報酬
  bmPx: number | null;      // 價格指數當日報酬
  bmPnl: number | null;     // 同資金放大盤的當日損益
}

export function days(rows: BmRow[]): Day[] {
  const out: Day[] = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    const r = (k: 'tri' | 'px') => (a[k] && b[k] ? (b[k] as number) / (a[k] as number) - 1 : null);
    const bm = r('tri');
    out.push({
      d: b.d, tv: b.tv, prevTv: a.tv, pnl: b.pnl, flow: b.flow, oi: b.oi,
      ret: a.tv > 0 ? b.pnl / a.tv : 0, bm, bmPx: r('px'), bmPnl: bm === null ? null : a.tv * bm,
    });
  }
  return out;
}

/** 某一年（含前一年最後一天當基準）；year 為 null 就是全部 */
export function sliceYear(rows: BmRow[], year: string | null): BmRow[] {
  if (!year) return rows;
  const i = rows.findIndex(r => r.d.startsWith(year));
  if (i < 0) return [];
  const j = rows.findIndex(r => r.d.slice(0, 4) > year);
  return rows.slice(Math.max(0, i - 1), j < 0 ? rows.length : j);
}

export const years = (rows: BmRow[]) => [...new Set(rows.slice(1).map(r => r.d.slice(0, 4)))];

const compound = (xs: number[]) => xs.reduce((a, x) => a * (1 + x), 1) - 1;

export interface Period {
  key: string; start: string; end: string; n: number;
  startTv: number; endTv: number; flow: number; pnl: number;
  ret: number; bm: number | null; bmPx: number | null; excess: number | null; bmPnl: number | null;
  bmPartial: boolean; winDays: number; mddPct: number;
}

function period(key: string, ds: Day[]): Period {
  const withBm = ds.filter(x => x.bm !== null);
  const withPx = ds.filter(x => x.bmPx !== null);
  const bm = withBm.length ? compound(withBm.map(x => x.bm as number)) : null;
  const retCmp = compound(withBm.map(x => x.ret));          // 帳戶只取大盤有資料的日子，才公平
  let eq = 1, peak = 1, mdd = 0;
  for (const x of ds) { eq *= 1 + x.ret; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
  return {
    key, start: ds[0].d, end: ds[ds.length - 1].d, n: ds.length,
    startTv: ds[0].prevTv, endTv: ds[ds.length - 1].tv,
    flow: ds.reduce((a, x) => a + x.flow, 0), pnl: ds.reduce((a, x) => a + x.pnl, 0),
    ret: compound(ds.map(x => x.ret)), bm, bmPx: withPx.length ? compound(withPx.map(x => x.bmPx as number)) : null,
    excess: bm === null ? null : retCmp - bm,
    bmPnl: withBm.length ? withBm.reduce((a, x) => a + (x.bmPnl as number), 0) : null,
    bmPartial: withBm.length < ds.length, winDays: ds.filter(x => x.pnl > 0).length, mddPct: mdd,
  };
}

export function periods(ds: Day[], unit: 'M' | 'Y'): Period[] {
  const len = unit === 'M' ? 7 : 4;
  const groups = new Map<string, Day[]>();
  for (const x of ds) {
    const k = x.d.slice(0, len);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(x);
  }
  return [...groups].map(([k, g]) => period(k, g));
}

export interface Point { d: string; acc: number; bm: number | null; px: number | null; accDd: number; bmDd: number | null }

/** 累積報酬（從 0 起算）與各自的回撤（%） */
export function curve(rows: BmRow[]): Point[] {
  if (!rows.length) return [];
  const b0 = rows[0];
  let acc = 1, peak = 1, bmPeak = 1;
  const out: Point[] = [{ d: b0.d, acc: 0, bm: b0.tri ? 0 : null, px: b0.px ? 0 : null, accDd: 0, bmDd: b0.tri ? 0 : null }];
  for (const x of days(rows)) {
    acc *= 1 + x.ret; peak = Math.max(peak, acc);
    const r = rows.find(z => z.d === x.d)!;
    const bmLv = r.tri && b0.tri ? r.tri / b0.tri : null;
    if (bmLv !== null) bmPeak = Math.max(bmPeak, bmLv);
    out.push({ d: x.d, acc: acc - 1, bm: bmLv === null ? null : bmLv - 1,
               px: r.px && b0.px ? r.px / b0.px - 1 : null, accDd: acc / peak - 1, bmDd: bmLv === null ? null : bmLv / bmPeak - 1 });
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / (xs.length || 1);
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const downDev = (xs: number[]) => Math.sqrt(xs.reduce((a, x) => a + Math.min(0, x) ** 2, 0) / (xs.length || 1));

export interface Risk {
  n: number; nBm: number;
  ret: number; bm: number | null; excess: number | null;
  ann: number | null; annBm: number | null;          // 年化（樣本 < 60 天不給）
  vol: number; volBm: number | null;                 // 年化波動
  sharpe: number | null; sharpeBm: number | null; sortino: number | null; sortinoBm: number | null;
  mddPct: number; mddBm: number | null; mddMoney: number; ddNow: number; ddDays: number;
  beta: number | null; corr: number | null; alpha: number | null;   // alpha 為年化
  upCap: number | null; downCap: number | null;      // 大盤漲／跌的日子，帳戶平均報酬 ÷ 大盤平均報酬
  beatDays: number | null;                           // 帳戶當日報酬勝過大盤的天數比例
  winRate: number; pf: number | null; avgWin: number; avgLoss: number;
  best: Day | null; worst: Day | null; pnl: number; bmPnl: number | null; top3Share: number | null;
}

export const MIN_ANNUAL_DAYS = 60;

export function risk(rows: BmRow[]): Risk | null {
  const ds = days(rows);
  if (!ds.length) return null;
  const r = ds.map(x => x.ret);
  const both = ds.filter(x => x.bm !== null);
  const rb = both.map(x => x.ret), b = both.map(x => x.bm as number);
  const c = curve(rows);
  const last = c[c.length - 1];
  const bm = both.length ? compound(b) : null;
  const ann = (x: number, n: number) => (n >= MIN_ANNUAL_DAYS ? (1 + x) ** (252 / n) - 1 : null);
  let beta: number | null = null, corr: number | null = null, alpha: number | null = null;
  if (both.length >= 5 && sd(b) > 0) {
    const mr = mean(rb), mb = mean(b);
    const cov = rb.reduce((a, x, i) => a + (x - mr) * (b[i] - mb), 0) / (both.length - 1);
    beta = cov / sd(b) ** 2;
    corr = sd(rb) > 0 ? cov / (sd(rb) * sd(b)) : null;
    alpha = (mr - beta * mb) * 252;
  }
  const cap = (sel: (x: number) => boolean) => {
    const idx = b.map((x, i) => (sel(x) ? i : -1)).filter(i => i >= 0);
    if (!idx.length) return null;
    const mb = mean(idx.map(i => b[i]));
    return mb !== 0 ? mean(idx.map(i => rb[i])) / mb : null;
  };
  // 金額回撤（累計損益距高點）與目前回撤持續天數
  let cum = 0, peak = 0, mddMoney = 0, ddDays = 0;
  for (const x of ds) { cum += x.pnl; if (cum >= peak) { peak = cum; ddDays = 0; } else ddDays++; mddMoney = Math.min(mddMoney, cum - peak); }
  const wins = ds.filter(x => x.pnl > 0), losses = ds.filter(x => x.pnl < 0);
  const gw = wins.reduce((a, x) => a + x.pnl, 0), gl = -losses.reduce((a, x) => a + x.pnl, 0);
  const pnl = ds.reduce((a, x) => a + x.pnl, 0);
  const top3 = [...ds].sort((x, y) => y.pnl - x.pnl).slice(0, 3).reduce((a, x) => a + Math.max(0, x.pnl), 0);
  const sh = (xs: number[]) => (sd(xs) > 0 ? (mean(xs) / sd(xs)) * Math.sqrt(252) : null);
  const so = (xs: number[]) => (downDev(xs) > 0 ? (mean(xs) / downDev(xs)) * Math.sqrt(252) : null);
  return {
    n: ds.length, nBm: both.length,
    ret: last.acc, bm, excess: bm === null ? null : compound(rb) - bm,
    ann: ann(last.acc, ds.length), annBm: bm === null ? null : ann(bm, both.length),
    vol: sd(r) * Math.sqrt(252), volBm: both.length ? sd(b) * Math.sqrt(252) : null,
    sharpe: sh(r), sharpeBm: both.length ? sh(b) : null, sortino: so(r), sortinoBm: both.length ? so(b) : null,
    mddPct: Math.min(...c.map(p => p.accDd)), mddBm: both.length ? Math.min(...c.map(p => p.bmDd ?? 0)) : null,
    mddMoney, ddNow: cum - peak, ddDays,
    beta, corr, alpha, upCap: cap(x => x > 0), downCap: cap(x => x < 0),
    beatDays: both.length ? both.filter(x => x.ret > (x.bm as number)).length / both.length : null,
    winRate: wins.length / ds.length, pf: gl > 0 ? gw / gl : null,
    avgWin: wins.length ? gw / wins.length : 0, avgLoss: losses.length ? -gl / losses.length : 0,
    best: ds.reduce((a, x) => (x.pnl > a.pnl ? x : a)), worst: ds.reduce((a, x) => (x.pnl < a.pnl ? x : a)),
    pnl, bmPnl: both.length ? both.reduce((a, x) => a + (x.bmPnl as number), 0) : null,
    top3Share: pnl > 0 ? top3 / pnl : null,
  };
}

export interface Note { tone: 'good' | 'warn' | 'info'; text: string }

const p1 = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;

/** 依數字自動產生的觀察與建議（規則固定，不是預測） */
export function notes(k: Risk): Note[] {
  const out: Note[] = [];
  if (k.n < MIN_ANNUAL_DAYS)
    out.push({ tone: 'info', text: `樣本只有 ${k.n} 個交易日，勝負與比率都還不穩定；年化數字要累積 ${MIN_ANNUAL_DAYS} 天以上才顯示。至少看滿一季、最好一年再下結論。` });
  if (k.excess !== null)
    out.push(k.excess >= 0
      ? { tone: 'good', text: `同期贏大盤（含息）${p1(k.excess)}：帳戶 ${p1(k.ret)}、大盤 ${p1(k.bm ?? 0)}。` }
      : { tone: 'warn', text: `同期輸大盤（含息）${p1(k.excess)}：帳戶 ${p1(k.ret)}、大盤 ${p1(k.bm ?? 0)}。` });
  if (k.beta !== null && k.alpha !== null && k.nBm >= 40) {          // 樣本太少時 beta／alpha 雜訊很大，不下判斷
    if (k.beta > 1.3)
      out.push({ tone: 'warn', text: `beta ${k.beta.toFixed(2)}：帳戶大約是大盤的 ${k.beta.toFixed(1)} 倍槓桿。贏大盤要看扣掉槓桿後的 alpha（年化 ${p1(k.alpha)}），不是只看報酬。` });
    else if (Math.abs(k.beta) < 0.3)
      out.push({ tone: 'info', text: `beta ${k.beta.toFixed(2)}、相關係數 ${(k.corr ?? 0).toFixed(2)}：帳戶走勢和大盤關係很低，報酬主要來自策略本身（適合跟股票部位搭配分散）。` });
    else
      out.push({ tone: 'info', text: `beta ${k.beta.toFixed(2)}、年化 alpha ${p1(k.alpha)}：扣掉跟著大盤的部分後${k.alpha >= 0 ? '仍有超額' : '沒有超額'}。` });
  }
  if (k.upCap !== null && k.downCap !== null && k.downCap > k.upCap && k.downCap > 0)
    out.push({ tone: 'warn', text: `下跌捕獲 ${k.downCap.toFixed(2)} 大於上漲捕獲 ${k.upCap.toFixed(2)}：大盤跌的日子跟得比漲的日子多，要檢查是否部位方向偏多又沒有停損。` });
  if (k.sharpe !== null && k.sharpeBm !== null)
    out.push(k.sharpe >= k.sharpeBm
      ? { tone: 'good', text: `風險調整後也贏：Sharpe ${k.sharpe.toFixed(2)} vs 大盤 ${k.sharpeBm.toFixed(2)}（每單位波動賺得比較多）。` }
      : { tone: 'warn', text: `風險調整後輸：Sharpe ${k.sharpe.toFixed(2)} vs 大盤 ${k.sharpeBm.toFixed(2)}，報酬是用較大的波動換來的。` });
  if (k.mddBm !== null && k.mddPct < k.mddBm * 1.5 && k.mddPct < -0.05)
    out.push({ tone: 'warn', text: `最大回撤 ${p1(k.mddPct)}，比大盤同期 ${p1(k.mddBm)} 深很多；依「不用更大回撤換報酬」的原則，要看報酬是否等比例變高。` });
  if (k.top3Share !== null && k.top3Share > 0.6)
    out.push({ tone: 'info', text: `獲利最多的 3 天佔總損益 ${(k.top3Share * 100).toFixed(0)}%：績效集中在少數日子，錯過這幾天結果會差很多 → 程式單要穩定在場，避免手動停機。` });
  if (k.ddDays >= 20)
    out.push({ tone: 'warn', text: `目前已連續 ${k.ddDays} 個交易日沒創新高（回撤 ${Math.round(k.ddNow).toLocaleString('zh-TW')} 元），可對照 QB 回測的平均回撤期間，判斷是否超出正常範圍。` });
  return out;
}
