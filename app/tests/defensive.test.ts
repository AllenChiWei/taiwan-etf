/* 民生股：區的判斷、條狀圖刻度、排序；真實資料的便宜 ≤ 合理 ≤ 昂貴。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { scale, sortRows, zoneOf, type DefData, type DefRow } from '../src/lib/defensive.ts';

const b = { cheap: 100, fair: 120, rich: 140 };

test('區：便宜價以下、合理偏低、合理偏高、昂貴', () => {
  assert.equal(zoneOf(95, b), 'cheap');
  assert.equal(zoneOf(100, b), 'cheap');
  assert.equal(zoneOf(110, b), 'fairLow');
  assert.equal(zoneOf(130, b), 'fairHigh');
  assert.equal(zoneOf(150, b), 'rich');
  assert.equal(zoneOf(100, null), null);
});

test('刻度：股價超出區間時延伸、位置夾在 0～1', () => {
  const s = scale(200, b);
  assert.ok(s.hi >= 200 * 1.03 - 1e-9);
  assert.equal(s.at(1e9), 1);
  assert.equal(s.at(-1), 0);
});

test('排序：便宜的在前，同區殖利率百分位高的在前', () => {
  const r = (c: string, price: number, yr: number) => ({ c, price, yieldRank: yr, byYield: b }) as unknown as DefRow;
  assert.deepEqual(sortRows([r('A', 150, 0.1), r('B', 95, 0.5), r('C', 90, 0.9)]).map(x => x.c), ['C', 'B', 'A']);
});

const PATH = new URL('../public/data/defensive.json', import.meta.url);
test('真實資料：便宜 ≤ 合理 ≤ 昂貴、殖利率合理、電信三檔都在', { skip: !existsSync(PATH) && '沒有 defensive.json' }, () => {
  const d = JSON.parse(readFileSync(PATH, 'utf8')) as DefData;
  for (const r of d.rows) {
    for (const band of [r.byYield, r.byPe, r.byPb, r.byClassic]) {
      if (!band) continue;
      assert.ok(band.cheap <= band.fair && band.fair <= band.rich, `${r.c}`);
    }
    if (r.yield !== null) assert.ok(r.yield > 0 && r.yield < 20, `${r.c} 殖利率 ${r.yield}`);
  }
  for (const c of ['2412', '3045', '4904']) assert.ok(d.rows.some(r => r.c === c), c);
});
