/* 個股頁的純函式。重點在兩件會出大錯的事：季報是累計數、金額單位是千元。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

import {
  parsePeriod, periodLabel, singleQuarter, pct, ratios, toLots,
  sumInst, instTotals, moneyFromThousands, moneyFromYuan, isoDate,
  type Quarter, type StockChips, type StockIndex, type StockData,
} from '../src/lib/stock.ts';

/* ── 期別 ───────────────────────────────────────────────── */

test('期別解析與說法', async (t) => {
  await t.test('Q2 要講成上半年累計，不是第二季', () => {
    assert.equal(periodLabel('2026Q2'), '2026 上半年（累計）');
    assert.equal(periodLabel('2026Q3'), '2026 前三季（累計）');
    assert.equal(periodLabel('2026Q1'), '2026 第一季');
    assert.equal(periodLabel('2026Q4'), '2026 全年（累計）');
  });

  await t.test('看不懂的期別原樣回傳，不要猜', () => {
    assert.equal(periodLabel('亂寫'), '亂寫');
    assert.equal(parsePeriod('2026Q5'), null);
  });
});

test('把累計數還原成單季', async (t) => {
  const rows: Quarter[] = [
    { p: '2026Q1', rev: 1000, ni: 100, eps: 1.5, ta: 9000, bv: 50 },
    { p: '2026Q2', rev: 2400, ni: 260, eps: 3.9, ta: 9500, bv: 52 },
  ];

  await t.test('Q2 減 Q1', () => {
    const q = singleQuarter(rows, '2026Q2')!;
    assert.equal(q.rev, 1400);
    assert.equal(q.ni, 160);
    assert.equal(q.eps, 2.4);
  });

  await t.test('資產負債表是時點數，不相減', () => {
    const q = singleQuarter(rows, '2026Q2')!;
    assert.equal(q.ta, 9500);
    assert.equal(q.bv, 52);
  });

  await t.test('Q1 本身就是單季', () => {
    assert.equal(singleQuarter(rows, '2026Q1')!.rev, 1000);
  });

  await t.test('沒有前一期就回 null —— 那是算不出來，不是 0', () => {
    assert.equal(singleQuarter([rows[1]], '2026Q2'), null);
  });

  await t.test('缺值的欄位維持缺值，不要變成 0', () => {
    const q = singleQuarter([
      { p: '2026Q1', rev: 1000 },
      { p: '2026Q2', rev: 2400, ni: 260 },
    ], '2026Q2')!;
    assert.equal(q.rev, 1400);
    assert.equal(q.ni, null);
  });
});

/* ── 比率 ───────────────────────────────────────────────── */

test('比率', async (t) => {
  await t.test('百分比取到小數兩位', () => {
    assert.equal(pct(1611606116, 2404483690), 67.03);
  });

  await t.test('分母是 0、負數或缺值時回 null', () => {
    assert.equal(pct(100, 0), null);
    assert.equal(pct(100, -50), null);
    assert.equal(pct(100, null), null);
    assert.equal(pct(null, 100), null);
  });

  await t.test('從損益表與資產負債表算出五個比率', () => {
    const r = ratios({ p: '2026Q2', rev: 1000, gp: 400, op: 250, ni: 200,
                       ta: 5000, tl: 2000, ca: 1500, cl: 750, eq: 3000 });
    assert.equal(r.gm, 40);
    assert.equal(r.om, 25);
    assert.equal(r.pm, 20);
    assert.equal(r.debt, 40);
    assert.equal(r.current, 200);
    assert.deepEqual(r.roe, 6.67);
  });

  await t.test('沒有資料時每個比率都是 null', () => {
    const r = ratios(null);
    assert.deepEqual(Object.values(r), [null, null, null, null, null, null]);
  });
});

/* ── 籌碼 ───────────────────────────────────────────────── */

function chips(over: Partial<StockChips> = {}): StockChips {
  return {
    date: '2026-09-17',
    days: ['2026-09-15', '2026-09-16', '2026-09-17'],
    inst: [[1000, 500, -200], null, [-3000, 100, 50]],
    ...over,
  };
}

test('三大法人累計', async (t) => {
  await t.test('沒有資料的日子跳過，並回報實際天數', () => {
    const s = sumInst(chips(), 3);
    assert.equal(s.foreign, -2000);
    assert.equal(s.trust, 600);
    assert.equal(s.dealer, -150);
    assert.equal(s.days, 2, '三天裡只有兩天有資料');
  });

  await t.test('近 n 日取的是最後 n 天', () => {
    const s = sumInst(chips(), 1);
    assert.equal(s.foreign, -3000);
    assert.equal(s.days, 1);
  });

  await t.test('每日合計保留 null，圖上才不會畫出不存在的暴跌', () => {
    assert.deepEqual(instTotals(chips()), [1300, null, -2850]);
  });
});

test('股轉張', () => {
  assert.equal(toLots(53_222_717), 53222.717);
  assert.equal(toLots(null), null);
});

/* ── 顯示 ───────────────────────────────────────────────── */

test('金額換算', async (t) => {
  await t.test('財報是千元：台積電 2026Q2 累計營收 2.40 兆', () => {
    assert.equal(moneyFromThousands(2_404_483_690), '2.40 兆');
  });

  await t.test('同一份資料的月營收是 5,148 億，不是 5.15 兆', () => {
    // 千元換算的常數寫錯十倍時畫面仍然「看起來正常」，所以用實際數字釘住
    assert.equal(moneyFromThousands(514_805_337), '5148.1 億');
  });

  await t.test('億與千元的界線', () => {
    assert.equal(moneyFromThousands(100_000), '1.0 億');
    assert.equal(moneyFromThousands(99_999), '99,999 千元');
  });

  await t.test('股本是「元」，用另一個換算', () => {
    assert.equal(moneyFromYuan(259_323_700_670), '2593.24 億');
    assert.equal(moneyFromYuan(50_000), '5.0 萬');
  });

  await t.test('缺值一律破折號', () => {
    assert.equal(moneyFromThousands(null), '—');
    assert.equal(moneyFromYuan(undefined), '—');
    assert.equal(isoDate(null), '—');
  });

  await t.test('民國式的八位日期轉 ISO', () => {
    assert.equal(isoDate('19940905'), '1994-09-05');
    assert.equal(isoDate('123'), '—');
  });
});

/* ── 對真實資料的檢查 ───────────────────────────────────── */

const DIR = new URL('../public/data/stocks/', import.meta.url);
const INDEX = new URL('index.json', DIR);

test('真實個股資料', { skip: !existsSync(INDEX) && '沒有個股資料（部署時才產生）' },
  async (t) => {
    const index = JSON.parse(readFileSync(INDEX, 'utf8')) as StockIndex;

    await t.test('清單有上市也有上櫃，代號格式正確', () => {
      assert.ok(index.stocks.length > 1000, '個股太少，抓取可能只成功一半');
      const markets = new Set(index.stocks.map(s => s.m));
      assert.ok(markets.has('上市') && markets.has('上櫃'), [...markets].join('/'));
      for (const s of index.stocks) {
        assert.match(s.c, /^\d{4,6}$/, `奇怪的代號：${s.c}`);
      }
    });

    await t.test('每一檔清單裡的個股都有對應的檔案', () => {
      const files = new Set(readdirSync(DIR).map(f => f.replace('.json', '')));
      const missing = index.stocks.filter(s => !files.has(s.c)).map(s => s.c);
      assert.deepEqual(missing, [], `清單有但檔案沒有：${missing.slice(0, 5)}`);
    });

    await t.test('台積電的數字對得上公開資訊', () => {
      const tsmc = JSON.parse(
        readFileSync(new URL('2330.json', DIR), 'utf8')) as StockData;
      assert.equal(tsmc.info.name, '台積電');
      assert.equal(tsmc.info.market, '上市');
      const q = tsmc.q[tsmc.q.length - 1];
      // 累計營收除以累計月營收應該在同一個數量級；差一倍就是把累計當單季了
      const m = tsmc.m[tsmc.m.length - 1];
      assert.ok(q.rev! > 0 && m.cum! > 0);
      assert.ok(q.rev! / m.cum! > 0.4 && q.rev! / m.cum! < 1.1,
        `季報營收與累計月營收的比例異常：${q.rev} / ${m.cum}`);
    });

    await t.test('籌碼的天數與每日資料長度一致', () => {
      const tsmc = JSON.parse(
        readFileSync(new URL('2330.json', DIR), 'utf8')) as StockData;
      assert.equal(tsmc.chips.inst.length, tsmc.chips.days.length);
    });
  });
