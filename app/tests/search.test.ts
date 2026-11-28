/* 全站快速搜尋（2026-10-26）。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { norm, searchAll, PAGES, usEtfSearchItems, cbSearchItems, type SearchItem } from '../src/lib/search.ts';

const items: SearchItem[] = [
  ...PAGES,
  { kind: 'etf', code: '0056', name: '元大高股息', to: '/', search: { q: '0056' } },
  { kind: 'etf', code: '00878', name: '國泰永續高股息', to: '/', search: { q: '00878' } },
  { kind: 'etf', code: '0050', name: '元大台灣50', to: '/', search: { q: '0050' } },
  { kind: 'stock', code: '2330', name: '台積電', keywords: '半導體業', to: '/stock', search: { code: '2330' } },
  { kind: 'stock', code: '0056', name: '（假的同代號個股）', to: '/stock', search: { code: '0056' } },
];

test('全形與空白：中文輸入法打的代號也找得到', () => {
  assert.equal(norm('００５６ '), '0056');
  assert.equal(searchAll(items, '００５６')[0].code, '0056');
});

test('排序：代號完全相同 > 代號開頭 > 名稱；同分 ETF 排在個股前面', () => {
  const r = searchAll(items, '005');
  assert.deepEqual(r.slice(0, 3).map(x => x.code), ['0050', '0056', '0056']);
  assert.equal(r[1].kind, 'etf');
  assert.equal(searchAll(items, '0056')[0].kind, 'etf');
  assert.equal(searchAll(items, '高股息')[0].code, '0056', '名稱開頭優先於名稱包含');
  assert.equal(searchAll(items, '台積')[0].code, '2330');
});

test('頁面靠關鍵字也找得到；空字串只列頁面', () => {
  assert.equal(searchAll(items, '經理人')[0].name, '主動式換股');
  assert.deepEqual(searchAll(items, '經理人')[0].search, { view: 'active' });
  assert.equal(searchAll(items, '市值走勢')[0].to, '/dividend');
  assert.deepEqual(searchAll(items, '市值走勢')[0].search, { view: 'value' });
  assert.ok(searchAll(items, '').every(x => x.kind === 'page'));
  assert.equal(searchAll(items, 'zzzz').length, 0);
});

test('美股 ETF 與可轉債搜尋：路由、流動性優先度與交換債防誤對', () => {
  const us = usEtfSearchItems([
    { code: 'AAA', name: 'Alpha S&P 500 ETF', liquid: false },
    { code: 'VOO', name: 'Vanguard S&P 500 ETF', liquid: true },
  ]);
  const cb = cbSearchItems([
    { c: '23082', n: '台達電二', s: '2308', sn: '台達電', ind: '電子零組件業', exch: false },
    { c: '11011E', n: '交換債樣本', s: '1101', sn: '某公司', ind: '其他', exch: true },
  ]);
  const all = [...items, ...us, ...cb];

  const hitVoo = searchAll(all, 'ｖｏｏ')[0];
  assert.equal(hitVoo.kind, 'us');
  assert.equal(hitVoo.to, '/etf');
  assert.deepEqual(hitVoo.search, { code: 'VOO' });

  const hitSp = searchAll(all, 'S&P 500');
  assert.equal(hitSp[0].code, 'VOO', '同分美股 ETF 有流動性者排前面');

  const hitCb = searchAll(all, '23082')[0];
  assert.equal(hitCb.kind, 'cb');
  assert.equal(hitCb.to, '/cb');
  assert.deepEqual(hitCb.search, { code: '23082' });

  assert.equal(searchAll(all, '台達電')[0].code, '23082');
  assert.equal(searchAll(all, '電子零組件')[0].code, '23082');
  assert.equal(searchAll(all, '1101').some(x => x.code === '11011E'), true, '債券代號本身開頭仍可搜到');
  assert.equal(cb[1].keywords?.includes('1101'), false, '交換債不附前四碼 s 進 keywords');
});
