/* 散戶多空比驗收的測試，外加一份對真實 retail.json 的檢查。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { retailPoints, forwardReturns, backtest, type RetailData } from '../src/lib/retail.ts';

function data(days: Record<string, [number, number, number]>,
              taiex: Record<string, number>): RetailData {
  return {
    meta: { updated: '', latest: null, source: '', note: '', errors: [] },
    contracts: { MTX: { name: '小型臺指期貨', days } },
    taiex,
  };
}

test('散戶多空比 = (法人空 − 法人多) ÷ 全市場', () => {
  // 2026-09-23 小台：全市場 32,921、法人多 4,465、法人空 8,609（與籌碼頁同一天的數字）
  const pts = retailPoints(data({ '2026-09-23': [32921, 4465, 8609] }, {}), 'MTX');
  assert.equal(pts[0].net, 4144);
  assert.equal(pts[0].ratio.toFixed(2), '12.59');
});

test('全市場為 0 的日子跳過，不是當成多空比 0', () => {
  assert.equal(retailPoints(data({ a: [0, 0, 0] }, {}), 'MTX').length, 0);
  assert.deepEqual(retailPoints(data({}, {}), 'TMF'), []);
});

test('之後 h 日的報酬用交易日數，不用日曆天', () => {
  const fwd = forwardReturns({ '2026-01-02': 100, '2026-01-05': 110, '2026-01-06': 99 }, 1);
  assert.equal(fwd.get('2026-01-02')!.toFixed(1), '10.0');   // 跨週末仍是「隔一個交易日」
  assert.equal(fwd.get('2026-01-05')!.toFixed(1), '-10.0');
  assert.equal(fwd.has('2026-01-06'), false);                // 還沒走完的最後一天沒有答案
});

test('分組', async (t) => {
  // 100 個交易日：多空比 = 天數，指數每天漲 1 點，但多空比越高之後漲越少
  const days: Record<string, [number, number, number]> = {};
  const taiex: Record<string, number> = {};
  let level = 1000;
  for (let i = 0; i < 101; i++) {
    const d = `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
    days[d] = [100, 0, i];                                    // ratio = i%
    taiex[d] = level;
    level += i < 50 ? 10 : -10;
  }
  const bt = backtest(retailPoints(data(days, taiex), 'MTX'), taiex, 1)!;

  await t.test('五組、每組天數相同、由低到高', () => {
    assert.equal(bt.groups.length, 5);
    assert.deepEqual(bt.groups.map(g => g.n), [20, 20, 20, 20, 20]);
    assert.equal(bt.groups[0].lo, 0);
    assert.equal(bt.groups[4].hi, 99);
  });

  await t.test('最偏多那組之後全部下跌', () => {
    assert.equal(bt.groups[4].up, 0);
    assert.equal(bt.groups[0].up, 1);
  });

  await t.test('最新一天還沒有答案，但仍然標出它落在哪一組', () => {
    assert.equal(bt.latest!.ratio, 100);
    assert.equal(bt.latestGroup, 4);
    assert.equal(bt.latestPct, 100);
  });

  await t.test('樣本太少時不分組', () => {
    const few = Object.fromEntries(Object.entries(days).slice(0, 30));
    assert.equal(backtest(retailPoints(data(few, taiex), 'MTX'), taiex, 1), null);
  });
});

const PATH = new URL('../public/data/retail.json', import.meta.url);

test('真實 retail.json', { skip: !existsSync(PATH) && '沒有 retail.json' }, async (t) => {
  const d = JSON.parse(readFileSync(PATH, 'utf8')) as RetailData;

  await t.test('全市場不小於任一邊的法人合計 —— 否則推算出負的散戶部位', () => {
    for (const [cid, c] of Object.entries(d.contracts)) {
      for (const [day, [oi, bn, sn]] of Object.entries(c.days)) {
        assert.ok(oi >= bn && oi >= sn, `${cid} ${day}：${oi} < ${bn}/${sn}`);
      }
    }
  });

  await t.test('每個有散戶資料的交易日都有指數收盤', () => {
    const missing = Object.keys(d.contracts.MTX?.days ?? {}).filter(day => !d.taiex[day]);
    // 最新一天 FinMind 可能還沒更新，容許少數幾天
    assert.ok(missing.length <= 3, `缺 ${missing.length} 天指數：${missing.slice(0, 5)}`);
  });
});
