/* 期貨對帳單 × 市場環境交叉復盤測試：
 * 驗證大盤維持率、結算日、高波動日、星期幾四個維度的日期對齊、策略拆解、小樣本標示與缺檔容錯。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Trade, Strategy } from '../src/lib/futures.ts';
import type { ChipsData } from '../src/lib/chips.ts';
import type { AtmData } from '../src/lib/atm.ts';
import type { NextdayData, NextPoint } from '../src/lib/nextday.ts';
import {
  analyzeFuturesEnv, quantile, ENV_MAINT_THRESHOLD, MIN_SAMPLE_DAYS,
} from '../src/lib/futuresEnv.ts';

let seq = 0;

function makeTrade(date: string, strategy: Strategy, net: number): Trade {
  seq += 1;
  const base = strategy === '程式' ? '小台指' : strategy === '選擇權' ? '台指選擇權' : '台積電';
  return {
    id: `t#${seq}`,
    date,
    month: date.slice(0, 7),
    year: date.slice(0, 4),
    product: `${base}202601`,
    base,
    lots: 1,
    side: '多',
    sideKnown: true,
    dayTrade: true,
    openPrice: 100,
    closePrice: 100,
    buyPrice: 100,
    sellPrice: 100,
    gross: net,
    fee: 0,
    tax: 0,
    net,
    note: '',
    isOption: strategy === '選擇權',
    strategy,
  };
}

function makeNextdaySeries(rows: Array<{ d: string; b: number; h: number; l: number; mt?: number }>): NextdayData {
  const series: NextPoint[] = rows.map(r => ({
    d: r.d,
    b: r.b,
    h: r.h,
    l: r.l,
    c: (r.h + r.l) / 2,
    r: 'n',
    u95: r.b * 1.02,
    d95: r.b * 0.98,
    u99: r.b * 1.03,
    d99: r.b * 0.97,
    mt: r.mt ?? null,
  }));
  // 附上一筆明天預估列（f=1，沒有 h/l），確認會被日振幅排除且 mt 對應最後一個交易日
  series.push({
    d: '2026-02-02',
    b: 20000,
    r: 'w',
    u95: 20400,
    d95: 19600,
    u99: 20600,
    d99: 19400,
    f: 1,
    mt: 162.0,
  });
  return {
    meta: {
      updated: '2026-01-31', date: '2026-01-30', close: 20000, next: '2026-02-02', gap: 3, regime: 'weekend',
      sigma: 0.015, since: '2000-01-04', samples: 5000, limit: 0.1,
      counts: { normal: 4000, weekend: 900, holiday: 100 },
      mult99: { normal: [2.5, -3], weekend: [2.8, -3.3], holiday: [3.5, -4.5] },
      checkFrom: '2023-01-01', checkDays: 700, source: 'test',
    },
    bands: [],
    check: [],
    recent: [],
    extremes: {
      H: { v: 0.05, d: '2026-01-02', d1: '2026-01-05' },
      L: { v: -0.05, d: '2026-01-02', d1: '2026-01-05' },
      Cup: { v: 0.04, d: '2026-01-02', d1: '2026-01-05' },
      Cdn: { v: -0.04, d: '2026-01-02', d1: '2026-01-05' },
    },
    series,
  };
}

function makeChips(keepHist: Array<[string, number, number]>, vix: Array<[string, number]> = []): ChipsData {
  return {
    meta: { date: '2026-01-30', updated: '2026-01-30', source: 'test', note: '' },
    futures: [],
    futHistory: { dates: [], contracts: {} },
    options: [],
    pc: { dates: [], vol: [], oi: [] },
    large: { fut: [], opt: [] },
    top: { twse: null, tpex: null },
    margin: {
      dates: [], money: [], lots: [], short: [], maint: null,
      keepHist,
    },
    tw: { vix, basis: [], breadth: [] },
  };
}

test('分位數線性內插', () => {
  assert.equal(quantile([], 0.8), null);
  const q80 = quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.8);
  assert.ok(q80 !== null && Math.abs(q80 - 8.2) < 1e-9);
});

test('大盤維持率：門檻 165%、優先 chips.json、缺檔退回 nextday 備援', async (t) => {
  const trades = [
    makeTrade('2026-01-05', '程式', -5000),
    makeTrade('2026-01-06', '程式', 2000),
    makeTrade('2026-01-06', '選擇權', 1500),
    makeTrade('2026-01-07', '主觀', 4000),
  ];

  await t.test('chips.json 存在時使用 keepHist，165.0 歸入 ≥165%', () => {
    const chips = makeChips([
      ['2026-01-05', 164.9, 1],
      ['2026-01-06', ENV_MAINT_THRESHOLD, 1],   // 剛好 165 → ≥165%
      ['2026-01-07', 172.3, 1],
    ]);
    const res = analyzeFuturesEnv(trades, { chips });
    assert.equal(res.meta.maintSource, 'chips-keep');
    const dim = res.dimensions.find(d => d.id === 'maint')!;
    assert.equal(dim.available, true);
    assert.equal(dim.matchedDays, 3);
    assert.equal(dim.unmatchedDays, 0);

    const low = dim.rows.find(r => r.id === 'low')!;
    const norm = dim.rows.find(r => r.id === 'normal')!;
    assert.equal(low.all.days, 1);
    assert.equal(low.all.net, -5000);
    assert.equal(low.all.lowSample, true);
    assert.equal(low.byStrategy.程式.days, 1);
    assert.equal(low.byStrategy.選擇權.days, 0);
    assert.equal(low.byStrategy.選擇權.lowSample, false);

    assert.equal(norm.all.days, 2);
    assert.equal(norm.all.net, 7500);
    assert.equal(norm.all.dayWinRate, 1);
    assert.equal(norm.byStrategy.程式.days, 1);
    assert.equal(norm.byStrategy.主觀.days, 1);
    assert.equal(norm.byStrategy.選擇權.days, 1);
  });

  await t.test('chips.json 缺檔時自動以 nextday.series[].mt 備援並還原到前一個交易日', () => {
    // series[1].mt 是 2026-01-05 的收盤維持率；series[2].mt 是 2026-01-06；tomorrow.mt (162) 是 2026-01-07
    const nextday = makeNextdaySeries([
      { d: '2026-01-05', b: 20000, h: 20100, l: 19900, mt: 170 },
      { d: '2026-01-06', b: 20000, h: 20100, l: 19900, mt: 160.5 },
      { d: '2026-01-07', b: 20000, h: 20100, l: 19900, mt: 168.0 },
    ]);
    const res = analyzeFuturesEnv(trades, { chips: null, nextday });
    assert.equal(res.meta.maintSource, 'nextday-fallback');
    const dim = res.dimensions.find(d => d.id === 'maint')!;
    assert.equal(dim.available, true);
    // 2026-01-05 (160.5) 與 2026-01-07 (162.0) < 165；2026-01-06 (168.0) >= 165
    assert.equal(dim.rows.find(r => r.id === 'low')!.all.days, 2);
    assert.equal(dim.rows.find(r => r.id === 'normal')!.all.days, 1);
  });
});

test('結算日：涵蓋期間內正確分類，超出涵蓋期間計入未對齊而不誤歸非結算日', () => {
  const trades = [
    makeTrade('2025-11-10', '程式', 3000),      // 早於 atm/settle 涵蓋期 → unmatched
    makeTrade('2026-01-07', '程式', -2000),     // 結算日
    makeTrade('2026-01-08', '程式', 1000),      // 非結算日
    makeTrade('2026-01-09', '選擇權', 800),     // 週五結算日（從 atm.rows.e 得知）
  ];
  const atm: AtmData = {
    meta: { updated: '2026-01-09', latest: '2026-01-09', days: 3, counts: {}, minPairs: 20, source: '', note: '', errors: [] },
    rows: [
      { d: '2026-01-07', s: 'wed', r: 0, c: '202601W1', e: '2026-01-07', dte: 0, k: 30000, call: 1, put: 1, diff: 0, sum: 2, pairs: 30, thin: 0 },
      { d: '2026-01-08', s: 'fri', r: 0, c: '202601F2', e: '2026-01-09', dte: 1, k: 30000, call: 100, put: 100, diff: 0, sum: 200, pairs: 30, thin: 0 },
      { d: '2026-01-09', s: 'fri', r: 0, c: '202601F2', e: '2026-01-09', dte: 0, k: 30000, call: 1, put: 1, diff: 0, sum: 2, pairs: 30, thin: 0 },
    ],
  };
  const res = analyzeFuturesEnv(trades, { settle: [{ d: '2026-01-07' }], atm });
  const dim = res.dimensions.find(d => d.id === 'settle')!;
  assert.equal(dim.available, true);
  assert.equal(dim.matchedDays, 3);
  assert.equal(dim.unmatchedDays, 1);
  assert.equal(dim.rows.find(r => r.id === 'yes')!.all.days, 2);
  assert.equal(dim.rows.find(r => r.id === 'yes')!.all.net, -1200);
  assert.equal(dim.rows.find(r => r.id === 'no')!.all.days, 1);
  assert.equal(dim.rows.find(r => r.id === 'no')!.all.net, 1000);
});

test('高波動日：台指日振幅與臺指 VIX 前 20% 聯集判定', () => {
  // 10 天日振幅分別為 1%..10%（前 20% 門檻 = 8.2%，因此第 9、10 天為高波動）
  const days = [
    '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
    '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16',
  ];
  const nextday = makeNextdaySeries(days.map((d, i) => ({
    d, b: 10000, h: 10000 + (i + 1) * 100, l: 10000,
  })));
  // 臺指 VIX：前 9 天低、第 1 天飆高（30）→ VIX 門檻會把 2026-01-05 也標成高波動
  const vix: Array<[string, number]> = [
    ['2026-01-05', 30], ['2026-01-06', 15], ['2026-01-07', 16], ['2026-01-08', 17], ['2026-01-09', 18],
    ['2026-01-12', 19], ['2026-01-13', 20], ['2026-01-14', 21], ['2026-01-15', 22], ['2026-01-16', 29],
  ];
  const chips = makeChips([], vix);
  const trades = [
    makeTrade('2026-01-05', '程式', -3000),  // VIX 高波動
    makeTrade('2026-01-06', '程式', 1000),   // 兩者皆一般
    makeTrade('2026-01-15', '主觀', -1000),  // 日振幅高波動（9%）
    makeTrade('2026-01-16', '選擇權', 2000), // 兩者皆高波動
  ];

  const res = analyzeFuturesEnv(trades, { chips, nextday });
  const dim = res.dimensions.find(d => d.id === 'volatility')!;
  assert.equal(dim.available, true);
  assert.ok(res.meta.ampThreshold !== null && Math.abs(res.meta.ampThreshold - 0.082) < 1e-9);
  assert.equal(dim.rows.find(r => r.id === 'high')!.all.days, 3);
  assert.equal(dim.rows.find(r => r.id === 'high')!.all.net, -2000);
  assert.equal(dim.rows.find(r => r.id === 'normal')!.all.days, 1);
  assert.equal(dim.rows.find(r => r.id === 'normal')!.all.net, 1000);
});

test('同日多筆聚合日勝率、星期幾不變量、以及 10 天小樣本門檻', () => {
  // 製造 10 個星期一（>= 10 天，非低樣本）與 1 個星期二（2 筆：+1000、-3000 → 日淨 -2000）
  const mondays = [
    '2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02',
    '2026-02-09', '2026-02-16', '2026-02-23', '2026-03-02', '2026-03-09',
  ];
  const trades: Trade[] = [
    ...mondays.map((d, i) => makeTrade(d, '程式', i < 7 ? 1000 : -500)),
    makeTrade('2026-01-06', '程式', 1000),
    makeTrade('2026-01-06', '程式', -3000),
  ];
  const res = analyzeFuturesEnv(trades, {});
  const wd = res.dimensions.find(d => d.id === 'weekday')!;
  assert.equal(wd.available, true);
  assert.equal(wd.unmatchedDays, 0);

  const mon = wd.rows[0];
  assert.equal(mon.label, '週一');
  assert.equal(mon.all.days, MIN_SAMPLE_DAYS);
  assert.equal(mon.all.lowSample, false);
  assert.equal(mon.all.dayWinRate, 0.7);
  assert.equal(mon.all.net, 7 * 1000 - 3 * 500);

  const tue = wd.rows[1];
  assert.equal(tue.label, '週二');
  assert.equal(tue.all.days, 1);
  assert.equal(tue.all.lowSample, true);
  assert.equal(tue.all.dayWinRate, 0);         // 當日淨損益 -2000，日勝率 0%
  assert.equal(tue.all.tradeWinRate, 0.5);     // 2 筆裡 1 勝 1 敗，筆勝率 50%
  assert.equal(tue.all.net, -2000);

  // 星期幾加總不變量
  const sumDays = wd.rows.reduce((a, r) => a + r.all.days, 0);
  const sumNet = wd.rows.reduce((a, r) => a + r.all.net, 0);
  assert.equal(sumDays, res.totalDays);
  assert.equal(sumNet, trades.reduce((a, t) => a + t.net, 0));
});

test('完全缺檔與空對帳單容錯：不拋錯、沒有 NaN', () => {
  const empty = analyzeFuturesEnv([], {});
  assert.equal(empty.totalDays, 0);
  assert.equal(empty.totalTrades, 0);
  assert.equal(empty.dimensions.find(d => d.id === 'maint')!.available, false);
  assert.equal(empty.dimensions.find(d => d.id === 'settle')!.available, false);
  assert.equal(empty.dimensions.find(d => d.id === 'volatility')!.available, false);
  assert.equal(empty.dimensions.find(d => d.id === 'weekday')!.available, true);
  for (const r of empty.dimensions.find(d => d.id === 'weekday')!.rows) {
    assert.equal(r.all.days, 0);
    assert.equal(r.all.dayWinRate, null);
    assert.equal(r.all.avgDailyNet, null);
    assert.equal(r.all.lowSample, false);
  }
});
