/* 隔日漲跌幅：履約價取整方向、突破判斷、真實資料的合理範圍。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { levelOf, callStrikeAbove, putStrikeBelow, breached, type NextdayData, type NextRecent } from '../src/lib/nextday.ts';

test('履約價：買權往上取、賣權往下取，50 點一檔', () => {
  assert.equal(callStrikeAbove(39175.2), 39200);
  assert.equal(callStrikeAbove(39200), 39200);
  assert.equal(putStrikeBelow(32430.9), 32400);
  assert.equal(putStrikeBelow(32450), 32450);
  assert.ok(Math.abs(levelOf(36000, 0.05) - 37800) < 1e-9);
});

test('突破判斷：先看上緣再看下緣', () => {
  const r = { H: 0.03, L: -0.01, up95: 0.02, dn95: -0.02, up99: 0.04, dn99: -0.05 } as NextRecent;
  assert.equal(breached(r, 95), 'up');
  assert.equal(breached(r, 99), null);
  assert.equal(breached({ ...r, H: 0, L: -0.06 }, 99), 'down');
});

const PATH = new URL('../public/data/nextday.json', import.meta.url);
test('真實資料：區間單調、不超過漲跌停、驗證期突破率合理', { skip: !existsSync(PATH) && '沒有 nextday.json' }, () => {
  const d = JSON.parse(readFileSync(PATH, 'utf8')) as NextdayData;
  assert.ok(d.meta.close > 0 && d.meta.sigma > 0 && d.meta.sigma < 0.1);
  assert.ok(d.meta.next > d.meta.date);
  for (let i = 1; i < d.bands.length; i++) {
    assert.ok(d.bands[i].up >= d.bands[i - 1].up, '機率越高上緣越高');
    assert.ok(d.bands[i].dn <= d.bands[i - 1].dn, '機率越高下緣越低');
  }
  for (const b of d.bands) {
    assert.ok(b.up > 0 && b.up <= d.meta.limit + 1e-9);
    assert.ok(b.dn < 0 && b.dn >= -d.meta.limit - 1e-9);
  }
  // 樣本外 99% 區間的突破率不該離 1% 太遠（研究時 1.4～1.8%）
  const c99 = d.check.find(c => c.p === 0.99)!;
  assert.ok(c99.up < 0.04 && c99.dn < 0.04, `99% 突破 ${c99.up}／${c99.dn}`);
  assert.equal(d.recent.length, 10);
});
