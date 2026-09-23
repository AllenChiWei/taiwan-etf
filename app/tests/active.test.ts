/* 主動式 ETF 換股與即將上市的測試，外加對真實資料的檢查。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  kindOf, netChange, groupChanges, consensus, sharesLabel, aggregateTop,
  type ActiveData, type ChangeDay,
} from '../src/lib/active.ts';
import { stillUpcoming, daysUntil, taipeiToday, pick, type UpcomingItem } from '../src/lib/upcoming.ts';

test('換股分類要扣掉資金進出', async (t) => {
  await t.test('新增與剔除', () => {
    assert.equal(kindOf(['2330', '台積電', 0, 1000, 5], 0), 'new');
    assert.equal(kindOf(['2330', '台積電', 1000, 0, 0], 0), 'out');
  });

  await t.test('資金流入 10% 那天，股數只多 5% 其實是減碼', () => {
    // 所有持股同比例多了 10%（資金流入），這檔只多 5% —— 經理人相對調降了它
    const it: [string, string, number, number, number] = ['2330', '台積電', 1000, 1050, 5];
    assert.equal(kindOf(it, 0.10), 'cut');
    assert.equal(netChange(it, 0.10)!.toFixed(4), (1050 / 1100 - 1).toFixed(4));
    assert.equal(kindOf(it, 0), 'add');
  });

  await t.test('新增與剔除沒有百分比', () => {
    assert.equal(netChange(['x', 'x', 0, 10, 1], 0), null);
  });

  await t.test('分組：加碼依幅度、新增依權重排序', () => {
    const day: ChangeDay = { d: 'b', p: 'a', f: 0, items: [
      ['1', 'a', 100, 110, 1], ['2', 'b', 100, 150, 1], ['3', 'c', 0, 5, 2], ['4', 'd', 0, 5, 9],
      ['5', 'e', 100, 50, 1], ['6', 'f', 100, 0, 0],
    ] };
    const g = groupChanges(day);
    assert.deepEqual(g.add.map(r => r[0]), ['2', '1']);
    assert.deepEqual(g.new.map(r => r[0]), ['4', '3']);
    assert.deepEqual(g.cut.map(r => r[0]), ['5']);
    assert.deepEqual(g.out.map(r => r[0]), ['6']);
  });
});

test('幾檔一起動：只算全體最新那一天，至少兩檔', () => {
  const etf = (d: string, items: ChangeDay['items']) =>
    ({ name: '', issuer: '', asof: d, holdings: [], changes: [{ d, p: 'x', f: 0, items }] });
  const data: ActiveData = {
    meta: { updated: '', minChange: 0.005, blocked: [], source: '', errors: [] },
    etfs: {
      A: etf('2026-09-23', [['2330', '台積電', 0, 10, 1], ['2454', '聯發科', 10, 0, 0]]),
      B: etf('2026-09-23', [['2330', '台積電', 100, 200, 1]]),
      // 落後一天的不算，否則會把昨天的減碼跟今天的加碼混在一起
      C: etf('2026-09-22', [['2330', '台積電', 100, 0, 0]]),
    },
  };
  const c = consensus(data);
  assert.equal(c.date, '2026-09-23');
  assert.equal(c.rows.length, 1);
  assert.deepEqual(c.rows[0].buy, ['A', 'B']);
  assert.deepEqual(c.rows[0].sell, []);
});

test('市值前十合計持股：權重 × 市值加總，期貨不算', () => {
  const e = (cap: number, top: boolean, holdings: [string, string, number, number][]) =>
    ({ name: '', issuer: '', asof: '', cap, top, holdings, changes: [] });
  const data: ActiveData = {
    meta: { updated: '', minChange: 0.005, source: '', errors: [],
            blocked: [{ code: 'Z', name: '擋掉的', reason: '403', cap: 50, top: true }] },
    etfs: {
      A: e(1000, true, [['2330', '台積電', 1, 10], ['TX 2026/10', '台指期貨', 1, 5]]),
      B: e(100, true, [['2330', '台積電', 1, 50], ['2454', '聯發科', 1, 20]]),
      C: e(9999, false, [['9999', '不在前十', 1, 90]]),
    },
  };
  const agg = aggregateTop(data);
  // 台積電 = 1000×10% + 100×50% = 150 億，佔 1100 億的 13.64%
  assert.equal(agg.rows[0].code, '2330');
  assert.equal(agg.rows[0].amount, 150);
  assert.equal(agg.rows[0].share.toFixed(2), '13.64');
  assert.deepEqual(agg.rows[0].etfs, ['A', 'B']);
  assert.ok(!agg.rows.some(r => r.code.startsWith('TX')), '期貨不該算進去');
  assert.ok(!agg.rows.some(r => r.code === '9999'), '不在前十的 ETF 不該算進去');
  assert.deepEqual(agg.missing.map(m => m.code), ['Z']);
});

test('股數顯示：台股用張、期貨用口、海外股票用股', () => {
  assert.equal(sharesLabel('2330', 3_800_000), '3,800 張');
  assert.equal(sharesLabel('TX', 679, '台指期貨'), '679 口');
  // 美股代號也是字母，不能因為「不是數字」就當成期貨
  assert.equal(sharesLabel('PLTR', 12_000, 'PALANTIR TECHNOLOGIES INC-A'), '12,000 股');
});

test('還沒上市的 ETF', async (t) => {
  const item = (code: string, listing: string | null): UpcomingItem => ({
    code, name: null, issuer: null, raise: null, listing, stage: 'raising',
    source: 'news', url: null, fields: [], news: [],
  });

  await t.test('已上市的不列（上市日是今天或更早的濾掉），沒有上市日的留著', () => {
    const got = stillUpcoming([item('A', '2026-10-13'), item('B', '2026-09-23'),
                               item('C', '2026-08-21'), item('D', null)], '2026-09-23');
    assert.deepEqual(got.map(x => x.code), ['A', 'D']);
  });

  await t.test('距離上市幾天', () => {
    assert.equal(daysUntil('2026-10-13', '2026-09-23'), 20);
    assert.equal(daysUntil(null, '2026-09-23'), null);
  });

  await t.test('台北的今天不受瀏覽器時區影響', () => {
    // UTC 9/22 20:00 = 台北 9/23 04:00
    assert.equal(taipeiToday(new Date('2026-09-22T20:00:00Z')), '2026-09-23');
  });

  await t.test('欄位用關鍵字找，欄名不固定', () => {
    const f: [string, string][] = [['發行ETF投信公司名稱', '大華銀'], ['管理費率', '0.30%']];
    assert.equal(pick(f, '投信公司', '經理公司'), '大華銀');
    assert.equal(pick(f, '追蹤指數'), null);
  });
});

const UPCOMING = new URL('../public/data/upcoming.json', import.meta.url);

test('真實 upcoming.json：不含已上市的，而且只存標題與連結', { skip: !existsSync(UPCOMING) && '沒有 upcoming.json' }, () => {
  const d = JSON.parse(readFileSync(UPCOMING, 'utf8'));
  const etfs = new URL('../public/data/etfs.json', import.meta.url);
  const listed = new Set((JSON.parse(readFileSync(etfs, 'utf8')).etfs as { code: string }[]).map(e => e.code));
  for (const it of d.items as UpcomingItem[]) {
    assert.ok(!listed.has(it.code), `${it.code} 已經在台股清單裡，不該出現在還沒上市的清單`);
    for (const n of it.news) {
      assert.equal(n.length, 3, `${it.code} 的新聞多存了東西（只能有標題、連結、日期）`);
      assert.ok(n[0].length < 120, `${it.code} 的新聞標題長得像內文`);
    }
  }
});

const ACTIVE = new URL('../public/data/active_holdings.json', import.meta.url);

test('真實 active_holdings.json', { skip: !existsSync(ACTIVE) && '沒有 active_holdings.json' }, async (t) => {
  const d = JSON.parse(readFileSync(ACTIVE, 'utf8')) as ActiveData;

  await t.test('每檔都有持股，權重加起來合理', () => {
    for (const [code, e] of Object.entries(d.etfs)) {
      assert.ok(e.holdings.length >= 5, `${code} 只有 ${e.holdings.length} 檔持股`);
      const sum = e.holdings.reduce((a, h) => a + h[3], 0);
      // 股票＋期貨的權重合計；主動式常持有期貨，所以上限放寬
      assert.ok(sum > 50 && sum < 130, `${code} 權重合計 ${sum}`);
    }
  });

  await t.test('換股紀錄照日期排序，而且每一天都晚於它比較的那天', () => {
    for (const [code, e] of Object.entries(d.etfs)) {
      for (let i = 0; i < e.changes.length; i++) {
        const c = e.changes[i];
        assert.ok(c.d > c.p, `${code} ${c.d} 比的是更晚的 ${c.p}`);
        if (i) assert.ok(c.d > e.changes[i - 1].d, `${code} 的換股紀錄沒排序`);
      }
    }
  });

  await t.test('資金進出比例在合理範圍（單日 ±50% 以上代表比錯了日子）', () => {
    for (const [code, e] of Object.entries(d.etfs)) {
      for (const c of e.changes) assert.ok(Math.abs(c.f) < 0.5, `${code} ${c.d} 的 f=${c.f}`);
    }
  });
});
