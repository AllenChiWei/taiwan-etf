import test from 'node:test';
import assert from 'node:assert/strict';
import { days, withNav, type BmRow } from '../src/lib/equityAnalysis.ts';
import { allYears, demoRows, drawdowns, monthGrid, streaks, yearNotes, yearReport } from '../src/lib/equityYear.ts';

const row = (d: string, tv: number, pnl: number, flow = 0, fee = 0, est = false): BmRow =>
  ({ d, tv, flow, pnl, cum: 0, dd: 0, twr: 0, upl: 0, cpl: pnl, fee, margin: 0, risk: 0, oi: 0, taiex: 0, tri: 100, px: 100, ...(est ? { est: 1 } : {}) });

// 2025：+10%、−20%（回撤）、+25%（回到前高）；2026：入金後 +5%、−2%（到年中，未滿一年）
const R = withNav([
  row('2024-12-31', 1000, 0),
  row('2025-03-03', 1100, 100, 0, 0, true),
  row('2025-06-02', 880, -220, 0, 10),
  row('2025-12-30', 1100, 220, 0, 20),
  row('2026-01-05', 1655, 55, 500, 5),
  row('2026-06-01', 1621.9, -33.1, 0, 3),
]);

test('年度：每年從前一年最後一天起算，報酬、損益、稅費（推算日不算）', () => {
  const y = yearReport(R, '2025')!;
  assert.equal(y.from, '2025-03-03');
  assert.equal(y.to, '2025-12-30');
  assert.ok(Math.abs(y.k.ret - 0.1) < 1e-12);          // 1.1 × 0.8 × 1.25 − 1
  assert.equal(y.k.pnl, 100);
  assert.equal(y.estDays, 1);
  assert.equal(y.fee, 30);
  assert.equal(y.feeDays, 2);
  assert.equal(y.partial, false);
  assert.ok(Math.abs((y.mar ?? 0) - 0.5) < 1e-12);     // 10% ÷ 20%
});

test('年度：未滿一年、出入金不算報酬', () => {
  const y = yearReport(R, '2026')!;
  assert.equal(y.partial, true);
  assert.equal(y.p.flow, 500);
  assert.ok(Math.abs(y.k.ret - (1.05 * 0.98 - 1)) < 1e-12);
  assert.equal(yearReport(R, '2024'), null);
});

test('年度：回撤段落有前高、谷底、回到前高的日子', () => {
  const ds = days(R.slice(0, 4));
  const [d] = drawdowns(ds, '2024-12-31');
  assert.equal(d.start, '2025-03-03');
  assert.equal(d.trough, '2025-06-02');
  assert.equal(d.end, '2025-12-30');
  assert.ok(Math.abs(d.depth - -0.2) < 1e-12);
  assert.equal(d.money, -220);
  assert.equal(d.fall, 1);
  assert.equal(d.recover, 1);
  const open = drawdowns(days(R.slice(0, 3)), '2024-12-31');
  assert.equal(open[0].end, null);
});

test('年度：最長連續賺／賠', () => {
  const s = streaks(days(withNav([row('2025-01-01', 100, 0), row('2025-01-02', 101, 1), row('2025-01-03', 102, 1), row('2025-01-06', 101, -1), row('2025-01-07', 103, 2)])));
  assert.equal(s.win?.len, 2);
  assert.equal(s.win?.from, '2025-01-02');
  assert.equal(s.loss?.len, 1);
});

test('年度：全部年份新的在前、月報酬表、觀察', () => {
  const reps = allYears(R);
  assert.deepEqual(reps.map(r => r.year), ['2026', '2025']);
  const g = monthGrid(reps);
  assert.equal(g[1].m[2] !== null, true);                // 2025-03 有值
  assert.equal(g[1].m[0], null);                         // 2025-01 沒有交易日
  const ns = yearNotes(reps[0], reps[1]).map(n => n.text).join('\n');
  assert.match(ns, /還沒結束/);
  assert.match(yearNotes(reps[1], null).map(n => n.text).join('\n'), /往回推算/);
});

test('年度：示範資料可以完整算出兩年', () => {
  const reps = allYears(withNav(demoRows()));
  assert.deepEqual(reps.map(r => r.year), ['2026', '2025']);
  assert.equal(reps[1].months.length, 12);
  assert.ok(reps[0].fee > 0);
});
