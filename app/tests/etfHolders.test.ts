/* ETF 受益人數與資金流向（2026-10-27；資金流向榜 2026-11-26）。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildFlowRows, detectSplit, filterFlowRows, formatFlowYi, holdersFor,
  sortFlowRows, summarizeFlow, windowRange,
  type EtfHoldersData,
} from '../src/lib/etfHolders.ts';
import type { YieldData } from '../src/lib/dividend.ts';
import type { Etf, EtfDataset } from '../src/types.ts';

const d: EtfHoldersData = {
  meta: { source: '', asof: '2026-11-19', weeks: 6 },
  dates: ['2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05', '2026-11-12', '2026-11-19'],
  etfs: {
    '0056': [[100, 10], [110, 12], [120, 11], [130, 15], [140, 15], [150, 20]],
    NEW: [null, null, null, null, [5, 1], [8, 2]],
    GAP: [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], null],
  },
};

test('最新一週與週、4 週變化', () => {
  const v = holdersFor('0056', d)!;
  assert.equal(v.asof, '2026-11-19');
  assert.deepEqual([v.holders, v.lots], [150, 20]);
  assert.deepEqual(v.w1, { holders: 10, lots: 5 });
  assert.deepEqual(v.w4, { holders: 40, lots: 8 });
  assert.equal(v.series.length, 6);
});

test('新上市沒有 4 週前；最後一週缺資料就退回有資料的那週', () => {
  const n = holdersFor('NEW', d)!;
  assert.deepEqual(n.w1, { holders: 3, lots: 1 });
  assert.equal(n.w4, null);
  assert.equal(n.series.length, 2);
  const g = holdersFor('GAP', d)!;
  assert.equal(g.asof, '2026-11-12');
  assert.deepEqual(g.w4, { holders: 4, lots: 4 });
  assert.equal(holdersFor('NONE', d), null);
  assert.equal(holdersFor('0056', null), null);
});

test('只有一週：沒有變化', () => {
  const one: EtfHoldersData = { meta: { source: '', asof: '2026-10-22', weeks: 1 }, dates: ['2026-10-22'], etfs: { A: [[9, 3]] } };
  const v = holdersFor('A', one)!;
  assert.equal(v.w1, null);
  assert.equal(v.holders, 9);
});

// ---- 資金流向榜與分割偵測 ----------------------------------------------------

const mkEtf = (code: string, o: Partial<Etf> = {}): Etf => ({
  code,
  name: o.name ?? `基金${code}`,
  cust: o.cust ?? '銀行',
  freq: o.freq ?? '季配',
  yield: '5.00',
  r3: '1.00',
  r6: '2.00',
  r12: '10.00',
  r36: 'N/A',
  r60: 'N/A',
  sec: o.sec ?? 'cat-domestic',
  act: o.act ?? false,
});

test('detectSplit：辨識分割（含停牌 null 週）與反分割，不誤判連續爆紅吸金與迷你基金', () => {
  const dates = ['2026-10-22', '2026-10-30', '2026-11-06', '2026-11-13', '2026-11-20'];

  // 模擬 00662：1 拆 5 分割，中間一週停牌為 null
  const splitRow: ([number, number] | null)[] = [
    [118186, 957029], [119788, 968029], [121739, 991029], null, [131976, 5160645],
  ];
  const sp = detectSplit(splitRow, dates, 0, 4);
  assert.ok(sp);
  assert.equal(sp.kind, 'split');
  assert.equal(sp.ratio, 5.2);
  assert.equal(sp.fromDate, '2026-11-06');
  assert.equal(sp.toDate, '2026-11-20');

  // 模擬 00406A：4 週穩定大吸金讓總張數翻倍，但單週增幅平緩且人均無跳變 → 不是分割
  const hotRow: ([number, number] | null)[] = [
    [400571, 11093062], [455610, 13588062], [547631, 17987062], [581020, 19920062], [635412, 22359062],
  ];
  assert.equal(detectSplit(hotRow, dates, 0, 4), null);

  // 反分割（5 併 1）
  const revRow: ([number, number] | null)[] = [
    [50000, 1000000], [50000, 1000000], [49800, 1000000], [49500, 200000], [49200, 198000],
  ];
  const rev = detectSplit(revRow, dates, 0, 4);
  assert.ok(rev);
  assert.equal(rev.kind, 'reverse');
  assert.equal(rev.ratio, 0.2);

  // 極迷你基金（5 張變 12 張）→ 不誤判
  const tinyRow: ([number, number] | null)[] = [
    [5, 5], [5, 5], [5, 5], [5, 5], [5, 12],
  ];
  assert.equal(detectSplit(tinyRow, dates, 0, 4), null);
});

test('buildFlowRows／篩選／排序／彙總：疑似分割不污染申贖金額排行，缺收盤價也能安全降級', () => {
  const dates = ['2026-10-22', '2026-10-30', '2026-11-06', '2026-11-13', '2026-11-20'];
  const holders: EtfHoldersData = {
    meta: { source: 'tdcc', asof: '2026-11-20', weeks: 5 },
    dates,
    etfs: {
      '0050': [[3000000, 20000000], [3010000, 20100000], [3020000, 20200000], [3050000, 20400000], [3100000, 20500000]],
      '00679B': [[200000, 6000000], [198000, 5950000], [196000, 5900000], [195000, 5850000], [194000, 5800000]],
      '00662': [[118186, 957029], [119788, 968029], [121739, 991029], null, [131976, 5160645]],
      '00631L': [[300000, 7000000], [305000, 7100000], [310000, 7200000], [315000, 7300000], [320000, 7400000]],
      '00981A': [[100000, 1000000], [102000, 1020000], [104000, 1040000], [106000, 1060000], [110000, 1080000]],
    },
  };
  const yields: YieldData = {
    meta: { asof: '2026-11-25' },
    yields: {
      '0050': { price: 90 },
      '00679B': { price: 25 },
      '00662': { price: 22 },
      '00631L': { price: 24 },
      '00981A': { price: 20 },
    },
  };
  const etfs: Etf[] = [
    mkEtf('0050', { name: '元大台灣50', sec: 'cat-domestic' }),
    mkEtf('00679B', { name: '元大美債20年', sec: 'cat-bond' }),
    mkEtf('00662', { name: '富邦NASDAQ', sec: 'cat-foreign' }),
    mkEtf('00631L', { name: '元大台灣50正2', sec: 'cat-leveraged' }),
    mkEtf('00981A', { name: '主動統一台股增長', sec: 'cat-domestic', act: true }),
  ];

  assert.deepEqual(windowRange(dates, 'w1'), { prevDate: '2026-11-13', asof: '2026-11-20' });
  assert.deepEqual(windowRange(dates, 'w4'), { prevDate: '2026-10-22', asof: '2026-11-20' });
  assert.equal(windowRange(['2026-10-22'], 'w1'), null);

  const rows = buildFlowRows(etfs, holders, yields);
  assert.equal(rows.length, 5);

  const r0050 = rows.find(r => r.code === '0050')!;
  assert.equal(r0050.w1?.dLots, 100000);
  assert.equal(r0050.w1?.estFlow, 100000 * 90 * 1000);

  const r00662 = rows.find(r => r.code === '00662')!;
  assert.equal(r00662.w1, null, '前 1 週為 null 則無 w1');
  assert.ok(r00662.w4?.split, '4 週跨越分割應標示');
  assert.equal(r00662.w4?.estFlow, null, '分割失真時不輸出估算淨申贖金額');
  assert.equal(r00662.w4?.dHolders, 131976 - 118186, '受益人數不受分割影響');

  // 4 週依估算淨申贖排序：0050 第一，00662 沉底
  const byFlow = sortFlowRows(rows, 'w4', 'flow', 'in');
  assert.equal(byFlow[0].code, '0050');
  assert.equal(byFlow[byFlow.length - 1].code, '00662');

  // 4 週依淨贖回排序：00679B 第一，00662 仍然沉底
  const byOut = sortFlowRows(rows, 'w4', 'flow', 'out');
  assert.equal(byOut[0].code, '00679B');
  assert.equal(byOut[byOut.length - 1].code, '00662');

  // 4 週依受益人數排序：00662 正常參與排行（+13,790 排在 00981A +10,000 前面）
  const byHolders = sortFlowRows(rows, 'w4', 'holders', 'in');
  assert.ok(byHolders.findIndex(r => r.code === '00662') < byHolders.findIndex(r => r.code === '00981A'));

  // 彙總排除疑似分割
  const sum = summarizeFlow(rows, 'w4');
  assert.deepEqual(sum.splitCodes, ['00662']);
  assert.equal(sum.pricedCount, 4);
  assert.equal(sum.totalCount, 5);
  assert.equal(sum.outflow, -200000 * 25 * 1000);

  // 分類與搜尋
  assert.deepEqual(filterFlowRows(rows, 'active').map(r => r.code), ['00981A']);
  assert.deepEqual(filterFlowRows(rows, 'leveraged').map(r => r.code), ['00631L']);
  assert.deepEqual(filterFlowRows(rows, 'all', '美債').map(r => r.code), ['00679B']);

  // yields 缺席時不報錯，人數與張數照常可用
  const noPrice = buildFlowRows(etfs, holders, null);
  assert.equal(noPrice.length, 5);
  assert.equal(noPrice[0].price, null);
  assert.equal(noPrice[0].w1?.estFlow, null);
  assert.equal(buildFlowRows(etfs, null, yields).length, 0);
});

test('formatFlowYi 金額格式化', () => {
  assert.equal(formatFlowYi(0), '0');
  assert.equal(formatFlowYi(441.52e8), '+441.5 億');
  assert.equal(formatFlowYi(-12.34e8), '-12.34 億');
  assert.equal(formatFlowYi(8520e4), '+8,520 萬');
  assert.equal(formatFlowYi(-5000), '-5,000 元');
});

test('真實資料整合：etf_holders.json × etfs.json × yields.json 正確標示 00662 分割且不誤判 00406A', () => {
  const etfsDoc = JSON.parse(
    readFileSync(new URL('../public/data/etfs.json', import.meta.url), 'utf8'),
  ) as EtfDataset;
  const holdersDoc = JSON.parse(
    readFileSync(new URL('../public/data/etf_holders.json', import.meta.url), 'utf8'),
  ) as EtfHoldersData;
  const yieldsDoc = JSON.parse(
    readFileSync(new URL('../public/data/yields.json', import.meta.url), 'utf8'),
  ) as YieldData;

  const rows = buildFlowRows(etfsDoc.etfs, holdersDoc, yieldsDoc);
  assert.ok(rows.length > 300, `預期對到 >300 檔 ETF，實際 ${rows.length}`);

  const r00662 = rows.find(r => r.code === '00662');
  assert.ok(r00662, '應包含 00662');
  // 2026-11-20 當週 00662 剛完成 1 拆 5，4 週視角必須標示分割並排除於金額排行
  if (holdersDoc.dates.includes('2026-11-06') && holdersDoc.dates[holdersDoc.dates.length - 1] === '2026-11-20') {
    assert.ok(r00662.w4?.split, '00662 4 週應偵測到分割');
    assert.equal(r00662.w4?.estFlow, null);
  }

  const r00406A = rows.find(r => r.code === '00406A');
  assert.ok(r00406A, '應包含 00406A');
  assert.equal(r00406A.w4?.split ?? null, null, '00406A 持續吸金不應誤判為分割');
});
