/* 市場總覽的燈號規則（lib/marketSummary.ts）：用造出來的籌碼資料測門檻與總結。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headline, marketItems, pctRank, type NextdayLite } from '../src/lib/marketSummary.ts';
import type { ChipsData } from '../src/lib/chips.ts';

function chips(over: { keep?: number; vix?: number; up?: number; dn?: number; ma20?: number; money?: number[] } = {}): ChipsData {
  const dates = ['2026-11-18', '2026-11-19', '2026-11-20'];
  return {
    meta: { date: '2026-11-20' },
    futures: [], options: [], large: { fut: [], opt: [] }, top: { twse: null, tpex: null },
    futHistory: { dates, contracts: {} },
    pc: { dates, vol: [100, 100, 100], oi: [80, 90, 100] },
    margin: {
      dates, money: over.money ?? [100e8, 100e8, 100e8, 100e8, 100e8, 100e8], lots: [],
      keepHist: [['2026-11-19', 170, 1], ['2026-11-20', over.keep ?? 170, 1]],
    },
    tw: {
      vix: [['2026-11-19', 20], ['2026-11-20', over.vix ?? 20]],
      basis: [],
      breadth: [['2026-11-20', over.up ?? 500, over.dn ?? 500]],
      maBreadth: [['2026-11-20', over.ma20 ?? 50, 50, 1700]],
    },
  } as unknown as ChipsData;
}
const get = (items: ReturnType<typeof marketItems>, k: string) => items.find(i => i.key === k)!;

test('百分位', () => {
  assert.equal(pctRank([1, 2, 3, 4], 2), 0.5);
  assert.ok(Number.isNaN(pctRank([], 1)));
});

test('維持率：同籌碼頁四區（165／156／147），加速區以下是警戒', () => {
  assert.equal(get(marketItems(chips({ keep: 170 })), 'maint').level, 0);
  assert.equal(get(marketItems(chips({ keep: 160 })), 'maint').level, 1);
  assert.equal(get(marketItems(chips({ keep: 151.78 })), 'maint').level, 2);
  assert.equal(get(marketItems(chips({ keep: 140 })), 'maint').level, 2);
});

test('臺指 VIX、漲跌家數、站上 20 日線、融資一天大減', () => {
  assert.equal(get(marketItems(chips({ vix: 52 })), 'twvix').level, 2);
  assert.equal(get(marketItems(chips({ vix: 27 })), 'twvix').level, 1);
  assert.equal(get(marketItems(chips({ up: 16, dn: 1058 })), 'breadth').level, 2);
  assert.equal(get(marketItems(chips({ ma20: 2.6 })), 'ma20').level, 1);
  assert.equal(get(marketItems(chips({ money: [100e8, 100e8, 100e8, 100e8, 100e8, 90e8] })), 'money').level, 2);
});

test('明天 95% 區間：任一邊 ≥ 5% 是警戒', () => {
  const nd: NextdayLite = { meta: { date: '2026-11-20', close: 36000, next: '2026-11-23', sigma: 0.04 }, bands: [{ p: 0.95, up: 0.08, dn: -0.097 }] };
  const it = get(marketItems(chips(), nd), 'nextday');
  assert.equal(it.level, 2);
  assert.equal(it.value, `${Math.round(36000 * (1 - 0.097)).toLocaleString('zh-TW')}～${Math.round(36000 * 1.08).toLocaleString('zh-TW')}`);
});

test('總結：警戒數決定那一句', () => {
  const calm = headline(marketItems(chips()));
  assert.equal(calm.warn.length, 0);
  const bad = headline(marketItems(chips({ keep: 140, vix: 52, up: 16, dn: 1058, money: [100e8, 100e8, 100e8, 100e8, 100e8, 90e8] })));
  assert.ok(bad.warn.length >= 4);
  assert.match(bad.text, /恐慌/);
});
