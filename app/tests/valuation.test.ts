/* 個股估值：反推 EPS、百分位、河流的月底取樣、營收推估、金融與虧損改看淨值比。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  joinValuation, lastYears, percentile, rankPct, stats, zone, river, revenueEstimate, implied, defaultKey,
  type PerRow, type PriceRow,
} from '../src/lib/valuation.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('台積電 2026-10-30：收盤 ÷ 本益比反推近四季 EPS，跟交易所口徑一致', () => {
  const per: PerRow[] = [{ date: '2026-10-30', PER: 27.47, PBR: 9.55, dividend_yield: 0.93 }];
  const price: PriceRow[] = [{ date: '2026-10-30', close: 2370 }];
  const [p] = joinValuation(per, price);
  near(p.eps!, 86.276, 1e-3);
  near(p.bps!, 248.17, 1e-2);
});

test('本益比 0（近四季虧損）當成沒有，不是 0 倍；缺收盤價的那天丟掉', () => {
  const per: PerRow[] = [
    { date: '2026-01-02', PER: 0, PBR: 1.2, dividend_yield: 0 },
    { date: '2026-01-03', PER: 10, PBR: 1.3, dividend_yield: 2 },
  ];
  const pts = joinValuation(per, [{ date: '2026-01-02', close: 50 }]);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].per, null);
  assert.equal(pts[0].eps, null);
  near(pts[0].bps!, 50 / 1.2);
});

test('百分位：線性內插、目前值的位置（相等算一半）', () => {
  near(percentile([1, 2, 3, 4, 5], 50), 3);
  near(percentile([10, 20], 25), 12.5);
  near(rankPct([1, 2, 3, 4], 3)!, 62.5);
  assert.equal(rankPct([], 1), null);
  assert.equal(zone(10).tone, 'low');
  assert.equal(zone(50).tone, 'mid');
  assert.equal(zone(90).tone, 'high');
});

/** 2021-01-01 起每天一筆：本益比在 10～20 之間來回，EPS 每年 +1。 */
function series(days = 5 * 365) {
  const per: PerRow[] = []; const price: PriceRow[] = [];
  const d0 = Date.UTC(2021, 0, 1);
  for (let i = 0; i < days; i++) {
    const date = new Date(d0 + i * 86_400_000).toISOString().slice(0, 10);
    const pe = 15 + 5 * Math.sin(i / 30);
    const eps = 5 + Math.floor(i / 365);
    per.push({ date, PER: pe, PBR: 2, dividend_yield: 3 });
    price.push({ date, close: pe * eps });
  }
  return joinValuation(per, price);
}

test('近 N 年從最後一天往回算；歷史太短不給百分位', () => {
  const pts = series();
  const last = pts[pts.length - 1].date;
  const h = lastYears(pts, 3);
  assert.ok(h[0].date > `${Number(last.slice(0, 4)) - 3}${last.slice(4)}`);
  assert.equal(stats(pts.slice(0, 50), 'per').bands, null);
  const s = stats(pts, 'per');
  assert.equal(s.bands!.length, 5);
  assert.ok(s.bands![0] > 10 && s.bands![4] < 20 && s.bands![0] < s.bands![4]);
});

test('河流每月一點（月底），最後一天一定在；河流 = 當時 EPS × 倍數', () => {
  const pts = series(400);
  const r = river(pts, 'per', [10, 20]);
  const months = new Set(pts.map(p => p.date.slice(0, 7)));
  assert.equal(r.length, months.size);
  assert.equal(r[r.length - 1].date, pts[pts.length - 1].date);
  const lastPt = pts[pts.length - 1];
  near(r[r.length - 1].bands[0]!, lastPt.eps! * 10, 1e-6);
});

test('營收推估：近 3 個月合計 ÷ 去年同期（由年增率反推）', () => {
  const months = [
    { p: '2026-06', rev: 100, yoy: 0 },
    { p: '2026-08', rev: 150, yoy: 50 },     // 去年 100
    { p: '2026-07', rev: 120, yoy: 20 },     // 去年 100（順序亂也要排好）
    { p: '2026-09', rev: 200, yoy: 100 },    // 去年 100
  ];
  const e = revenueEstimate(months, 10)!;
  assert.deepEqual(e.months, ['2026-07', '2026-08', '2026-09']);
  near(e.growth, 56.6666667, 1e-6);          // 470 / 300 − 1
  near(e.eps, 10 * 470 / 300);
  assert.equal(revenueEstimate(months, -1), null, '虧損不推');
  assert.equal(revenueEstimate([], 10), null);
  assert.equal(revenueEstimate([{ p: '2026-09', rev: 100, yoy: null }], 10), null);
});

test('自己的 EPS：預估本益比與各百分位價格', () => {
  const pts = series();
  const s = stats(pts, 'per');
  const r = implied(300, 20, pts, 'per', s)!;
  near(r.multiple, 15);
  near(r.prices[2], 20 * s.bands![2]);
  assert.equal(implied(300, 0, pts, 'per', s), null);
});

test('金融股、目前虧損預設看淨值比', () => {
  const latest = { date: 'x', close: 10, per: null, pbr: 1, yld: null, eps: null, bps: 10 };
  assert.equal(defaultKey('金融保險業', undefined), 'pbr');
  assert.equal(defaultKey('半導體業', latest), 'pbr');
  assert.equal(defaultKey('半導體業', { ...latest, per: 12, eps: 1 }), 'per');
});
