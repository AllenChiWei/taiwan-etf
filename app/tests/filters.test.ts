/* 對 src/lib/filters.ts 的真實函式測試（不是複製一份邏輯來測）。
 *
 *   npm test
 *
 * Node 24 能直接載入 .ts，所以不需要建置步驟或測試框架。
 * filters.ts 不碰 React 也不碰 DOM —— 那正是把它獨立出來的理由。 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  matchesQuery, filterEtfs, toNumber, sortEtfs,
  groupBySection, activeFilterCount, compareNumeric,
} from '../src/lib/filters.ts';
import { returnTone, yieldClass, freqPillClass } from '../src/lib/format.ts';
import type { Etf, EtfDataset, Section } from '../src/types.ts';

const mk = (code: string, o: Partial<Etf> = {}): Etf => ({
  code,
  name: o.name ?? `基金${code}`,
  cust: o.cust ?? '某某銀行',
  freq: o.freq ?? '月配',
  sec: o.sec ?? 'cat-domestic',
  yield: o.yield ?? '1.00',
  r3: o.r3 ?? '1.00',
  r6: o.r6 ?? '1.00',
  r12: o.r12 ?? '1.00',
  r36: o.r36 ?? '1.00',
  r60: o.r60 ?? '1.00',
});

describe('搜尋', () => {
  test('比對代號、名稱、保管銀行', () => {
    assert.ok(matchesQuery(mk('0050'), '0050'));
    assert.ok(matchesQuery(mk('00878'), '878'));
    assert.ok(matchesQuery(mk('0050', { name: '元大台灣50' }), '元大'));
    assert.ok(matchesQuery(mk('0050', { cust: '中國信託商業銀行' }), '中國信託'));
  });

  test('不比對數字欄位（舊版比對整列導致搜尋失效的回歸測試）', () => {
    const e = mk('0050', {
      name: '元大台灣50', cust: '中國信託商業銀行',
      yield: '9.73', r3: '8.52', r6: '38.56', r12: '98.17',
    });
    assert.ok(!matchesQuery(e, '9.73'), '殖利率不該被搜尋命中');
    assert.ok(!matchesQuery(e, '38.56'), '報酬率不該被搜尋命中');
    assert.ok(matchesQuery(e, '50'), '代號裡的 50 仍應命中');
  });

  test('空字串與純空白視為不篩選', () => {
    assert.ok(matchesQuery(mk('0050'), ''));
    assert.ok(matchesQuery(mk('0050'), '   '));
  });

  test('大小寫不敏感', () => {
    assert.ok(matchesQuery(mk('00662', { name: 'FH 那斯達克' }), 'fh'));
    assert.ok(matchesQuery(mk('00757B'), '00757b'));
  });
});

describe('篩選組合', () => {
  const pool = [
    mk('0050', { cust: 'A銀行', freq: '半年配', sec: 'cat-domestic' }),
    mk('0056', { cust: 'B銀行', freq: '季配', sec: 'cat-domestic' }),
    mk('00679B', { cust: 'A銀行', freq: '季配', sec: 'cat-bond' }),
    mk('00631L', { cust: 'B銀行', freq: '—', sec: 'cat-leveraged' }),
  ];

  test('四個條件是 AND 關係', () => {
    assert.equal(filterEtfs(pool, { cust: 'A銀行' }).length, 2);
    assert.equal(filterEtfs(pool, { cust: 'A銀行', freq: '季配' }).length, 1);
    assert.equal(filterEtfs(pool, { cust: 'A銀行', freq: '季配', sec: 'cat-domestic' }).length, 0);
  });

  test('下拉是完全相等比對，不是子字串', () => {
    assert.equal(filterEtfs(pool, { cust: 'A' }).length, 0);
    assert.equal(filterEtfs(pool, { freq: '配' }).length, 0);
  });

  test('codes 參數限定收藏清單', () => {
    assert.equal(filterEtfs(pool, {}, ['0050', '00631L']).length, 2);
    assert.equal(filterEtfs(pool, {}, []).length, 0);
    assert.equal(filterEtfs(pool, {}, null).length, 4);
  });
});

describe('數值解析', () => {
  test('toNumber 處理 N/A、空值、破折號、千分位', () => {
    assert.equal(toNumber('12.5'), 12.5);
    assert.equal(toNumber('-3.2'), -3.2);
    assert.equal(toNumber('1,234.5'), 1234.5);
    assert.equal(toNumber('N/A'), null);
    assert.equal(toNumber(''), null);
    assert.equal(toNumber(null), null);
    assert.equal(toNumber('—'), null);
  });

  test('compareNumeric 把 N/A 排在後面', () => {
    assert.ok(compareNumeric('1', 'N/A') < 0);
    assert.ok(compareNumeric('N/A', '1') > 0);
    assert.equal(compareNumeric('N/A', 'N/A'), 0);
  });
});

describe('排序', () => {
  const pool = [
    mk('AAA', { r12: '10' }),
    mk('BBB', { r12: 'N/A' }),
    mk('CCC', { r12: '-5' }),
    mk('DDD', { r12: '10' }),
    mk('EEE', { r12: 'N/A' }),
  ];

  test('降冪：大到小，N/A 沉底', () => {
    assert.deepEqual(
      sortEtfs(pool, { key: 'r12', dir: 'desc' }).map(e => e.code),
      ['AAA', 'DDD', 'CCC', 'BBB', 'EEE'],
    );
  });

  test('升冪：小到大，N/A 仍沉底（不是浮頂）', () => {
    assert.deepEqual(
      sortEtfs(pool, { key: 'r12', dir: 'asc' }).map(e => e.code),
      ['CCC', 'AAA', 'DDD', 'BBB', 'EEE'],
    );
  });

  test('數值相同時維持代號順序（穩定排序）', () => {
    const got = sortEtfs(pool, { key: 'r12', dir: 'desc' }).map(e => e.code);
    assert.ok(got.indexOf('AAA') < got.indexOf('DDD'));
  });

  test('null spec 還原成代號順序', () => {
    assert.deepEqual(sortEtfs(pool, null).map(e => e.code), ['AAA', 'BBB', 'CCC', 'DDD', 'EEE']);
  });

  test('不改動原陣列', () => {
    const before = pool.map(e => e.code);
    sortEtfs(pool, { key: 'r12', dir: 'desc' });
    assert.deepEqual(pool.map(e => e.code), before);
  });
});

describe('顏色慣例（台股：紅漲綠跌）', () => {
  test('正報酬 up、負報酬 down、零 flat、N/A na', () => {
    assert.equal(returnTone('5.2'), 'up');
    assert.equal(returnTone('-5.2'), 'down');
    assert.equal(returnTone('0'), 'flat');
    assert.equal(returnTone('N/A'), 'na');
  });

  test('殖利率有值用自己的顏色，N/A 轉灰', () => {
    assert.match(yieldClass('3.2'), /text-yield/);
    assert.match(yieldClass('N/A'), /text-na/);
  });

  test('每個配息頻率都有對應的標籤樣式', () => {
    for (const f of ['月配', '雙月配', '季配', '半年配', '年配', '—'] as const) {
      assert.match(freqPillClass(f), /^pill-/, `${f} 沒有樣式`);
    }
  });
});

describe('分組', () => {
  const sections: Section[] = [
    { id: 'cat-domestic', title: '台股ETF', count: 87 },
    { id: 'cat-bond', title: '債券ETF', count: 112 },
    { id: 'cat-leveraged', title: '槓桿/反向ETF', count: 33 },
  ];

  test('依 sections 定義的順序分組，空分區略過', () => {
    const got = groupBySection(
      [mk('A', { sec: 'cat-bond' }), mk('B', { sec: 'cat-domestic' })], sections);
    assert.deepEqual(got.map(s => s.id), ['cat-domestic', 'cat-bond']);
    assert.equal(got[0].rows.length, 1);
  });

  test('未知分區不會憑空生出一區', () => {
    const got = groupBySection([mk('A', { sec: 'cat-domestic' })], []);
    assert.equal(got.length, 0);
  });
});

describe('篩選計數', () => {
  test('只計下拉與排序，不含搜尋', () => {
    assert.equal(activeFilterCount({ q: 'abc' }, null), 0);
    assert.equal(activeFilterCount({ cust: 'A', freq: '月配' }, null), 2);
    assert.equal(activeFilterCount({ cust: 'A', freq: '月配', sec: 'x' }, { key: 'r3', dir: 'desc' }), 4);
  });
});

describe('真實資料（public/data/etfs.json）', () => {
  const data = JSON.parse(
    readFileSync(new URL('../public/data/etfs.json', import.meta.url), 'utf8'),
  ) as EtfDataset;

  test('筆數與 meta 相符且不為空', () => {
    assert.equal(data.etfs.length, data.meta.total);
    assert.ok(data.etfs.length > 300, `只有 ${data.etfs.length} 筆`);
  });

  test('分區宣告的檔數與實際列數相符', () => {
    for (const s of data.sections) {
      const actual = data.etfs.filter(e => e.sec === s.id).length;
      assert.equal(actual, s.count, `${s.title} 宣告 ${s.count} 實際 ${actual}`);
    }
  });

  test('每檔的保管銀行都有對應的篩選選項', () => {
    const opts = new Set([...data.custodians, '—']);
    const bad = data.etfs.filter(e => !opts.has(e.cust));
    assert.equal(bad.length, 0, bad.slice(0, 3).map(e => `${e.code}:${e.cust}`).join(', '));
  });

  test('每個配息頻率都有標籤樣式', () => {
    for (const f of new Set(data.etfs.map(e => e.freq))) {
      assert.match(freqPillClass(f), /^pill-/, `${f} 沒有樣式`);
    }
  });

  test('搜尋 0050 找得到元大台灣50', () => {
    assert.ok(filterEtfs(data.etfs, { q: '0050' }).some(e => e.code === '0050'));
  });

  test('依殖利率降冪，第一名確實是最高的', () => {
    const sorted = sortEtfs(data.etfs, { key: 'yield', dir: 'desc' });
    const nums = data.etfs.map(e => toNumber(e.yield)).filter((n): n is number => n !== null);
    assert.equal(toNumber(sorted[0].yield), Math.max(...nums));
  });

  test('排序後 N/A 全部落在尾端', () => {
    const sorted = sortEtfs(data.etfs, { key: 'r12', dir: 'desc' });
    const firstNA = sorted.findIndex(e => toNumber(e.r12) === null);
    if (firstNA >= 0) {
      assert.ok(sorted.slice(firstNA).every(e => toNumber(e.r12) === null), 'N/A 之後還混著數值');
    }
  });
});
