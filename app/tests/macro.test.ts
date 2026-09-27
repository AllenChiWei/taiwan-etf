/* 總經指標的換算。數字取自 2026-09-27 抓下來的 FRED 數列，
   手算對得上才算數 —— CPI 年增率錯月份時畫面看起來仍然很合理。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  yoy, diff, movingAvg, spread, lastYears, thinWeekly, latest, yearAgo,
  buildIndicators, curveInverted, type Point, type MacroData,
} from '../src/lib/macro.ts';

const P = (d: string, v: number): Point => ({ d, v });

test('CPI 年增率：同月對去年同月（2026-08：334.131 / 323.291 − 1 = 3.35%）', () => {
  const out = yoy([P('2025-08-01', 323.291), P('2025-09-01', 324.0), P('2026-08-01', 334.131)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].d, '2026-08-01');
  assert.ok(Math.abs(out[0].v - 3.3530) < 1e-3);
});

test('年增率不是往前數 12 筆：中間缺一個月也對到正確的月份', () => {
  const pts = [P('2025-01-01', 100), P('2025-02-01', 200)];
  // 2025-03 到 2026-01 全缺，2026-02 仍要對到 2025-02 而不是 2025-01
  pts.push(P('2026-02-01', 210));
  assert.deepEqual(yoy(pts).map(p => Math.round(p.v * 100) / 100), [5]);
});

test('非農月增：159,075 − 158,913 = 162 千人', () => {
  const out = diff([P('2026-07-01', 158913), P('2026-08-01', 159075)]);
  assert.deepEqual(out, [P('2026-08-01', 162)]);
});

test('4 週平均：前三週不輸出', () => {
  const out = movingAvg([P('a', 1), P('b', 2), P('c', 3), P('d', 4), P('e', 5)], 4);
  assert.deepEqual(out, [P('d', 2.5), P('e', 3.5)]);
});

test('利差只取兩邊都有的日期（10Y 5.18 − 2Y 4.87 = 0.31）', () => {
  const out = spread([P('2026-09-23', 5.2), P('2026-09-24', 5.18)],
                     [P('2026-09-24', 4.87), P('2026-09-25', 4.9)]);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].v - 0.31) < 1e-9);
});

test('lastYears 以最後一筆往回算，含邊界那天', () => {
  const pts = [P('2020-09-24', 1), P('2021-09-24', 2), P('2021-09-25', 3), P('2026-09-24', 4)];
  assert.deepEqual(lastYears(pts, 5).map(p => p.v), [2, 3, 4]);
});

test('thinWeekly：每週留最後一個交易日，少於 600 點不動', () => {
  const few = [P('2026-09-21', 1), P('2026-09-22', 2)];
  assert.equal(thinWeekly(few), few);
  const many: Point[] = [];
  const start = Date.UTC(2020, 0, 6);                      // 星期一
  for (let i = 0; i < 1000; i++) {
    const d = new Date(start + i * 86_400_000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    many.push(P(d.toISOString().slice(0, 10), i));
  }
  const out = thinWeekly(many);
  assert.equal(out[0].d, '2020-01-10');                    // 第一週的星期五
  assert.ok(out.every(p => new Date(`${p.d}T00:00:00Z`).getUTCDay() === 5
    || p === out[out.length - 1]));
});

test('latest 與 yearAgo', () => {
  const pts = [P('2025-09-20', 1), P('2025-09-26', 2), P('2026-09-24', 3), P('2026-09-25', 5)];
  assert.deepEqual(latest(pts), { last: P('2026-09-25', 5), prev: P('2026-09-24', 3), delta: 2 });
  assert.deepEqual(yearAgo(pts), P('2025-09-20', 1));
  assert.equal(latest([]), null);
});

test('缺了的數列不會變成空卡；倒掛判斷', () => {
  const data: MacroData = {
    meta: { updated: '2026-09-27', source: '', errors: [] },
    series: {
      unrate: { id: 'UNRATE', label: '失業率', unit: '%', freq: 'M', src: 'BLS',
        d: ['2026-07-01', '2026-08-01'], v: [4.2, 4.1] },
    },
    curve: { tenors: ['3M', '10Y'], dates: { now: '2026-09-24', m1: null, y1: null },
      now: [4.24, 5.18], m1: [null, null], y1: [null, null] },
  };
  assert.deepEqual(buildIndicators(data).map(i => i.key), ['unrate']);
  assert.equal(curveInverted(data.curve), false);
  assert.equal(curveInverted({ ...data.curve!, now: [5.3, 4.9] }), true);
  assert.equal(curveInverted(null), null);
});
