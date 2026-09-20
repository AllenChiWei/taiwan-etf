/* 期貨對帳單的解析與統計。
 *
 * 所有列都取自真實的元大「已實現損益」檔案 —— 這份解析靠的是**欄位位置**
 * （平倉損益、手續費、期交稅、合計損益那四欄的標題是空白的），拿假資料測
 * 等於只測了自己編的格式。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  baseProduct, excelDate, parseSheet, stats, equityCurve, groupBy, byMonth,
  histogram, StatementError,
  type Trade,
} from '../src/lib/futures.ts';

/** 真實檔案的標題列（欄 7、11、13～16 是空白的，這正是重點）。 */
const HEAD = ['結算日期', '交易所  ', '商品名稱        ', '口數 ', '交易日期',
  '委託單號', 'B/S', '            ', '交易日期', '委託單號', 'B/S',
  '            ', '幣別', '            ', '            ', '            ',
  '            ', '備註欄         '];

/** 真實資料列。 */
const ROWS: unknown[][] = [
  HEAD,
  [46024, 'TIMEX', '小台指202601', 1, 46022, '7A979', 'B', 28905, 46024, '7D712', 'S', 28995, 'TWD', 4500, 50, 58, 4392, ''],
  [46024, 'TIMEX', '小台指202601', 1, 46024, '7D388', 'B', 29028, 46024, '5E207', 'S', 29054, 'TWD', 1300, 50, 58, 1192, ''],
  [46024, 'TIMEX', '小電子202601', 1, 46024, '7D837', 'B', 1743.8, 46024, '7E479', 'S', 1743.95, 'TWD', 75, 50, 34, -9, ''],
  // 選擇權未履約：平倉那幾欄是空的
  [46162, 'TIMEX', '台指40850202605C', 2, 46162, '5B013', 'B', 15.5, '', '', '', '', 'TWD', -1550, 40, 2, -1592, '未履約，結算價格:40080.0000'],
];

test('商品分組', async (t) => {
  await t.test('月選、週選都併成「台指選擇權」', () => {
    assert.equal(baseProduct('台指40850202605C'), '台指選擇權');
    assert.equal(baseProduct('台指29700202603P'), '台指選擇權');
    assert.equal(baseProduct('台指W437300P04'), '台指選擇權');
  });

  await t.test('期貨去掉月份', () => {
    assert.equal(baseProduct('小台指202601'), '小台指');
    assert.equal(baseProduct('小電子202603'), '小電子');
  });

  await t.test('股票期貨的月份前面有連字號，不能只去數字', () => {
    // 真實寫法：小型智邦-202605。只 replace 六位數字會留下「智邦-」
    assert.equal(baseProduct('小型智邦-202605'), '智邦');
    assert.equal(baseProduct('大聯大-202605'), '大聯大');
  });

  await t.test('小型股票期貨併回本尊，但小台指／小電子不動', () => {
    assert.equal(baseProduct('小型國巨-202601'), '國巨');
    assert.equal(baseProduct('小台指202601'), '小台指');   // 不是「台指」
    assert.equal(baseProduct('小電子202601'), '小電子');
  });
});

test('Excel 日期序號', async (t) => {
  await t.test('對帳單裡的序號與 xlrd 算出來的一致', () => {
    // 用原始檔案交叉驗過：xlrd 的 xldate_as_datetime 也給同樣的日期
    assert.equal(excelDate(46024), '2026-01-02');
    assert.equal(excelDate(46162), '2026-05-20');
  });

  await t.test('1900 閏年臭蟲：59 與 61 各差一天', () => {
    assert.equal(excelDate(59), '1900-02-28');
    assert.equal(excelDate(61), '1900-03-01');
  });

  await t.test('不是數字就回 null，不要湊一個日期出來', () => {
    assert.equal(excelDate(0), null);
    assert.equal(excelDate(NaN), null);
  });
});

test('解析對帳單', async (t) => {
  const trades = parseSheet(ROWS);

  await t.test('四列都解析出來，標題列不算', () => {
    assert.equal(trades.length, 4);
  });

  await t.test('第一列的每個欄位都對', () => {
    assert.deepEqual(trades[0], {
      date: '2026-01-02', product: '小台指202601', base: '小台指',
      lots: 1, side: '多', openPrice: 28905, closePrice: 28995,
      gross: 4500, fee: 50, tax: 58, net: 4392, month: '2026-01',
    } satisfies Trade);
  });

  await t.test('未履約的選擇權：平倉價是 0，損益照常', () => {
    const o = trades[3];
    assert.equal(o.base, '台指選擇權');
    assert.equal(o.closePrice, 0);
    assert.equal(o.net, -1592);
    assert.equal(o.lots, 2);
  });

  await t.test('欄位對不上就報錯，不要安靜算出錯的績效', () => {
    // 把合計損益那一欄整個挪掉一格，模擬對方改版
    const shifted = ROWS.map((r, i) =>
      (i === 0 ? r : [...r.slice(0, 13), 999, 999, 999, 999, '']));
    assert.throws(() => parseSheet(shifted), StatementError);
  });

  await t.test('空檔案與沒有交易的檔案都報錯', () => {
    assert.throws(() => parseSheet([]), StatementError);
    assert.throws(() => parseSheet([HEAD]), StatementError);
  });
});

test('統計', async (t) => {
  const trades = parseSheet(ROWS);
  const s = stats(trades);

  await t.test('勝負筆數與勝率', () => {
    assert.equal(s.n, 4);
    assert.equal(s.nWin, 2);          // 4392、1192
    assert.equal(s.nLoss, 2);         // −9、−1592
    assert.equal(s.winRate, 0.5);
  });

  await t.test('總損益＝毛利 − 手續費 − 稅', () => {
    assert.equal(s.gross, 4500 + 1300 + 75 - 1550);
    assert.equal(s.fee, 190);
    assert.equal(s.tax, 152);
    assert.equal(s.net, 4392 + 1192 - 9 - 1592);
    assert.equal(s.net, s.gross - s.fee - s.tax);
  });

  await t.test('賠率與獲利因子', () => {
    const avgWin = (4392 + 1192) / 2;
    const avgLoss = (-9 - 1592) / 2;
    assert.ok(Math.abs(s.avgWin - avgWin) < 1e-9);
    assert.ok(Math.abs(s.avgLoss - avgLoss) < 1e-9);
    assert.ok(Math.abs(s.payoff! - avgWin / Math.abs(avgLoss)) < 1e-9);
    assert.ok(Math.abs(s.profitFactor! - 5584 / 1601) < 1e-9);
  });

  await t.test('沒有虧損筆數時賠率是 null，不要變成 ∞ 或 0', () => {
    const onlyWins = trades.filter(x => x.net > 0);
    assert.equal(stats(onlyWins).payoff, null);
    assert.equal(stats(onlyWins).profitFactor, null);
  });

  await t.test('成本吃掉毛利的比例', () => {
    assert.ok(Math.abs(s.costRatio! - 342 / 4325) < 1e-9);
  });

  await t.test('最大連敗與最大回撤', () => {
    assert.equal(s.maxLossStreak, 2);      // 最後兩筆都是虧的
    assert.equal(s.maxWinStreak, 2);
    // 累計 4392 → 5584 → 5575 → 3983，高點 5584
    assert.equal(s.maxDrawdown, 3983 - 5584);
  });

  await t.test('空清單不會炸，而且回 0 不是 NaN', () => {
    const e = stats([]);
    assert.equal(e.n, 0);
    assert.equal(e.net, 0);
    assert.equal(e.winRate, 0);
    assert.equal(e.payoff, null);
  });
});

test('曲線與分組', async (t) => {
  const trades = parseSheet(ROWS);

  await t.test('累計損益逐筆累加', () => {
    const c = equityCurve(trades);
    assert.deepEqual(c.map(p => p.cum), [4392, 5584, 5575, 3983]);
  });

  await t.test('依商品分組，總損益由大到小', () => {
    const g = groupBy(trades, x => x.base);
    assert.deepEqual(g.map(x => x.key), ['小台指', '小電子', '台指選擇權']);
    assert.equal(g[0].stats.net, 5584);
    assert.equal(g[0].trades.length, 2);
  });

  await t.test('依月份分組要照時間排，不是照金額', () => {
    const m = byMonth(trades);
    assert.deepEqual(m.map(x => x.key), ['2026-01', '2026-05']);
  });

  await t.test('直方圖的筆數加總等於交易數', () => {
    const h = histogram(trades, 5);
    assert.equal(h.reduce((a, b) => a + b.n, 0), trades.length);
    assert.equal(h.length, 5);
  });

  await t.test('全部同值時只有一格，不會除以零', () => {
    const same = trades.map(x => ({ ...x, net: 100 }));
    const h = histogram(same, 10);
    assert.equal(h.length, 1);
    assert.equal(h[0].n, trades.length);
  });
});
