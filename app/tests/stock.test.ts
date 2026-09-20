/* 個股頁的純函式。重點在兩件會出大錯的事：季報是累計數、金額單位是千元。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

import {
  parsePeriod, periodLabel, singleQuarter, pct, ratios, toLots,
  sumInst, instTotals, moneyFromThousands, moneyFromYuan, isoDate,
  rankRevenue, filterHighs, impliedBase, rankReturns,
  type Quarter, type StockChips, type StockIndex, type StockData, type HighRow, type HighWindow,
  instDaily, periodReturns, position, percentiles,
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

/* ── 排行與創新高 ───────────────────────────────────────── */

test('營收排行', async (t) => {
  const rows = [
    { c: '1101', n: '大公司', m: '上市', i: '水泥', rev: 500_000, yoy: 5, mom: 1,
      cum: 4_000_000, cumYoy: 6 },
    { c: '5206', n: '建設股', m: '上市', i: '建材營造', rev: 89_000, yoy: 2_630_241,
      mom: 900, cum: 200_000, cumYoy: 3000 },
    { c: '6488', n: '上櫃股', m: '上櫃', i: '半導體', rev: 2_000_000, yoy: 40, mom: -3,
      cum: 9_000_000, cumYoy: 35 },
    { c: '9999', n: '沒公告', m: '上市', i: '其他', rev: 1_000_000, yoy: null, mom: null,
      cum: null, cumYoy: null },
  ];

  await t.test('門檻同時套在本期與基期：本期夠大但去年近零的要被擋掉', () => {
    // 5206 本期 8,900 萬也許過得了本期門檻，但去年同月只有 8.9 億/26302 ≈ 3 萬
    const r = rankRevenue(rows, { key: 'yoy', minRev: 100_000 });
    assert.deepEqual(r.map(x => x.c), ['6488', '1101']);
  });

  await t.test('不設門檻時那一檔會排第一，證明門檻真的有用', () => {
    assert.equal(rankRevenue(rows, { key: 'yoy' })[0].c, '5206');
  });

  await t.test('基期反推：+100% 代表基期是現在的一半', () => {
    assert.equal(impliedBase(200, 100), 100);
    assert.equal(impliedBase(200, -50), 400);
    // 由負轉正之類的情況算不出比較基礎
    assert.equal(impliedBase(200, -150), null);
    assert.equal(impliedBase(null, 10), null);
  });

  await t.test('沒有數值的不列入，不要當成 0%', () => {
    assert.ok(!rankRevenue(rows, { key: 'yoy' }).some(x => x.c === '9999'));
  });

  await t.test('市場篩選與由低到高', () => {
    assert.deepEqual(rankRevenue(rows, { key: 'yoy', market: '上櫃' }).map(x => x.c),
      ['6488']);
    assert.equal(rankRevenue(rows, { key: 'mom', asc: true, minRev: 100_000 })[0].c,
      '6488');
  });

  await t.test('limit 只取前幾名', () => {
    assert.equal(rankRevenue(rows, { key: 'rev', limit: 1 })[0].c, '6488');
  });
});

test('創新高清單', async (t) => {
  const win = (over: Partial<HighWindow> = {}): HighWindow =>
    ({ h: 100, l: 50, fh: -1, fl: 98, nh: 0, nl: 0, days: 200, ...over });
  const rows: HighRow[] = [
    { c: 'A', n: '新高股', k: '上市', p: 100, days: 250,
      w: { '200': win({ fh: 0, nh: 1 }), '250': win({ fh: -8 }) }, r20: 12 },
    { c: 'B', n: '接近高點', k: '上市', p: 99, days: 250,
      w: { '200': win({ fh: -1 }), '250': win({ fh: -20 }) }, r20: 3 },
    { c: 'C', n: '遠離高點', k: 'ETF', p: 60, days: 250,
      w: { '200': win({ fh: -40 }), '250': win({ fh: -45 }) }, r20: -5 },
    { c: 'D', n: '新低股', k: '上櫃', p: 50, days: 250,
      w: { '200': win({ fh: -50, fl: 0, nl: 1 }) }, r20: -30 },
    { c: 'E', n: '新股', k: '上市', p: 80, days: 40,
      w: { '150': win({ fh: 0, nh: 1 }) }, r20: 50, r120: null },
  ];

  await t.test('接近高點：排除已創新高的，也排除離高點太遠的', () => {
    assert.deepEqual(filterHighs(rows, { view: 'near', window: 200 }).map(r => r.c),
      ['B']);
  });

  await t.test('創新高與創新低各自成一份', () => {
    assert.deepEqual(filterHighs(rows, { view: 'high', window: 200 }).map(r => r.c),
      ['A']);
    assert.deepEqual(filterHighs(rows, { view: 'low', window: 200 }).map(r => r.c),
      ['D']);
  });

  await t.test('換窗口會換一組答案 —— 150 日新高不等於 200 日新高', () => {
    assert.deepEqual(filterHighs(rows, { view: 'high', window: 150 }).map(r => r.c),
      ['E']);
    assert.deepEqual(filterHighs(rows, { view: 'high', window: 250 }).map(r => r.c), []);
  });

  await t.test('沒有那個窗口資料的略過，不要當成沒創新高', () => {
    // D 沒有 250 日的資料，不該出現在 250 日的任何檢視裡
    assert.ok(!filterHighs(rows, { view: 'low', window: 250 }).some(r => r.c === 'D'));
  });

  await t.test('類別篩選', () => {
    assert.deepEqual(filterHighs(rows, { view: 'high', window: 200, kind: '上市' })
      .map(r => r.c), ['A']);
  });
});

test('漲跌幅排行', async (t) => {
  const win = (): HighWindow => ({ h: 1, l: 1, fh: 0, fl: 0, nh: 0, nl: 0, days: 200 });
  const rows: HighRow[] = [
    { c: 'A', n: '大漲', k: '上市', p: 100, days: 250, w: { '200': win() },
      r5: 5, r20: 40, r60: 10, r120: 3 },
    { c: 'B', n: '大跌', k: '上櫃', p: 20, days: 250, w: { '200': win() },
      r5: -8, r20: -30, r60: -20, r120: -40 },
    { c: 'C', n: '銅板股', k: '上市', p: 5, days: 250, w: { '200': win() },
      r5: 1, r20: 60, r60: 5, r120: 2 },
    { c: 'D', n: '新股', k: '上市', p: 88, days: 30, w: { '200': win() },
      r5: 9, r20: 80, r60: null, r120: null },
  ];

  await t.test('漲幅榜由高到低、跌幅榜由低到高', () => {
    assert.deepEqual(rankReturns(rows, { key: 'r20' }).map(r => r.c),
      ['D', 'C', 'A', 'B']);
    assert.deepEqual(rankReturns(rows, { key: 'r20', asc: true }).map(r => r.c),
      ['B', 'A', 'C', 'D']);
  });

  await t.test('股價門檻擋掉銅板股', () => {
    assert.ok(!rankReturns(rows, { key: 'r20', minPrice: 10 }).some(r => r.c === 'C'));
  });

  await t.test('期間不足的不列入，不要當成 0%', () => {
    assert.deepEqual(rankReturns(rows, { key: 'r60' }).map(r => r.c), ['A', 'C', 'B']);
  });

  await t.test('類別篩選與 limit', () => {
    assert.deepEqual(rankReturns(rows, { key: 'r5', kind: '上櫃' }).map(r => r.c), ['B']);
    assert.equal(rankReturns(rows, { key: 'r5', limit: 2 }).length, 2);
  });
});

test('個股看板', async (t) => {
  const chips = {
    date: '2026-09-17',
    days: ['2026-09-16', '2026-09-17', '2026-09-18'],
    // 股數；1 張 = 1000 股
    inst: [[1_000_000, -200_000, 50_000], null, [-3_000_000, 0, 1_000]],
    margin: { mb: 100, sb: 5 },
    qfii: 69.21,
    tdcc: { big: 87.57, huge: 84.82, holders: 3_019_610 },
    tdccDate: '2026-09-11',
  } as never;

  await t.test('每日三家分開，單位換成張', () => {
    const d = instDaily(chips);
    assert.equal(d.length, 3);
    assert.deepEqual(
      { ...d[0] },
      { date: '2026-09-16', foreign: 1000, trust: -200, dealer: 50, total: 850 });
  });

  await t.test('沒資料的日子是 null，不是 0', () => {
    const d = instDaily(chips);
    assert.equal(d[1].foreign, null);
    assert.equal(d[1].total, null);
  });

  const row = {
    c: '2330', n: '台積電', k: '上市', p: 2460, days: 250,
    w: {
      '250': { h: 2504.74, l: 1182.9, fh: -1.79, fl: 107.96, nh: 0, nl: 0, days: 250 },
      '150': { h: 2504.74, l: 1752.42, fh: -1.79, fl: 40.38, nh: 0, nl: 0, days: 150 },
    },
    r5: 2.29, r20: 2.29, r60: 3.15, r120: 35.75,
  } as never;

  await t.test('四段漲跌幅照順序攤開', () => {
    const rs = periodReturns(row);
    assert.deepEqual(rs.map(r => r.label), ['一週', '一月', '一季', '半年']);
    assert.deepEqual(rs.map(r => r.value), [2.29, 2.29, 3.15, 35.75]);
  });

  await t.test('期間不足是 null，不要當成 0%', () => {
    const rs = periodReturns({ ...row, r120: null } as never);
    assert.equal(rs[3].value, null);
  });

  await t.test('位階用 fh/fl 反推，不能拿原始收盤去比還原高低點', () => {
    const p = position(row, 250)!;
    // 台積電實際數字：距高 −1.79%、距低 +107.96%，落在區間的 96.6%
    assert.ok(Math.abs(p.pos - 96.61) < 0.05, `pos = ${p.pos}`);
    assert.equal(p.fromHigh, -1.79);
    assert.equal(p.price, 2460);          // 顯示用的仍是原始收盤
    assert.equal(p.isHigh, false);
  });

  await t.test('由高點反推與由低點反推要一致 —— 不一致代表 fh/fl 對不上高低點', () => {
    const w = row.w['250'];
    const fromLow = w.l * (1 + w.fl / 100);
    const fromHigh = w.h * (1 + w.fh / 100);
    assert.ok(Math.abs(fromLow - fromHigh) / fromLow < 0.001,
      `${fromLow.toFixed(2)} vs ${fromHigh.toFixed(2)}`);
  });

  await t.test('沒有那個窗口就回 null', () => {
    assert.equal(position(row, 200), null);
    assert.equal(position(null, 250), null);
  });

  await t.test('創新高那天位置是 100', () => {
    const hi = { ...row, w: { '250': { h: 2504.74, l: 1182.9, fh: 0, fl: 111.74, nh: 1, nl: 0, days: 250 } } };
    const p = position(hi as never, 250)!;
    assert.ok(p.pos > 99.5);
    assert.equal(p.isHigh, true);
  });
});

test('相對位置（百分位）', async (t) => {
  const mk = (c: string, r20: number, r60: number, fh: number) => ({
    c, n: c, k: '上市', p: 100, days: 250,
    w: { '250': { h: 120, l: 80, fh, fl: 25, nh: 0, nl: 0, days: 250 } },
    r20, r60, r5: null, r120: null,
  } as never);
  const allHighs = [
    mk('A', 10, 20, -1), mk('B', 5, 10, -5), mk('C', -3, 2, -20), mk('D', 1, 5, -10),
  ];
  const rk = (c: string, i: string, yoy: number) => ({
    c, n: c, m: '上市', i, rev: 1000, yoy, mom: 0, cum: 1000, cumYoy: yoy,
  } as never);
  const allRanks = [
    rk('A', '半導體業', 50), rk('B', '半導體業', 10),
    rk('C', '水泥工業', -5), rk('D', '半導體業', 30),
  ];

  await t.test('全市場百分位＝贏過幾 % 的標的', () => {
    const p = percentiles({
      high: allHighs[0], allHighs, rank: allRanks[0], allRanks, window: 250,
    });
    const r20 = p.find(x => x.key === 'r20')!;
    assert.equal(r20.value, 10);
    assert.equal(r20.market, 75);        // 贏過 B、C、D 三個中的 3/4
    assert.equal(r20.nMarket, 4);
  });

  await t.test('同業只跟同產業比，樣本數要一起回傳', () => {
    const p = percentiles({
      high: allHighs[0], allHighs, rank: allRanks[0], allRanks, window: 250,
    });
    const r20 = p.find(x => x.key === 'r20')!;
    // 半導體業只有 A、B、D 三家
    assert.equal(r20.nPeer, 3);
    assert.ok(Math.abs(r20.peer! - (2 / 3) * 100) < 1e-9);
  });

  await t.test('找不到產業別就沒有同業比較，而不是拿全市場頂替', () => {
    const p = percentiles({
      high: allHighs[0], allHighs, rank: null, allRanks, window: 250,
    });
    assert.equal(p.find(x => x.key === 'r20')!.peer, null);
    assert.equal(p.find(x => x.key === 'yoy')!.value, null);
  });

  await t.test('沒有數值的項目整列是 null，不要當成 0 去排名', () => {
    const noR20 = { ...(allHighs[0] as Record<string, unknown>), r20: null };
    const p = percentiles({
      high: noR20 as never, allHighs, rank: allRanks[0], allRanks, window: 250,
    });
    const r20 = p.find(x => x.key === 'r20')!;
    assert.equal(r20.value, null);
    assert.equal(r20.market, null);
    assert.equal(r20.peer, null);
  });
});
