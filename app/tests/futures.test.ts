/* 期貨對帳單的解析與統計。
 *
 * 所有列都取自真實的元大「已實現損益」檔案 —— 這份解析靠的是**欄位位置**
 * （平倉損益、手續費、期交稅、合計損益那四欄的標題是空白的），拿假資料測
 * 等於只測了自己編的格式。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  baseProduct, excelDate, parseSheet, stats, equityCurve, groupBy, byMonth,
  histogram, StatementError, strategyOf, classifyOptions, mergeTrades,
  byYear, monthMatrix, dailyCurves, drawdownSeries, callPut, optionMetrics,
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
    const { id, ...rest } = trades[0];
    assert.match(id, /^[0-9a-z]+#1$/);
    assert.deepEqual(rest, {
      date: '2026-01-02', month: '2026-01', year: '2026',
      product: '小台指202601', base: '小台指',
      lots: 1, side: '多', sideKnown: true, dayTrade: false,
      openPrice: 28905, closePrice: 28995, buyPrice: 28905, sellPrice: 28995,
      gross: 4500, fee: 50, tax: 58, net: 4392, note: '',
      isOption: false, strategy: '程式',
    });
  });

  await t.test('同一天買賣又沒有時間：方向標成分不出來', () => {
    assert.equal(trades[1].dayTrade, true);
    assert.equal(trades[1].sideKnown, false);
  });

  await t.test('未履約的選擇權：平倉價是 0，損益照常', () => {
    const o = trades[3];
    assert.equal(o.base, '台指選擇權');
    assert.equal(o.strategy, '選擇權');
    assert.equal(o.closePrice, 0);
    assert.equal(o.sellPrice, null);
    assert.equal(o.net, -1592);
    assert.equal(o.lots, 2);
    assert.equal(o.side, '多');           // 到期結算看第一個 B/S
    assert.equal(o.sideKnown, true);
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

/* ── 方向、交易方式、選擇權分類 ── 以下各列的價格與損益取自真實檔案 ── */

/** 一般版：每一列固定「B 在前、S 在後」，放空的單也一樣。 */
const SHORTS: unknown[][] = [
  HEAD,
  // 先賣 13.5（2/6）、後買回 0.4（2/10）：賣方策略，方向從日期看得出來
  [46059, 'TIMEX', '台指33050202602C', 1, 46059, '7A001', 'B', 0.4, 46057, '7A002', 'S', 13.5, 'TWD', 655, 40, 1, 614, ''],
  // 先買 46.5、後賣 100：避險
  [46083, 'TIMEX', '台指34400202602P', 2, 46079, '7A003', 'B', 46.5, 46083, '7A004', 'S', 100, 'TWD', 5350, 80, 14, 5256, ''],
  // 賣出 9.1 到期作廢：平倉那邊空白、第一個 B/S 是 S
  [46276, 'TIMEX', '台指45500202609P', 1, 46276, '7A005', 'S', 9.1, '', '', ' ', '', 'TWD', 455, 20, 0, 435, '未履約，結算價格:46250.0000'],
  // 同一天買賣，賣價 15：推定賣方
  [46085, 'TIMEX', '台指34000202604C', 1, 46085, '7A006', 'B', 40, 46085, '7A007', 'S', 15, 'TWD', -1250, 40, 3, -1293, ''],
  // 同一天買賣，賣價 71：推定避險
  [46034, 'TIMEX', '台指30200202601P', 1, 46034, '5F248', 'B', 65, 46034, '5A096', 'S', 71, 'TWD', 300, 40, 7, 253, ''],
  // 期貨放空：先賣後買
  [46029, 'TIMEX', '小型南電-202601', 1, 46029, '7A008', 'B', 300, 46027, '7A009', 'S', 310, 'TWD', 1000, 20, 4, 976, ''],
  [46029, 'TIMEX', '台指期202601', 1, 46027, '7A010', 'B', 29000, 46029, '7A011', 'S', 29010, 'TWD', 2000, 60, 116, 1824, ''],
];

test('開倉方向與交易方式', async (t) => {
  const tr = parseSheet(SHORTS);

  await t.test('B 在前不代表做多：賣的日期比較早就是放空', () => {
    assert.equal(tr[0].side, '空');
    assert.equal(tr[0].openPrice, 13.5);
    assert.equal(tr[0].closePrice, 0.4);
    assert.equal(tr[5].side, '空');
    assert.equal(tr[5].openPrice, 310);
  });

  await t.test('到期結算的賣方：第一個 B/S 是 S', () => {
    assert.equal(tr[2].side, '空');
    assert.equal(tr[2].sideKnown, true);
  });

  await t.test('程式交易只有小台指、小電子；大台、微台、個股期貨都是主觀', () => {
    assert.equal(strategyOf('小台指'), '程式');
    assert.equal(strategyOf('小電子'), '程式');
    assert.equal(strategyOf('台指期'), '主觀');
    assert.equal(strategyOf('微台指'), '主觀');
    assert.equal(strategyOf('南電'), '主觀');
    assert.equal(strategyOf('台指選擇權'), '選擇權');
    assert.equal(tr[5].strategy, '主觀');
    assert.equal(tr[6].strategy, '主觀');
  });

  await t.test('週選與英文代號的台指選擇權', () => {
    assert.equal(baseProduct('台指W437300P04'), '台指選擇權');
    assert.equal(baseProduct('台指F147000P10'), '台指選擇權');   // 週五到期的週選
    assert.equal(baseProduct('TX15000202203C'), '台指選擇權');
    assert.equal(baseProduct('FIFCF202603'), 'FIFCF');           // 期貨，不是選擇權
  });
});

test('選擇權：賣方策略與避險', async (t) => {
  const tr = classifyOptions(parseSheet(SHORTS));
  const kind = (i: number) => [tr[i].optKind, tr[i].optGuess];

  await t.test('方向分得出來的不看價格', () => {
    assert.deepEqual(kind(0), ['賣方', false]);
    assert.deepEqual(kind(1), ['避險', false]);
    assert.deepEqual(kind(2), ['賣方', false]);
  });

  await t.test('同一天買賣：賣價落在區間推定賣方，否則推定避險', () => {
    assert.deepEqual(kind(3), ['賣方', true]);
    assert.equal(tr[3].side, '空');
    assert.equal(tr[3].openPrice, 15);
    assert.deepEqual(kind(4), ['避險', true]);
  });

  await t.test('區間可以調', () => {
    const narrow = classifyOptions(parseSheet(SHORTS), { sellMin: 5, sellMax: 12 });
    assert.equal(narrow[3].optKind, '避險');
  });

  await t.test('手動指定優先，連方向分得出來的也能改', () => {
    const raw = parseSheet(SHORTS);
    const m = classifyOptions(raw, {
      sellMin: 5, sellMax: 30, overrides: { [raw[1].id]: '賣方', [raw[3].id]: '避險' },
    });
    assert.equal(m[1].optKind, '賣方');
    assert.equal(m[3].optKind, '避險');
    assert.equal(m[3].optGuess, false);
  });

  await t.test('期貨不會被分類', () => {
    assert.equal(tr[5].optKind, undefined);
  });
});

/** 含時間版（EX0659）的真實標題：商品在第二欄、名稱裡有空白、多了時間欄。 */
const TIMED_HEAD = ['結算日期  ', '商品名稱                      ', '口數      ', '日期      ', '時間    ',
  '單號  ', 'B/S', '               成交價', '日期      ', '時間    ', '單號  ', 'B/S', '               成交價',
  '             平倉損益', '               手續費', '               期交稅', '             合計損益',
  '備註                          ', '幣別', '交易所  '];

test('含時間版的對帳單', async (t) => {
  const rows: unknown[][] = [
    TIMED_HEAD,
    // 真實列
    [46287, '小台指 202610                 ', '         2', 46283, 0.4663078703703704, '#7C228', 'B', 47230, 46287, 0.8906481481481481, '#7E018', 'S', 48254, 102400, 100, 190, 102110, '', 'TWD', 'TIMEX   '],
    // 同一天：賣在 09:00、買回在 13:00 → 放空
    [46287, '台指34000202610C', '1', 46287, 13 / 24, '#7C229', 'B', 30, 46287, 9 / 24, '#7C230', 'S', 15, -750, 40, 2, -792, '', 'TWD', 'TIMEX   '],
  ];
  const tr = classifyOptions(parseSheet(rows));

  await t.test('欄位位置不同也讀得對', () => {
    assert.equal(tr[0].product, '小台指202610');
    assert.equal(tr[0].base, '小台指');
    assert.equal(tr[0].lots, 2);
    assert.equal(tr[0].net, 102110);
    assert.equal(tr[0].side, '多');
  });

  await t.test('同一天的單靠時間分出方向，不必推定', () => {
    assert.equal(tr[1].side, '空');
    assert.equal(tr[1].sideKnown, true);
    assert.equal(tr[1].optKind, '賣方');
    assert.equal(tr[1].optGuess, false);
  });
});

test('多份對帳單合併', async (t) => {
  const a = parseSheet(ROWS);
  const b = parseSheet([HEAD, ROWS[1], ROWS[2], ROWS[2]]);

  await t.test('重疊的列只算一次，同一檔裡本來就重複的列保留', () => {
    // a 有 4 列；b 多一列與 ROWS[2] 一模一樣的（同一檔裡第 2 次出現）
    assert.equal(mergeTrades([a, b]).length, 5);
  });

  await t.test('一般版與含時間版的同一筆交易只算一次，保留分得出方向的那份', () => {
    // 真實的同一筆：EX0651 與 EX0659 各有一列
    const plain = parseSheet([HEAD,
      [46287, 'TIMEX   ', '小台指202610                  ', '    1', 46286, '7A103 ', 'B', 47595, 46287, '5E724 ', 'S', 48689, 'TWD', 54700, 50, 97, 54553, ''],
      [46287, 'TIMEX   ', '小台指202610                  ', '    1', 46287, '7A104 ', 'B', 48000, 46287, '5E725 ', 'S', 48100, 'TWD', 5000, 50, 97, 4853, ''],
    ]);
    const timed = parseSheet([TIMED_HEAD,
      [46287, '小台指 202610                 ', '         1', 46286, 0.3646412037037037, '#7A103', 'B', 47595, 46287, 1.0834027777777777, '#5E724', 'S', 48689, 54700, 50, 97, 54553, '', 'TWD', 'TIMEX   '],
      [46287, '小台指 202610                 ', '         1', 46287, 0.5, '#7A104', 'B', 48000, 46287, 0.4, '#5E725', 'S', 48100, 5000, 50, 97, 4853, '', 'TWD', 'TIMEX   '],
    ]);
    const m = mergeTrades([plain, timed]);
    assert.equal(m.length, 2);
    assert.equal(m[1].sideKnown, true);     // 用了含時間版那份
    assert.equal(m[1].side, '空');
  });

  await t.test('依結算日排序', () => {
    const m = mergeTrades([parseSheet([HEAD, ROWS[4]]), parseSheet([HEAD, ROWS[1]])]);
    assert.deepEqual(m.map(x => x.date), ['2026-01-02', '2026-05-20']);
  });
});

test('年度、月份與曲線', async (t) => {
  const trades = parseSheet(ROWS);

  await t.test('年度分組', () => {
    const y = byYear(trades);
    assert.deepEqual(y.map(g => g.key), ['2026']);
    assert.equal(y[0].stats.net, 3983);
  });

  await t.test('月績效：沒交易的月份是 null，不是 0', () => {
    const m = monthMatrix(trades);
    assert.equal(m.length, 1);
    assert.equal(m[0].months[0], 4392 + 1192 - 9);
    assert.equal(m[0].months[4], -1592);
    assert.equal(m[0].months[1], null);
    assert.equal(m[0].total, 3983);
  });

  await t.test('日曲線：共用日期軸，沒交易的那天沿用前一天', () => {
    const d = dailyCurves([
      { key: '程式', trades: trades.filter(x => x.strategy === '程式') },
      { key: '選擇權', trades: trades.filter(x => x.strategy === '選擇權') },
    ]);
    assert.deepEqual(d.dates, ['2026-01-02', '2026-05-20']);
    assert.deepEqual(d.series[0].values, [5575, 5575]);
    assert.deepEqual(d.series[1].values, [0, -1592]);
  });

  await t.test('回撤曲線', () => {
    assert.deepEqual(drawdownSeries([100, 50, 200, 150]), [0, -50, 0, -50]);
  });

  await t.test('報酬回撤比與賺錢日', () => {
    const s = stats(trades);
    assert.ok(Math.abs(s.recovery! - 3983 / 1601) < 1e-9);
    assert.equal(s.days, 2);
    assert.equal(s.dayWinRate, 0.5);
  });
});

test('選擇權專用指標', async (t) => {
  const tr = classifyOptions(parseSheet(SHORTS));

  await t.test('買權／賣權：月選在最後、週選在月份前面', () => {
    assert.equal(callPut('台指32000202603P'), 'P');
    assert.equal(callPut('台指W437300C04'), 'C');
    assert.equal(callPut('台指F147000P10'), 'P');
    assert.equal(tr[0].cp, 'C');
    assert.equal(tr[5].cp, undefined);      // 期貨沒有
  });

  await t.test('賣方：收進的權利金與留下的比例', () => {
    // 賣 13.5 點 1 口 = 675 元，合計賺 614
    const m = optionMetrics([tr[0]]);
    assert.equal(m.premium, 675);
    assert.ok(Math.abs(m.keepRate! - 614 / 675) < 1e-9);
    assert.equal(m.settled, 0);
  });

  await t.test('到期結算的筆數與賺錢的筆數', () => {
    const m = optionMetrics([tr[0], tr[2]]);
    assert.equal(m.settled, 1);
    assert.equal(m.settledWin, 1);
    assert.equal(m.avgPrice, (13.5 + 9.1) / 2);
  });

  await t.test('避險：付出的權利金收回幾成', () => {
    // 買 46.5 點 2 口 = 4650 元，平倉賺 5350 → 收回 (4650+5350)/4650
    const m = optionMetrics([tr[1]]);
    assert.equal(m.premium, 4650);
    assert.ok(Math.abs(m.recoverRate! - 10000 / 4650) < 1e-9);
  });

  await t.test('一次大賠要幾次小賺：沒有虧損時是 null', () => {
    assert.equal(optionMetrics([tr[0]]).tailRatio, null);
    const m = optionMetrics([tr[0], tr[3]]);       // +614、−1293
    assert.ok(Math.abs(m.tailRatio! - 1293 / 614) < 1e-9);
  });
});
