/* 自算恐懼貪婪與 VIX 的測試，外加對真實 chips.json 的檢查。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  ffill, sma, ret, rollingPercentile, mood, components, fearGreed, vixView,
  type UsSeries,
} from '../src/lib/sentiment.ts';

test('基本運算', async (t) => {
  await t.test('往前補值：休市那天沿用前一天，開頭的 null 留著', () => {
    assert.deepEqual(ffill([null, 1, null, 3, 0]), [null, 1, 1, 3, 3]);
  });

  await t.test('均線不滿 n 天是 null', () => {
    assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
    assert.deepEqual(sma([null, 2, 4], 2), [null, null, 3]);
  });

  await t.test('n 日報酬', () => {
    const r = ret([100, 110, 121], 1);
    assert.equal(r[0], null);
    assert.equal(r[2]!.toFixed(2), '0.10');
  });

  await t.test('百分位：最小是 0、最大是 100，樣本不夠是 null', () => {
    const xs = Array.from({ length: 10 }, (_, i) => i);
    const p = rollingPercentile(xs, 10);
    assert.equal(p[3], null);                 // 不滿半個窗口
    assert.equal(p[9], 100);
    const low = rollingPercentile([...xs, -1], 10);
    assert.equal(low[10], 0);
  });

  await t.test('分界照 CNN：25／45／55／75', () => {
    assert.equal(mood(10), '極度恐懼');
    assert.equal(mood(30), '恐懼');
    assert.equal(mood(50), '中性');
    assert.equal(mood(60), '貪婪');
    assert.equal(mood(90), '極度貪婪');
  });
});

/** n 天的假資料：每一檔用自己的函式產生價格。 */
function fake(n: number, f: Partial<Record<keyof Omit<UsSeries, 'dates'>, (i: number) => number>>): UsSeries {
  const col = (g?: (i: number) => number) => Array.from({ length: n }, (_, i) => (g ? g(i) : 100));
  return {
    dates: Array.from({ length: n }, (_, i) => `d${String(i).padStart(4, '0')}`),
    spx: col(f.spx), vix: col(f.vix), spy: col(f.spy),
    tlt: col(f.tlt), hyg: col(f.hyg), lqd: col(f.lqd),
  };
}

test('四項的方向：越大越貪婪', async (t) => {
  await t.test('VIX 衝高時「波動率」這項是負的（恐懼）', () => {
    const us = fake(80, { vix: i => (i < 79 ? 15 : 30) });
    const v = components(us).volatility;
    assert.ok(v[79]! < 0);
  });

  await t.test('股票贏公債時「避險需求」是正的（貪婪）', () => {
    const us = fake(40, { spy: i => 100 + i, tlt: () => 100 });
    assert.ok(components(us).safeHaven[39]! > 0);
  });
});

test('持續上漲、VIX 走低的市場落在貪婪那一側', () => {
  // 前一年橫盤，最後三十天股票一路漲、VIX 一路降、垃圾債贏
  const n = 420;
  const us = fake(n, {
    spx: i => (i < n - 30 ? 4000 + Math.sin(i / 7) * 40 : 4000 + (i - (n - 30)) * 20),
    spy: i => (i < n - 30 ? 400 + Math.sin(i / 7) * 4 : 400 + (i - (n - 30)) * 2),
    vix: i => (i < n - 30 ? 20 + Math.sin(i / 5) * 2 : 18 - (i - (n - 30)) * 0.2),
    hyg: i => 80 + (i > n - 30 ? (i - (n - 30)) * 0.1 : 0),
  });
  const fg = fearGreed(us);
  assert.ok(fg.latest, '應該有最新一天');
  assert.ok(fg.latest!.score > 55, `分數 ${fg.latest!.score} 應該在貪婪那一側`);
  assert.equal(fg.index.length, n);
});

test('VIX 的日變化與一年百分位', () => {
  const us = fake(300, { vix: i => (i === 299 ? 40 : 15) });
  const v = vixView(us)!;
  assert.equal(v.close, 40);
  assert.equal(v.change, 25);
  assert.ok(v.pct! > 99);
});

const PATH = new URL('../public/data/chips.json', import.meta.url);

test('真實 chips.json 的美股序列', { skip: !existsSync(PATH) && '沒有 chips.json' }, (t) => {
  const d = JSON.parse(readFileSync(PATH, 'utf8'));
  if (!d.us) { t.skip('這份 chips.json 沒有美股序列（舊版或 FinMind 失敗）'); return; }
  const us = d.us as UsSeries;
  for (const k of ['spx', 'vix', 'spy', 'tlt', 'hyg', 'lqd'] as const) {
    assert.equal(us[k].length, us.dates.length, `${k} 的長度跟日期不一樣`);
  }
  // VIX 在 5 到 100 之間；超出代表抓到的不是 VIX（例如某個同名代號）
  for (const v of us.vix) if (v !== null) assert.ok(v > 5 && v < 100, `VIX ${v} 不合理`);
  const fg = fearGreed(us);
  if (fg.latest) assert.ok(fg.latest.score >= 0 && fg.latest.score <= 100);
});
