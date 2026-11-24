/* 實盤年度績效分析（#/EQY，私人頁；2026-11-24 使用者：「每年年底結算要看這份分析」）。純函式，測試在 tests/equityYear.test.ts。
 * 沿用 equityAnalysis 的口徑：rows 要先 withNav（淨值從第一天起算），某一年＝前一年最後一天當基準、從 0 重新算。
 * 推算期間（est，用元大歷史平倉損益往回推）沒有稅費、平倉損益欄（匯出端填 0），稅費只算有每日記錄的日子。 */

import { days, notes, periods, risk, sliceYear, years, type BmRow, type Day, type Note, type Period, type Risk } from './equityAnalysis.ts';

/** 一段回撤（以帳戶時間加權報酬計）：start＝前高那天、trough＝最低那天、end＝回到前高那天（null＝年底還沒回來） */
export interface Drawdown { start: string; trough: string; end: string | null; depth: number; money: number; fall: number; recover: number | null }

export function drawdowns(ds: Day[], base: string, top = 3): Drawdown[] {
  const out: Drawdown[] = [];
  let eq = 1, peak = 1, peakDate = base, peakI = -1;
  let cur: { trough: string; depth: number; troughI: number; money: number; minMoney: number } | null = null;
  for (let i = 0; i < ds.length; i++) {
    const x = ds[i];
    eq *= 1 + x.ret;
    if (eq >= peak - 1e-12) {
      if (cur) out.push({ start: peakDate, trough: cur.trough, end: x.d, depth: cur.depth, money: cur.minMoney, fall: cur.troughI - peakI, recover: i - cur.troughI });
      cur = null; peak = eq; peakDate = x.d; peakI = i;
      continue;
    }
    if (!cur) cur = { trough: x.d, depth: 0, troughI: i, money: 0, minMoney: 0 };
    cur.money += x.pnl;
    const dd = eq / peak - 1;
    if (dd < cur.depth) { cur.depth = dd; cur.trough = x.d; cur.troughI = i; }
    cur.minMoney = Math.min(cur.minMoney, cur.money);
  }
  if (cur) out.push({ start: peakDate, trough: cur.trough, end: null, depth: cur.depth, money: cur.minMoney, fall: cur.troughI - peakI, recover: null });
  return out.sort((a, b) => a.depth - b.depth).slice(0, top);
}

/** 最長連續賺錢／賠錢的交易日（看損益金額；0 元的日子中斷連續） */
export interface Streak { len: number; from: string; to: string; pnl: number }

export function streaks(ds: Day[]): { win: Streak | null; loss: Streak | null } {
  let win: Streak | null = null, loss: Streak | null = null;
  let run: Streak | null = null, sign = 0;
  for (const x of ds) {
    const s = Math.sign(x.pnl);
    if (s !== 0 && s === sign && run) { run.len++; run.to = x.d; run.pnl += x.pnl; }
    else { run = s === 0 ? null : { len: 1, from: x.d, to: x.d, pnl: x.pnl }; sign = s; }
    if (run && sign > 0 && (!win || run.len > win.len)) win = { ...run };
    if (run && sign < 0 && (!loss || run.len > loss.len)) loss = { ...run };
  }
  return { win, loss };
}

export interface YearReport {
  year: string; from: string; to: string;
  partial: boolean;                 // 還沒過完的一年（最後一天早於 12/28）
  estDays: number;                  // 推算的交易日數
  k: Risk; p: Period; ds: Day[]; months: Period[];
  mar: number | null;               // 年度報酬 ÷ |最大回撤|
  fee: number; feeDays: number; cpl: number;
  feeShare: number | null;          // 稅費 ÷（損益＋稅費）＝ 稅費吃掉多少毛利
  upMonths: number; bestMonth: Period | null; worstMonth: Period | null;
  dds: Drawdown[]; win: Streak | null; loss: Streak | null;
}

export function yearReport(all: BmRow[], year: string): YearReport | null {
  const rows = sliceYear(all, year);
  const k = risk(rows);
  if (!k || rows.length < 2) return null;
  const ds = days(rows);
  const p = periods(ds, 'Y')[0];
  const months = periods(ds, 'M');
  const real = rows.slice(1).filter(r => !r.est);
  const fee = real.reduce((a, r) => a + (r.fee || 0), 0);
  const ranked = [...months].sort((a, b) => b.ret - a.ret);
  const { win, loss } = streaks(ds);
  return {
    year, from: ds[0].d, to: ds[ds.length - 1].d,
    partial: ds[ds.length - 1].d < `${year}-12-28`,
    estDays: ds.filter(x => x.est).length,
    k, p, ds, months,
    mar: k.mddPct < 0 ? k.ret / -k.mddPct : null,
    fee, feeDays: real.length, cpl: real.reduce((a, r) => a + (r.cpl || 0), 0),
    feeShare: fee > 0 && k.pnl + fee > 0 ? fee / (k.pnl + fee) : null,
    upMonths: months.filter(m => m.pnl > 0).length,
    bestMonth: ranked[0] ?? null, worstMonth: ranked[ranked.length - 1] ?? null,
    dds: drawdowns(ds, rows[0].d), win, loss,
  };
}

/** 每一年都算一份（新的在前） */
export function allYears(all: BmRow[]): YearReport[] {
  return years(all).map(y => yearReport(all, y)).filter((r): r is YearReport => r !== null).reverse();
}

/** 月報酬熱度表：{ 年: [1～12 月報酬或 null] } */
export function monthGrid(reps: YearReport[]): { year: string; m: (number | null)[]; total: number }[] {
  return reps.map(r => {
    const m: (number | null)[] = Array(12).fill(null);
    for (const x of r.months) m[Number(x.key.slice(5, 7)) - 1] = x.ret;
    return { year: r.year, m, total: r.k.ret };
  });
}

const p1 = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;

/** 年度觀察：equityAnalysis.notes 的通用判斷＋年度專屬（和去年比、稅費、推算資料、未滿一年） */
export function yearNotes(r: YearReport, prev: YearReport | null): Note[] {
  const out: Note[] = [];
  if (r.partial)
    out.push({ tone: 'info', text: `${r.year} 年還沒結束（資料到 ${r.to}），以下是年初至今的數字；年底結算請在最後一個交易日收盤、權益更新後再看。` });
  if (r.estDays > 0)
    out.push({ tone: 'info', text: `有 ${r.estDays} 個交易日是用歷史平倉損益往回推算（抱單期間的漲跌看不到、出入金不知道），報酬率與回撤是近似值；稅費只算有每日記錄的 ${r.feeDays} 天。` });
  out.push(...notes(r.k));
  if (prev && r.mar !== null && prev.mar !== null) {
    const better = r.mar >= prev.mar;
    out.push({ tone: better ? 'good' : 'warn', text: `報酬 ÷ 最大回撤 ${r.mar.toFixed(2)}，${prev.year} 年 ${prev.mar.toFixed(2)}：${better ? '風險調整後比去年好' : '比去年差'}（報酬 ${p1(r.k.ret)} vs ${p1(prev.k.ret)}、最大回撤 ${p1(r.k.mddPct)} vs ${p1(prev.k.mddPct)}）。` });
  }
  if (r.feeShare !== null && r.feeShare > 0.2)
    out.push({ tone: 'warn', text: `稅費 ${Math.round(r.fee).toLocaleString('zh-TW')} 元，吃掉毛利的 ${(r.feeShare * 100).toFixed(0)}%：交易成本偏高，可檢查換手是否過多。` });
  if (r.months.length >= 6 && r.upMonths / r.months.length < 0.5)
    out.push({ tone: 'warn', text: `賺錢的月份 ${r.upMonths}／${r.months.length}，不到一半：績效靠少數好月份撐起來，要有連續幾個月不賺的心理準備。` });
  return out;
}

/** 驗證用的假資料（localStorage twetf.eqDemo=1；不含任何真實權益）：2024-12-31 起兩年、固定種子 */
export function demoRows(): BmRow[] {
  let s = 20261124;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const out: BmRow[] = [];
  let tv = 3_000_000, tri = 40000, px = 22000;
  const d = new Date(Date.UTC(2024, 11, 31));
  const end = Date.UTC(2026, 10, 21);
  out.push({ d: '2024-12-31', tv, flow: 0, pnl: 0, cum: 0, dd: 0, twr: 0, upl: 0, cpl: 0, fee: 0, margin: 0, risk: 0, oi: 0, taiex: 0, tri, px, est: 1 });
  while (d.getTime() < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const ds = d.toISOString().slice(0, 10);
    const bm = (rnd() - 0.48) * 0.024;
    const ret = 0.4 * bm + (rnd() - 0.46) * 0.03;
    const est = ds < '2026-09-12';
    const flow = ds === '2026-03-02' ? 500_000 : ds === '2026-08-03' ? -300_000 : 0;
    const pnl = Math.round(tv * ret);
    tv += pnl + flow; tri *= 1 + bm; px *= 1 + bm * 0.97;
    out.push({ d: ds, tv, flow, pnl, cum: 0, dd: 0, twr: 0, upl: 0, cpl: est ? 0 : pnl, fee: est ? 0 : Math.round(300 + rnd() * 1500),
               margin: 0, risk: 0, oi: Math.round(rnd() * 6), taiex: 0, tri, px, ...(est ? { est: 1 } : {}) });
  }
  return out;
}
