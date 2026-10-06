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
