/* 績效曲線對齊的測試。重點是使用者要的那條規則：
   多檔比較時，起點必須是「最晚上市那檔」的上市日。 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  alignSeries, firstDate, toDateMap, extent, periodStart,
  type SeriesInput,
} from '../src/lib/series.ts';

/** 造一條假序列。cal 是市場日曆，first 是起始索引。 */
const mk = (
  code: string, cal: string[], first: number, values: Array<number | null>,
  market: 'tw' | 'us' = 'tw',
): SeriesInput => ({ code, label: code, market, raw: { code, first, values }, calendar: cal });

const CAL = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];

/** 浮點數比較。價格相除幾乎不可能得到剛好的整數（55/50*100 = 110.00000000000001）。 */
const near = (actual: number | null, expected: number, tol = 1e-6) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < tol,
            `期望 ${expected}，實際 ${actual}`);

describe('攤平與起始日', () => {
  test('toDateMap 對齊日曆並跳過缺值', () => {
    const m = toDateMap(mk('A', CAL, 1, [10, null, 12]));
    assert.deepEqual([...m.entries()], [['2024-01-02', 10], ['2024-01-04', 12]]);
  });

  test('firstDate 回傳第一個有值的日期', () => {
    assert.equal(firstDate(mk('A', CAL, 1, [null, 11, 12])), '2024-01-03');
    assert.equal(firstDate(mk('A', CAL, 0, [null, null])), null);
  });
});

describe('多檔對齊（核心規則）', () => {
  test('起點是最晚上市那檔的上市日', () => {
    const early = mk('EARLY', CAL, 0, [100, 110, 120, 130, 140]);
    const late = mk('LATE', CAL, 3, [50, 55]);          // 2024-01-04 才上市
    const r = alignSeries([early, late]);
    assert.equal(r.startDate, '2024-01-04');
    assert.deepEqual(r.dates, ['2024-01-04', '2024-01-05']);
  });

  test('兩檔都從 100 起算，之後才是真正的績效差', () => {
    const early = mk('EARLY', CAL, 0, [100, 110, 120, 130, 140]);
    const late = mk('LATE', CAL, 3, [50, 55]);
    const r = alignSeries([early, late]);
    for (const s of r.series) near(s.points[0], 100);

    const e = r.series.find(s => s.code === 'EARLY')!;
    const l = r.series.find(s => s.code === 'LATE')!;
    // EARLY 從 130 到 140 = +7.69%；LATE 從 50 到 55 = +10%
    near(e.points[1], 107.6923, 1e-3);
    near(l.points[1], 110);
    near(e.totalReturn, 7.6923, 1e-3);
    near(l.totalReturn, 10);
  });

  test('單檔時起點就是它自己的上市日', () => {
    const r = alignSeries([mk('A', CAL, 2, [10, 11, 12])]);
    assert.equal(r.startDate, '2024-01-03');
    near(r.series[0].points[0], 100);
  });

  test('使用者選的期間比上市日晚時，以期間為準', () => {
    const a = mk('A', CAL, 0, [100, 101, 102, 103, 104]);
    const r = alignSeries([a], '2024-01-04');
    assert.equal(r.startDate, '2024-01-04');
    assert.deepEqual(r.dates, ['2024-01-04', '2024-01-05']);
    near(r.series[0].points[0], 100);
  });

  test('使用者選的期間比上市日早時，仍以上市日為準（不能比較不存在的期間）', () => {
    const late = mk('LATE', CAL, 3, [50, 55]);
    const r = alignSeries([late], '2020-01-01');
    assert.equal(r.startDate, '2024-01-04');
  });

  test('資料過短的標的被排除而不是讓整張圖壞掉', () => {
    const good = mk('GOOD', CAL, 0, [100, 101, 102, 103, 104]);
    const bad = mk('BAD', CAL, 4, [10]);               // 只有一個點
    const r = alignSeries([good, bad]);
    assert.deepEqual(r.dropped, ['BAD']);
    assert.equal(r.series.length, 1);
  });

  test('全部都不可用時安全回傳空結果', () => {
    const r = alignSeries([mk('X', CAL, 0, [null, null])]);
    assert.equal(r.series.length, 0);
    assert.equal(r.startDate, null);
    assert.deepEqual(r.dropped, ['X']);
  });
});

describe('跨市場：交易日曆不同', () => {
  const TW = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'];
  const US = ['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];

  test('橫軸取聯集，缺的那天用前值補齊', () => {
    const tw = mk('0050', TW, 0, [100, 100, 110, 110], 'tw');
    const us = mk('SPY', US, 0, [200, 220, 220, 240], 'us');
    const r = alignSeries([tw, us]);
    // 兩邊最早共同起點 = 2024-01-02（美股日曆從這天開始）
    assert.equal(r.startDate, '2024-01-02');
    assert.deepEqual(r.dates, ['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05']);

    const t = r.series.find(s => s.code === '0050')!;
    // 台股 1/5 沒開盤，沿用 1/4 的值，所以最後一點與前一點相同
    assert.equal(t.points[3], t.points[2]);
    near(t.points[0], 100);
  });
});

describe('輔助函式', () => {
  test('extent 含留白且處理全空', () => {
    const [lo, hi] = extent([{ code: 'A', label: 'A', market: 'tw', points: [100, 120], totalReturn: 20 }]);
    assert.ok(lo < 100 && hi > 120);
    const [l2, h2] = extent([]);
    assert.ok(Number.isFinite(l2) && Number.isFinite(h2));
  });

  test('periodStart 換算期間', () => {
    assert.equal(periodStart('1y', '2026-09-11'), '2025-09-11');
    assert.equal(periodStart('3m', '2026-09-11'), '2026-06-11');
    assert.equal(periodStart('max', '2026-09-11'), null);
  });
});
