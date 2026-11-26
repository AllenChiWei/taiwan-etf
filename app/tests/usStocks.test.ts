/* 美股個股清單解析（lib/usStocks.ts）、自由輸入美股代號驗證與未配息美股個股試算。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCustomUsTicker,
  parseUsStocksDataset,
  usStockNameMap,
} from '../src/lib/usStocks.ts';
import { seriesFromUs, type UsPriceRow } from '../src/lib/usDividend.ts';
import { projectHolding } from '../src/lib/dividend.ts';

test('parseUsStocksDataset：解析精簡 tuple 格式、正規化代號並略過異常列', () => {
  const parsed = parseUsStocksDataset({
    meta: { updated: '2026-11-27', asof: '2026-11-26', count: 2, source: 'FinMind USStockInfo' },
    stocks: [
      [' ant ', 'Anthropic PBC Class A', 1.05e12],
      ['NVDA', 'NVIDIA Corporation', 3.5e12],
      ['ANT', 'Duplicate should be ignored', 1e9],
      ['', 'Missing code', 5e8],
      ['BAD_MCAP', 'No Cap Stock', 'invalid'],
      null,
      ['ONLY_ONE'],
    ],
  });
  assert.ok(parsed);
  assert.equal(parsed.meta.updated, '2026-11-27');
  assert.equal(parsed.meta.source, 'FinMind USStockInfo');
  assert.equal(parsed.stocks.length, 3);
  assert.deepEqual(parsed.stocks[0], { code: 'ANT', name: 'Anthropic PBC Class A', mcap: 1.05e12 });
  assert.deepEqual(parsed.stocks[1], { code: 'NVDA', name: 'NVIDIA Corporation', mcap: 3.5e12 });
  assert.deepEqual(parsed.stocks[2], { code: 'BAD_MCAP', name: 'No Cap Stock', mcap: 0 });

  const names = usStockNameMap(parsed);
  assert.equal(names.get('ANT'), 'Anthropic PBC Class A');
  assert.equal(usStockNameMap(null).size, 0);

  assert.equal(parseUsStocksDataset(null), null);
  assert.equal(parseUsStocksDataset({}), null);
  assert.equal(parseUsStocksDataset({ stocks: 'not-array' }), null);
});

test('parseCustomUsTicker：接受合法美股代號格式，排除台股純數字與不合法字串', () => {
  assert.equal(parseCustomUsTicker('ant'), 'ANT');
  assert.equal(parseCustomUsTicker(' ANT '), 'ANT');
  assert.equal(parseCustomUsTicker('A'), 'A');
  assert.equal(parseCustomUsTicker('brk.b'), 'BRK.B');
  assert.equal(parseCustomUsTicker('brk-b'), 'BRK-B');
  assert.equal(parseCustomUsTicker('AI2'), 'AI2');
  assert.equal(parseCustomUsTicker('ABCDEF'), 'ABCDEF');

  assert.equal(parseCustomUsTicker(''), null);
  assert.equal(parseCustomUsTicker('2330'), null);
  assert.equal(parseCustomUsTicker('0050'), null);
  assert.equal(parseCustomUsTicker('00988A'), null);
  assert.equal(parseCustomUsTicker('2887E'), null);
  assert.equal(parseCustomUsTicker('台積電'), null);
  assert.equal(parseCustomUsTicker('ABCDEFG'), null);
  assert.equal(parseCustomUsTicker('ANT.'), null);
  assert.equal(parseCustomUsTicker('-ANT'), null);
  assert.equal(parseCustomUsTicker('A..B'), null);
  assert.equal(parseCustomUsTicker('A B'), null);
});

test('未配息美股個股（如 ANT 剛上市）：年配息為 0、頻率顯示近一年未配息、市值照常算入', () => {
  const antRows: UsPriceRow[] = [
    { date: '2026-11-19', Close: 112.5, Adj_Close: 112.5 },
    { date: '2026-11-20', Close: 118.0, Adj_Close: 118.0 },
    { date: '2026-11-25', Close: 120.0, Adj_Close: 120.0 },
  ];
  const months = ['2026-09', '2026-10', '2026-11'];
  const proj = projectHolding(seriesFromUs('ANT', 'Anthropic PBC Class A', antRows, 32.0, months), months, 10);
  assert.equal(proj.latest, 0);
  assert.equal(proj.annual, 0);
  assert.equal(proj.freq, '近一年未配息');
  assert.equal(proj.price, 3840);
  assert.equal(proj.value, 38400);
});
