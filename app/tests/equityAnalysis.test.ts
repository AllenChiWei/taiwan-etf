import test from 'node:test';
import assert from 'node:assert/strict';
import { curve, days, notes, periods, risk, sliceYear, years, type BmRow } from '../src/lib/equityAnalysis.ts';

const row = (d: string, tv: number, pnl: number, flow: number, tri: number | null): BmRow =>
  ({ d, tv, flow, pnl, cum: 0, dd: 0, twr: 0, upl: 0, cpl: 0, fee: 0, margin: 0, risk: 0, oi: 0, taiex: 0, tri, px: tri });

// 基準日 → 賺 10%、入金 100 後賠 5%、跨年再賺 2%；大盤 +5%、0%、+1%
const R = [
  row('2025-12-30', 1000, 0, 0, 100),
  row('2025-12-31', 1100, 100, 0, 105),
  row('2026-01-02', 1145, -55, 100, 105),
  row('2026-01-05', 1167.9, 22.9, 0, null),     // 大盤還沒公布
];

test('實盤分析：每日報酬用昨天權益，出入金不算報酬；大盤缺值為 null', () => {
  const ds = days(R);
  assert.equal(ds.length, 3);
  assert.ok(Math.abs(ds[0].ret - 0.1) < 1e-12);
  assert.ok(Math.abs(ds[1].ret - -0.05) < 1e-12);     // −55 ÷ 1100
  assert.equal(ds[2].bm, null);
  assert.ok(Math.abs((ds[0].bmPnl ?? 0) - 50) < 1e-9); // 1000 × 5%
});

test('實盤分析：每年從前一年最後一天起算', () => {
  assert.deepEqual(years(R), ['2025', '2026']);
  const y = sliceYear(R, '2026');
  assert.equal(y[0].d, '2025-12-31');
  assert.equal(y.length, 3);
  assert.equal(sliceYear(R, '2024').length, 0);
});

test('實盤分析：期間彙總與超額只比大盤有資料的日子', () => {
  const ys = periods(days(R), 'Y');
  assert.equal(ys.length, 2);
  const y26 = ys[1];
  assert.equal(y26.flow, 100);
  assert.ok(Math.abs(y26.pnl - -32.1) < 1e-9);
  assert.equal(y26.bmPartial, true);
  assert.ok(Math.abs((y26.excess ?? 0) - -0.05) < 1e-12);   // 只比 1/2：帳戶 −5%、大盤 0%
  assert.ok(y26.mddPct < 0);
});

test('實盤分析：累積曲線從 0 起算、回撤不為正', () => {
  const c = curve(R);
  assert.equal(c[0].acc, 0);
  assert.ok(Math.abs(c[1].acc - 0.1) < 1e-12);
  assert.ok(Math.abs((c[1].bm ?? 0) - 0.05) < 1e-12);
  assert.ok(c.every(p => p.accDd <= 0));
});

test('實盤分析：風險指標與自動觀察', () => {
  const k = risk(R)!;
  assert.equal(k.n, 3);
  assert.equal(k.nBm, 2);
  assert.equal(k.ann, null);                         // 樣本 < 60 天不給年化
  assert.equal(k.best?.d, '2025-12-31');
  assert.equal(k.worst?.d, '2026-01-02');
  assert.ok(Math.abs(k.mddMoney - -55) < 1e-9);
  assert.ok(notes(k).some(n => n.text.includes('樣本只有')));
  assert.equal(risk([R[0]]), null);
});

import { withNav } from '../src/lib/equityAnalysis.ts';

test('實盤分析：淨值＝權益總值 − 累計出入金，切年份後仍從第一天累計', () => {
  const n = withNav(R);
  assert.deepEqual(n.map(r => r.nav), [1000, 1100, 1045, 1067.9]);   // 01-02 入金 100 不算
  const y = sliceYear(n, '2026');
  assert.equal(y[1].nav, 1045);
  const p = periods(days(y), 'Y')[0];
  assert.equal(p.startNav, 1100);
  assert.ok(Math.abs(p.endNav - 1067.9) < 1e-9);
});

import { monthCurve, pickTickIndices, MIN_ANNUAL_DAYS } from '../src/lib/equityAnalysis.ts';
import { allYears, demoRows } from '../src/lib/equityYear.ts';

test('實盤分析：年度績效分析與選單一年時的 risk() 完全一致，且保留未滿門檻年份', () => {
  const demo = withNav(demoRows());
  const reps = allYears(demo);
  assert.deepEqual(reps.map(r => r.year), ['2026', '2025']);
  for (const r of reps) {
    const k = risk(sliceYear(demo, r.year))!;
    assert.equal(r.k.ret, k.ret);
    assert.equal(r.k.bm, k.bm);
    assert.equal(r.k.excess, k.excess);
    assert.equal(r.k.mddPct, k.mddPct);
    assert.equal(r.k.mddBm, k.mddBm);
    assert.equal(r.k.sharpe, k.sharpe);
    assert.equal(r.k.beatDays, k.beatDays);
    assert.equal(r.k.n, k.n);
    const expectedMar = k.mddPct < 0 ? k.ret / -k.mddPct : null;
    assert.equal(r.mar, expectedMar);
  }

  const shortAll = withNav(R);
  const shortReps = allYears(shortAll);
  assert.deepEqual(shortReps.map(r => r.year), ['2026', '2025']);
  for (const r of shortReps) {
    assert.ok(r.k.n < MIN_ANNUAL_DAYS);
    const k = risk(sliceYear(shortAll, r.year))!;
    assert.equal(r.k.ret, k.ret);
    assert.equal(r.k.bm, k.bm);
    assert.equal(r.k.excess, k.excess);
    assert.equal(r.k.mddPct, k.mddPct);
    assert.equal(r.k.mddBm, k.mddBm);
    assert.equal(r.k.sharpe, k.sharpe);
    assert.equal(r.k.beatDays, k.beatDays);
    assert.equal(r.k.n, k.n);
  }
});

test('實盤分析：月報酬折線圖資料轉換（含大盤缺值月與年份篩選）', () => {
  const M: BmRow[] = [
    row('2025-11-28', 1000, 0, 0, 100),
    row('2025-12-15', 1100, 100, 0, 105),
    row('2026-01-15', 1045, -55, 0, null),
    row('2026-02-10', 1045, 0, 0, 100),
    row('2026-02-20', 1149.5, 104.5, 0, 102),
  ];
  const ps = periods(days(M), 'M');
  const pts = monthCurve(ps);
  assert.deepEqual(pts.map(p => p.m), ['2025-12', '2026-01', '2026-02']);
  assert.ok(Math.abs(pts[0].acc - 0.1) < 1e-12);
  assert.ok(Math.abs((pts[0].bm ?? 0) - 0.05) < 1e-12);
  assert.ok(Math.abs((pts[0].diff ?? 0) - 0.05) < 1e-12);
  assert.ok(Math.abs(pts[1].acc - -0.05) < 1e-12);
  assert.equal(pts[1].bm, null);
  assert.equal(pts[1].diff, null);
  assert.ok(Math.abs(pts[2].acc - 0.1) < 1e-12);
  assert.ok(Math.abs((pts[2].bm ?? 0) - 0.02) < 1e-12);
  assert.ok(Math.abs((pts[2].diff ?? 0) - 0.08) < 1e-12);
  assert.deepEqual(monthCurve([...ps].reverse()), pts);
  const pts26 = monthCurve(periods(days(sliceYear(M, '2026')), 'M'));
  assert.deepEqual(pts26.map(p => p.m), ['2026-01', '2026-02']);
});

test('實盤分析：月報酬 x 軸標籤抽稀（少月全顯、多月不超標且含頭尾）', () => {
  assert.deepEqual(pickTickIndices(0), []);
  assert.deepEqual(pickTickIndices(1), [0]);
  assert.deepEqual(pickTickIndices(4), [0, 1, 2, 3]);
  assert.deepEqual(pickTickIndices(6), [0, 1, 2, 3, 4, 5]);
  for (const len of [7, 12, 24, 37, 60]) {
    const idx = pickTickIndices(len);
    assert.ok(idx.length <= 6);
    assert.equal(idx[0], 0);
    assert.equal(idx[idx.length - 1], len - 1);
    for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1]);
  }
});
