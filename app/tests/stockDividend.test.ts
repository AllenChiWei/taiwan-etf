/* 個股配息接進配息試算：除息紀錄 -> 序列 -> 每年可領多少。
 * 用台積電（季配）與富邦金（年配）的真實數字。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { seriesFromStock, activePayer, projectHolding, type StockDividendData } from '../src/lib/dividend.ts';

const months: string[] = [];
for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
  const s = `${y}-${String(m).padStart(2, '0')}`;
  if (s <= '2026-09') months.push(s);
}

const tsmc: StockDividendData['stocks'][string] = {
  n: '台積電', m: 'twse', c: 2460,
  ev: [['2025-06-12', 4.5, 1], ['2025-09-16', 5, 1], ['2025-12-11', 5, 1],
       ['2026-03-17', 6, 1], ['2026-06-11', 6, 1], ['2026-09-16', 7, 1]],
};

test('台積電：最近 12 個月除息 4 次 -> 季配，年領 = 最近一次 × 4', () => {
  const p = projectHolding(seriesFromStock('2330', tsmc, months), months, 1000);
  assert.equal(p.perYear, 4);
  assert.equal(p.latest, 7);
  assert.equal(p.annual, 7 * 4 * 1000);
  assert.deepEqual(p.actualMonths, [2, 5, 8, 11]);          // 3、6、9、12 月
  assert.equal(p.yieldPct.toFixed(2), (28 / 2460 * 100).toFixed(2));
  assert.equal(p.name, '台積電');
});

test('同一個月除息兩次就加總；超出月份範圍的紀錄不算', () => {
  const s = seriesFromStock('X', { n: 'X', m: 'tpex', c: 10,
    ev: [['2026-07-01', 1, 1], ['2026-07-20', 0.5, 1], ['2030-01-01', 9, 1]] }, months);
  assert.equal(s.d[months.indexOf('2026-07')], 1.5);
  assert.equal(s.d.reduce((a, b) => a + b, 0), 1.5);
});

test('權息合併計價的那筆標成約略', () => {
  const s = seriesFromStock('X', { n: 'X', m: 'twse', c: 10, ev: [['2026-08-01', 2, 0]] }, months);
  assert.equal(s.dSrc![months.indexOf('2026-08')], 0);
  assert.equal(projectHolding(s, months, 1000).exact, false);
});

test('停配的公司不列進選單', () => {
  assert.equal(activePayer(tsmc, '2025-06-01'), true);
  assert.equal(activePayer({ n: 'X', m: 'twse', c: 1, ev: [['2023-07-01', 1, 1]] }, '2025-06-01'), false);
});

const PATH = new URL('../public/data/stock_dividends.json', import.meta.url);

test('真實 stock_dividends.json', { skip: !existsSync(PATH) && '沒有 stock_dividends.json' }, () => {
  const d = JSON.parse(readFileSync(PATH, 'utf8')) as StockDividendData;
  const codes = Object.keys(d.stocks);
  assert.ok(codes.length > 500, `只有 ${codes.length} 檔`);
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  for (const [code, s] of Object.entries(d.stocks)) {
    assert.match(code, /^[1-9]\d{3}$/, `${code} 不是普通股代號`);
    let ttm = 0;
    for (const [day, cash] of s.ev) {
      assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(cash > 0, `${code} ${day} 配 ${cash}`);
      if (day >= yearAgo) ttm += cash;
    }
    // 近一年配的比現在股價還多 = 殖利率破 100%，多半是單位或「權值+息值」弄錯。
    // 只看近一年：光明 4420 在 2024 年處分資產發過 20 元特別股利，當時股價也高，
    // 拿現在的股價去比兩年前的配息會誤判（第一版就這樣錯過）。
    if (s.c) assert.ok(ttm < s.c, `${code} 近一年配 ${ttm}，股價 ${s.c}`);
  }
});
