/* 股票反查 ETF 與主動式經理人排行（2026-10-26）。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { holdersOf, managerBoard } from '../src/lib/holders.ts';
import type { ActiveData } from '../src/lib/active.ts';
import type { Top10Data } from '../src/lib/top10.ts';

const active: ActiveData = {
  meta: { updated: '2026-10-23', minChange: 0.005, blocked: [], source: 's', errors: [] },
  last: { d: '2026-10-22', px: { '2330': 110, '3711': 90 } },
  etfs: {
    '00981A': {
      name: '主動統一台股增長', issuer: '統一', cap: 2600, asof: '2026-10-22',
      holdings: [['2330', '台積電', 12671000, 11.34]],
      changes: Array.from({ length: 6 }, (_, i) => ({
        d: `2026-10-1${i}`, p: `2026-10-0${i}`, f: 0,
        items: [['2330', '台積電', 1000, 2000, 10, 100], ['3711', '日月光', 1000, 0, 0, 100]] as never,
      })),
    },
    '00403A': {
      name: '主動統一升級50', issuer: '統一', cap: 1200, asof: '2026-10-22', holdings: [['2454', '聯發科', 1, 5]],
      changes: [{ d: '2026-10-22', p: '2026-10-21', f: 0, items: [['2330', '台積電', 500, 0, 0, 100]] }],
    },
  },
};
const monthly: Top10Data = {
  meta: { ym: '202609', updated: '2026-10-15', source: '公會' },
  etfs: {
    '0050': { name: '元大台灣卓越50證券投資信託基金', rows: [[1, '國內上市', '2330', '台積電', 55.1]] },
    '00981A': { name: '（月報舊資料）', rows: [[1, '國內上市', '2330', '台積電', 9.9]] },
  },
};

test('股票反查 ETF：主動式用每日持股、其他用月報前十大、權重排序', () => {
  const h = holdersOf('2330', monthly, active, { '0050': '元大台灣50' });
  assert.deepEqual(h.map(x => x.etf), ['0050', '00981A', '00403A']);
  assert.equal(h[0].name, '元大台灣50', '有簡稱用簡稱');
  assert.equal(h[0].kind, 'monthly');
  assert.equal(h[0].asof, '2026/09');
  assert.equal(h[1].kind, 'daily', '同一檔主動式以每日持股為準，不用月報');
  assert.equal(h[1].weight, 11.34);
  assert.equal(h[1].last?.kind, '加碼');
  assert.equal(h[2].weight, 0, '剛剔除的也列出（權重 0）');
  assert.equal(h[2].last?.kind, '剔除');
  assert.equal(holdersOf('9999', monthly, active).length, 0);
});

test('主動式經理人排行：選股力＝買進後漲跌 − 賣出後漲跌，筆數不足排最後', () => {
  const b = managerBoard(active, 10);
  assert.equal(b[0].code, '00981A');
  assert.ok(Math.abs(b[0].buy! - 0.1) < 1e-12 && Math.abs(b[0].sell! + 0.1) < 1e-12);
  assert.ok(Math.abs(b[0].edge! - 0.2) < 1e-12, '買進 +10%、賣出 −10% → 選股力 +20%');
  assert.equal(b[0].n, 12);
  assert.equal(b[1].code, '00403A', '只有 1 筆，排在後面');
});

const ACTIVE = new URL('../public/data/active_holdings.json', import.meta.url);
const TOP10 = new URL('../public/data/top10.json', import.meta.url);
test('真實資料：台積電被多檔 ETF 持有、排行每檔都有一列', { skip: !(existsSync(ACTIVE) && existsSync(TOP10)) && '沒有資料檔' }, () => {
  const a = JSON.parse(readFileSync(ACTIVE, 'utf8')) as ActiveData;
  const m = JSON.parse(readFileSync(TOP10, 'utf8')) as Top10Data;
  const h = holdersOf('2330', m, a);
  assert.ok(h.length >= 20, `台積電只查到 ${h.length} 檔`);
  assert.ok(h.every(x => x.weight == null || (x.weight >= 0 && x.weight <= 100)));
  const b = managerBoard(a);
  assert.equal(b.length, Object.keys(a.etfs).length);
});
