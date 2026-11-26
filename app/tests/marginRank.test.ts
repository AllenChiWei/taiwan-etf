import test from 'node:test';
import assert from 'node:assert/strict';
import { joinMarginRank, marginIndustryCounts, screenMarginRank } from '../src/lib/marginRank.ts';

const stocks = [
  { c: '2330', n: '台積電', m: '上市', i: '半導體業' },
  { c: '6488', n: '環球晶', m: '上櫃', i: '半導體業' },
  { c: '0050', n: '元大台灣50', m: '上市', i: 'ETF' },
];
const prices = [
  { c: '2330', n: '台積電', m: '上市', i: '半導體業', p: 900, pe: 20, pb: 3, y: 1, v: 20_000_000, r: [] },
  { c: '6488', n: '環球晶', m: '上櫃', i: '半導體業', p: 400, pe: 12, pb: 2, y: 2, v: 2_000_000, r: [] },
];

test('joins only listed companies, sorts by margin, and applies adjustable turnover floor', () => {
  const joined = joinMarginRank({ '2330': 128, '6488': 139, '0050': 110, '9999': 120 }, stocks, prices);
  assert.deepEqual(joined.map(r => r.code), ['2330', '6488']);
  assert.deepEqual(screenMarginRank(joined, 130, 10_000_000).map(r => r.code), ['2330']);
  assert.deepEqual(screenMarginRank(joined, 140, 0).map(r => r.code), ['2330', '6488']);
});

test('counts industry distribution and keeps missing turnover out of threshold screens', () => {
  const joined = joinMarginRank({ '2330': 128, '6488': 139 }, stocks, []);
  assert.equal(screenMarginRank(joined, 150, 0).length, 0);
  assert.deepEqual(marginIndustryCounts(joined), [{ industry: '半導體業', count: 2 }]);
});
