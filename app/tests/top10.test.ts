/* 前十大持股：來源選擇、雙幣別代號、查不到時的說明，外加對真實 top10.json 的檢查。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { top10For, missingReason, type Top10Data } from '../src/lib/top10.ts';
import type { ActiveData } from '../src/lib/active.ts';

const monthly: Top10Data = {
  meta: { ym: '202608', updated: '', source: '' },
  etfs: {
    '0050': { name: '元大台灣卓越50', rows: [[1, '國內上市', '2330', '台積電', 57.35], [2, '國內上市', '2454', '聯發科', 5.64]] },
    '00625': { name: '富邦上証', rows: [[1, '國外', 'X', 'Y', 10]] },
    '00981A': { name: '統一台股增長', rows: [[1, '國內上市', '2330', '台積電', 9]] },
  },
};
const active: ActiveData = {
  meta: { updated: '', minChange: 0.005, blocked: [], source: '', errors: [] },
  etfs: {
    '00981A': { name: '', issuer: '', asof: '2026-09-23', changes: [],
                holdings: [['2454', '聯發科', 1, 3], ['2330', '台積電', 1, 10], ['TX 2026/10', '台指期貨', 1, 2]] },
  },
};

test('月報：一般 ETF 用公會的前十大', () => {
  const v = top10For('0050', monthly, active)!;
  assert.equal(v.kind, 'monthly');
  assert.equal(v.asof, '2026/08');
  assert.equal(v.rows[0].name, '台積電');
  assert.equal(v.total!.toFixed(2), '62.99');
});

test('站上有每日持股的主動式 ETF 優先用每日的，依權重排', () => {
  const v = top10For('00981A', monthly, active)!;
  assert.equal(v.kind, 'daily');
  assert.equal(v.asof, '2026-09-23');
  assert.deepEqual(v.rows.map(r => r.code), ['2330', '2454', 'TX 2026/10']);
});

test('雙幣別代號（00625K）退回本尊', () => {
  assert.equal(top10For('00625K', monthly, null)?.rows[0].code, 'X');
});

test('查不到時回 null，說明依分區給原因', () => {
  assert.equal(top10For('00631L', monthly, null), null);
  assert.match(missingReason('cat-leveraged'), /期貨/);
  assert.match(missingReason('cat-domestic'), /公會/);
});

const PATH = new URL('../public/data/top10.json', import.meta.url);

test('真實 top10.json', { skip: !existsSync(PATH) && '沒有 top10.json' }, async (t) => {
  const d = JSON.parse(readFileSync(PATH, 'utf8')) as Top10Data;
  const etfs = JSON.parse(readFileSync(new URL('../public/data/etfs.json', import.meta.url), 'utf8'))
    .etfs as { code: string; sec: string }[];

  await t.test('每檔最多十名、名次從 1 開始、比例在 0～100', () => {
    for (const [code, e] of Object.entries(d.etfs)) {
      assert.ok(e.rows.length >= 1 && e.rows.length <= 10, `${code} 有 ${e.rows.length} 名`);
      assert.equal(e.rows[0][0], 1, `${code} 第一名不是 1`);
      for (const r of e.rows) if (r[4] !== null) assert.ok(r[4] >= -100 && r[4] <= 100, `${code} ${r[3]} ${r[4]}`);
    }
  });

  await t.test('股票型的 ETF 大多查得到（對照表壞掉時會整片消失）', () => {
    const stock = etfs.filter(e => e.sec === 'cat-domestic');
    const hit = stock.filter(e => top10For(e.code, d, null)).length;
    assert.ok(hit / stock.length > 0.85, `台股型只對到 ${hit}/${stock.length}`);
  });
});
