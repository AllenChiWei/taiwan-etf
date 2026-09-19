/* 價平和的統計。重點是兩個容易給出「看起來合理但沒有意義」的數字的地方：
   到期當日的價平和接近 0，以及「週三的價平和」是指收盤還是盤前。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  weekdayOf, nextTradingDay, weekdayAverages, latestOf, recentOf, pickRow,
  expectedRange, straddleOutcomes, summarise, volComparison, weekdayNow,
  SERIES_LABEL, WEEKDAY_LABEL,
  type AtmRow, type AtmData, type AtmFilter,
} from '../src/lib/atm.ts';

/** 測試用的篩選條件；只寫要改的那幾項。 */
function f(over: Partial<AtmFilter> = {}): AtmFilter {
  return { series: 'wed', basis: 'data', excludeExpiry: false, ...over };
}

function row(over: Partial<AtmRow> & { d: string }): AtmRow {
  return {
    s: 'wed', r: 0, c: '202609W4', e: '2026-09-23', dte: 3, k: 46400,
    call: 490, put: 478, diff: 12, sum: 968, pairs: 157, thin: 0,
    ...over,
  };
}

test('星期換算', async (t) => {
  await t.test('2026-09-14 是週一、09-18 是週五', () => {
    assert.equal(weekdayOf('2026-09-14'), 0);
    assert.equal(weekdayOf('2026-09-18'), 4);
  });

  await t.test('週末與壞字串回 null', () => {
    assert.equal(weekdayOf('2026-09-19'), null);   // 週六
    assert.equal(weekdayOf('2026-09-20'), null);   // 週日
    assert.equal(weekdayOf('亂寫'), null);
  });

  await t.test('不經過本地時區 —— 交給 new Date 會在美國時區差一天', () => {
    // 這幾天在 UTC-7 的瀏覽器上若用 new Date(iso).getDay() 會全部往前一天
    assert.equal(weekdayOf('2026-09-16'), 2);
    assert.equal(weekdayOf('2026-09-17'), 3);
  });
});

test('下一個交易日', async (t) => {
  const rows = [
    row({ d: '2026-09-16' }), row({ d: '2026-09-17' }), row({ d: '2026-09-18' }),
    row({ d: '2026-09-21' }),                        // 週一，跳過週末
  ];
  const map = nextTradingDay(rows);

  await t.test('週五的下一個交易日是週一，連假自動跳過', () => {
    assert.equal(map.get('2026-09-18'), '2026-09-21');
  });

  await t.test('最後一天沒有下一天', () => {
    assert.equal(map.get('2026-09-21'), undefined);
  });
});

test('週一到週五平均', async (t) => {
  // 週三系列的典型形狀：週三到期當天剩 0 天、價平和趨近 0；同一天還有換倉後那口
  const rows: AtmRow[] = [
    row({ d: '2026-09-14', dte: 2, sum: 678 }),                       // 一
    row({ d: '2026-09-14', r: 1, dte: 9, sum: 1200 }),
    row({ d: '2026-09-15', dte: 1, sum: 424 }),                       // 二
    row({ d: '2026-09-15', r: 1, dte: 8, sum: 1150 }),
    row({ d: '2026-09-16', dte: 0, sum: 10 }),                        // 三，到期當日
    row({ d: '2026-09-16', r: 1, dte: 7, sum: 1100 }),
    row({ d: '2026-09-17', dte: 6, sum: 968 }),                       // 四
    row({ d: '2026-09-18', dte: 5, sum: 900 }),                       // 五
  ];

  await t.test('以收盤日分組：週三就是那個接近 0 的數字', () => {
    const stats = weekdayAverages(rows, f({ series: 'wed' }));
    assert.equal(stats[2].avg, 10);
    assert.equal(stats[2].n, 1);
  });

  await t.test('排除到期當日時自動退到換倉後那口，而不是變成沒有樣本', () => {
    const stats = weekdayAverages(rows, f({ excludeExpiry: true }));
    assert.equal(stats[2].avg, 1100, '週三那格應該是第二口的 1100');
    assert.equal(stats[2].n, 1);
  });

  await t.test('一天只取一口，不會把兩口都算進平均', () => {
    const stats = weekdayAverages(rows, f());
    assert.equal(stats[0].avg, 678, '週一只取最近到期的 678');
    assert.equal(stats[0].n, 1);
  });

  await t.test('以盤前分組：週三早上看到的是週二收盤那筆', () => {
    const stats = weekdayAverages(rows, f({ basis: 'preopen' }));
    assert.equal(stats[2].avg, 424, '週三盤前 = 週二收盤 424');
    assert.equal(stats[3].avg, 10, '週四盤前 = 週三收盤 10');
  });

  await t.test('盤前又排除到期當日：週四早上看到的是換倉後那口', () => {
    const stats = weekdayAverages(rows, f({ basis: 'preopen', excludeExpiry: true }));
    assert.equal(stats[3].avg, 1100);
  });

  await t.test('盤前分組時，最後一筆還沒有可用的日子，不計入', () => {
    const stats = weekdayAverages(rows, f({ basis: 'preopen' }));
    const total = stats.reduce((a, s) => a + s.n, 0);
    assert.equal(total, 4, '五個交易日只有四天有「下一個交易日」');
  });

  await t.test('另一個系列不會混進來', () => {
    const mixed = [...rows, row({ d: '2026-09-14', s: 'fri', sum: 1105 })];
    assert.equal(weekdayAverages(mixed, f({ series: 'wed' }))[0].avg, 678);
    assert.equal(weekdayAverages(mixed, f({ series: 'fri' }))[0].avg, 1105);
  });

  await t.test('配對過少的那口可以排除', () => {
    const noisy = [
      row({ d: '2026-09-21', sum: 9999, pairs: 3, thin: 1 }),
      row({ d: '2026-09-21', r: 1, dte: 10, sum: 1000 }),
    ];
    assert.equal(weekdayAverages(noisy, f())[0].avg, 9999);
    assert.equal(weekdayAverages(noisy, f({ excludeThin: true }))[0].avg, 1000);
  });

  await t.test('每一格都帶樣本數與極值，平均才看得出可信度', () => {
    const stats = weekdayAverages(rows, f());
    assert.equal(stats[0].min, 678);
    assert.equal(stats[0].max, 678);
    assert.equal(stats.length, WEEKDAY_LABEL.length);
  });

  await t.test('pickRow 取的是符合條件中最近到期的那口', () => {
    const day = rows.filter(r => r.d === '2026-09-16');
    assert.equal(pickRow(day, f())!.sum, 10);
    assert.equal(pickRow(day, f({ excludeExpiry: true }))!.sum, 1100);
    assert.equal(pickRow(day, f({ series: 'fri' })), null);
  });
});

test('最新與近期', async (t) => {
  const rows = [
    row({ d: '2026-09-16', sum: 1 }), row({ d: '2026-09-18', sum: 3 }),
    row({ d: '2026-09-17', sum: 2 }), row({ d: '2026-09-17', s: 'fri', sum: 456 }),
    row({ d: '2026-09-18', r: 1, dte: 12, sum: 1300 }),
  ];

  await t.test('最新一筆看日期而不是陣列順序', () => {
    assert.equal(latestOf(rows, f())!.sum, 3);
    assert.equal(latestOf(rows, f({ series: 'fri' }))!.sum, 456);
  });

  await t.test('沒有那個系列時回 null', () => {
    assert.equal(latestOf([row({ d: '2026-09-16' })], f({ series: 'fri' })), null);
  });

  await t.test('近期列是新到舊，每天一口', () => {
    assert.deepEqual(recentOf(rows, f()).map(r => r.d),
      ['2026-09-18', '2026-09-17', '2026-09-16']);
  });

  await t.test('明細與平均用同一條挑選規則 —— 排除到期當日時兩邊都換那口', () => {
    const expiring = [
      row({ d: '2026-09-16', dte: 0, sum: 10 }),
      row({ d: '2026-09-16', r: 1, dte: 7, sum: 1100 }),
    ];
    assert.equal(recentOf(expiring, f({ excludeExpiry: true }))[0].sum, 1100);
  });
});

test('系列名稱是中文，畫面直接用', () => {
  assert.equal(SERIES_LABEL.wed, '週三選擇權');
  assert.equal(SERIES_LABEL.fri, '週五選擇權');
});

/* ── 對真實資料的檢查 ───────────────────────────────────── */

const PATH = new URL('../public/data/atm.json', import.meta.url);

test('真實 atm.json', { skip: !existsSync(PATH) && '沒有 atm.json' }, async (t) => {
  const data = JSON.parse(readFileSync(PATH, 'utf8')) as AtmData;

  await t.test('兩個系列都有資料，同一天同一系列同一口不重複', () => {
    const seen = new Set<string>();
    for (const r of data.rows) {
      const key = `${r.d}|${r.s}|${r.r}`;
      assert.ok(!seen.has(key), `重複的列：${key}`);
      seen.add(key);
      assert.ok(r.r === 0 || r.r === 1, `奇怪的 rank：${r.r}`);
    }
    assert.ok((data.meta.counts.wed ?? 0) > 20);
    assert.ok((data.meta.counts.fri ?? 0) > 20);
  });

  await t.test('第二口的到期日一定晚於第一口', () => {
    const byKey = new Map<string, AtmRow[]>();
    for (const r of data.rows) {
      const k = `${r.d}|${r.s}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(r);
    }
    for (const [k, rows] of byKey) {
      const front = rows.find(r => r.r === 0);
      const next = rows.find(r => r.r === 1);
      if (front && next) {
        assert.ok(next.e > front.e, `${k} 的第二口沒有比較晚到期`);
        assert.ok(next.dte > front.dte, `${k} 的第二口剩餘天數沒有比較多`);
      }
    }
  });

  await t.test('排除到期當日之後，每個星期都有樣本 —— 這是記第二口的目的', () => {
    for (const series of ['wed', 'fri'] as const) {
      const stats = weekdayAverages(data.rows, {
        series, basis: 'preopen', excludeExpiry: true });
      for (const st of stats) {
        assert.ok(st.n > 0, `${SERIES_LABEL[series]} 的${WEEKDAY_LABEL[st.wd]}沒有樣本`);
      }
    }
  });

  await t.test('價平和等於 Call 加 Put，價差等於兩者之差', () => {
    for (const r of data.rows) {
      assert.ok(Math.abs(r.sum - (r.call + r.put)) < 0.02, `${r.d} ${r.s} 價平和對不上`);
      assert.ok(Math.abs(r.diff - Math.abs(r.call - r.put)) < 0.02, `${r.d} 價差對不上`);
    }
  });

  await t.test('到期日不早於資料日，剩餘天數與兩者一致', () => {
    for (const r of data.rows) {
      assert.ok(r.e >= r.d, `${r.c} 的到期日 ${r.e} 早於資料日 ${r.d}`);
      const days = (Date.parse(r.e) - Date.parse(r.d)) / 86400000;
      assert.equal(r.dte, days, `${r.d} ${r.c} 的剩餘天數不一致`);
    }
  });

  await t.test('合約系列與代號相符：W 與純數字是週三、F 是週五', () => {
    for (const r of data.rows) {
      const expected = /^\d{6}F\d?$/.test(r.c) ? 'fri' : 'wed';
      assert.equal(r.s, expected, `${r.c} 被分到 ${r.s}`);
    }
  });

  await t.test('到期當日的價平和明顯小於換倉後 —— 這是排除選項存在的理由', () => {
    const expiry = data.rows.filter(r => r.dte === 0).map(r => r.sum);
    const fresh = data.rows.filter(r => r.dte >= 4).map(r => r.sum);
    if (expiry.length && fresh.length) {
      const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      assert.ok(avg(expiry) < avg(fresh) / 5,
        `到期當日平均 ${avg(expiry).toFixed(0)}、換倉後 ${avg(fresh).toFixed(0)}`);
    }
  });
});

test('預估區間', async (t) => {
  const idx = { '2026-09-17': 46288, '2026-09-23': 46800, '2026-09-10': 45000 };

  await t.test('區間是指數加減價平和，百分比對得上', () => {
    const rows = [row({ d: '2026-09-17', dte: 6, sum: 968 })];
    const r = expectedRange(rows, idx, 'wed')!;
    assert.equal(r.index, 46288);
    assert.equal(r.low, 46288 - 968);
    assert.equal(r.high, 46288 + 968);
    assert.ok(Math.abs(r.pct - (968 / 46288) * 100) < 1e-9);
  });

  await t.test('取的是換倉後那口，不是到期當日那口（否則區間趨近 0）', () => {
    const rows = [
      row({ d: '2026-09-17', dte: 0, c: '202609W3', e: '2026-09-17', sum: 10 }),
      row({ d: '2026-09-17', dte: 6, c: '202609W4', e: '2026-09-23', r: 1, sum: 968 }),
    ];
    const r = expectedRange(rows, idx, 'wed')!;
    assert.equal(r.straddle, 968);
    assert.equal(r.contract, '202609W4');
  });

  await t.test('那天沒有指數收盤就回 null，不要拿別天的頂替', () => {
    const rows = [row({ d: '2026-09-16', dte: 7 })];
    assert.equal(expectedRange(rows, idx, 'wed'), null);
  });
});

test('價平和驗收', async (t) => {
  const idx = { '2026-09-17': 46288, '2026-09-23': 46800 };
  const rows = [
    // 同一個合約被看了兩天，驗收要用最早看到的那天
    row({ d: '2026-09-17', c: '202609W4', e: '2026-09-23', dte: 6, sum: 968 }),
    row({ d: '2026-09-18', c: '202609W4', e: '2026-09-23', dte: 5, sum: 800 }),
  ];

  await t.test('走幅小於價平和 = 沒走出區間，賣方賺', () => {
    const [o] = straddleOutcomes(rows, idx, 'wed');
    assert.equal(o.straddle, 968);          // 取 09-17 那天，不是 09-18
    assert.equal(o.day, '2026-09-17');
    assert.equal(o.settle, 46800);
    assert.equal(o.moved, 512);
    assert.equal(o.change, 512);
    assert.equal(o.inside, true);
    assert.ok(Math.abs(o.ratio - 512 / 968) < 1e-9);
  });

  await t.test('跌破下緣同樣算走出區間 —— 走幅取絕對值', () => {
    const o = straddleOutcomes(rows, { '2026-09-17': 46288, '2026-09-23': 44000 },
                               'wed')[0];
    assert.equal(o.moved, 2288);
    assert.equal(o.change, -2288);
    assert.equal(o.inside, false);
  });

  await t.test('到期日還沒有指數就不列入 —— 沒有答案的不算驗收', () => {
    assert.equal(straddleOutcomes(rows, { '2026-09-17': 46288 }, 'wed').length, 0);
  });

  await t.test('彙總：勝率與平均比值', () => {
    const outs = straddleOutcomes(rows, idx, 'wed');
    const s = summarise(outs)!;
    assert.equal(s.n, 1);
    assert.equal(s.insideRate, 1);
    assert.ok(Math.abs(s.avgMoved - 512) < 1e-9);
    assert.equal(summarise([]), null);
  });
});

test('對真實資料的預估區間', { skip: !existsSync(PATH) && '沒有 atm.json' }, async (t) => {
  const data = JSON.parse(readFileSync(PATH, 'utf8')) as AtmData;
  const taiex = data.taiex ?? {};

  await t.test('近 40 個交易日的指數收盤要齊全', () => {
    // 只盯近期：當月那一份是一個請求就拿得到整月的，所以近期沒有藉口。
    // 更早的歷史是一天一個請求、還會被證交所擋速，分好幾輪才補得完。
    const days = [...new Set(data.rows.map(r => r.d))].sort().slice(-40);
    const have = days.filter(d => taiex[d]).length;
    assert.ok(have / days.length > 0.9,
      `近 ${days.length} 個交易日只有 ${have} 天有指數收盤`);
  });

  await t.test('預估走幅占指數的比例落在合理範圍（0.5%～8%）', () => {
    for (const s of ['wed', 'fri'] as const) {
      const r = expectedRange(data.rows, taiex, s);
      if (!r) continue;
      assert.ok(r.pct > 0.5 && r.pct < 8,
        `${s} 的預估走幅是指數的 ${r.pct.toFixed(2)}%`);
    }
  });

  await t.test('每個合約只驗收一次，而且用的是最早看到它的那天', () => {
    for (const s of ['wed', 'fri'] as const) {
      const outs = straddleOutcomes(data.rows, taiex, s, 50);
      assert.equal(new Set(outs.map(o => o.contract)).size, outs.length);
      for (const o of outs) {
        const earlier = data.rows.filter(
          r => r.c === o.contract && r.r === 0 && r.dte !== 0 && r.d < o.day);
        assert.equal(earlier.length, 0, `${o.contract} 還有更早的 ${earlier[0]?.d}`);
      }
    }
  });
});

test('波動定價比較', async (t) => {
  /* 連續五週的週一，價平和 800/900/1000/1100/1500。最後一筆是現值。 */
  const mondays = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14'];
  const sums = [800, 900, 1000, 1100, 1500];
  const rows = mondays.map((d, i) => row({ d, sum: sums[i], dte: 2 }));
  const idx = Object.fromEntries(mondays.map(d => [d, 45000]));

  await t.test('只拿同一個星期幾比，中位數與百分位都對', () => {
    const v = volComparison(rows, idx, f({ basis: 'data' }), [60])!;
    assert.equal(v.wd, 0);                 // 週一
    assert.equal(v.straddle, 1500);
    assert.equal(v.windows[0].n, 4);       // 不含現值本身
    assert.equal(v.windows[0].medianStraddle, 950);
    assert.equal(v.windows[0].percentile, 100);
    assert.ok(Math.abs(v.windows[0].ratio - 1500 / 950) < 1e-9);
  });

  await t.test('星期幾不同的不算進來', () => {
    const mixed = [...rows, row({ d: '2026-09-15', sum: 9999, dte: 1 })];  // 週二
    const v = volComparison(mixed, { ...idx, '2026-09-15': 45000 },
                            f({ basis: 'data' }), [60])!;
    assert.equal(v.day, '2026-09-15');     // 現值換成週二那筆
    assert.equal(v.wd, 1);
    assert.equal(v.windows[0].n, 0);       // 沒有別的週二可比
  });

  await t.test('窗口短到裝不下就只用窗口內的樣本', () => {
    const v = volComparison(rows, idx, f({ basis: 'data' }), [3])!;
    assert.equal(v.windows[0].n, 2);       // 最近三筆裡，扣掉現值剩兩筆
    assert.equal(v.windows[0].medianStraddle, 1050);
  });

  await t.test('指數水位會讓點數說謊 —— 百分比才是可比的', () => {
    // 同樣 1,000 點，指數從 40,000 漲到 47,000：點數沒變，佔比從 2.5% 變 2.13%
    const days = ['2026-09-07', '2026-09-14'];
    const flat = days.map(d => row({ d, sum: 1000, dte: 2 }));
    const v = volComparison(flat, { '2026-09-07': 40000, '2026-09-14': 47000 },
                            f({ basis: 'data' }), [60])!;
    assert.equal(v.windows[0].ratio, 1);                    // 點數看起來一樣
    assert.ok(Math.abs(v.pct! - (1000 / 47000) * 100) < 1e-9);
    assert.ok(Math.abs(v.windows[0].medianPct! - 2.5) < 1e-9);
    assert.ok(v.pct! < v.windows[0].medianPct!);            // 佔比其實降了
  });

  await t.test('沒有指數收盤時百分比是 null，不要用 0 頂替', () => {
    const v = volComparison(rows, {}, f({ basis: 'data' }), [60])!;
    assert.equal(v.pct, null);
    assert.equal(v.windows[0].medianPct, null);
    assert.equal(v.windows[0].medianStraddle, 950);         // 點數照樣算得出來
  });
});

test('每個星期幾的現值與中位數', async (t) => {
  /* 三個週一（800/1000/1500）與兩個週三（400/600）。 */
  const days: Array<[string, number]> = [
    ['2026-08-31', 800], ['2026-09-02', 400],
    ['2026-09-07', 1000], ['2026-09-09', 600],
    ['2026-09-14', 1500],
  ];
  const rows = days.map(([d, sum]) => row({ d, sum, dte: 2 }));
  const idx = Object.fromEntries(days.map(([d]) => [d, 45000]));

  await t.test('現值是最近一次那個星期幾，中位數不含現值', () => {
    const t0 = weekdayNow(rows, idx, f({ basis: 'data' }));
    const mon = t0[0];
    assert.equal(mon.latest, 1500);
    assert.equal(mon.latestDay, '2026-09-14');
    assert.equal(mon.median, 900);          // 800 與 1000 的中位數
    assert.equal(mon.n, 2);
    assert.ok(Math.abs(mon.ratio! - 1500 / 900) < 1e-9);
  });

  await t.test('只有一筆樣本時中位數是 null，不要拿現值自己比自己', () => {
    const one = weekdayNow([row({ d: '2026-09-14', sum: 1500 })], idx, f({ basis: 'data' }));
    assert.equal(one[0].latest, 1500);
    assert.equal(one[0].median, null);
    assert.equal(one[0].ratio, null);
    assert.equal(one[0].n, 0);
  });

  await t.test('沒有樣本的星期幾整格是 null', () => {
    const t0 = weekdayNow(rows, idx, f({ basis: 'data' }));
    assert.equal(t0[4].latest, null);       // 週五
    assert.equal(t0[4].n, 0);
  });

  await t.test('窗口只看最近 N 個交易日', () => {
    const t0 = weekdayNow(rows, idx, f({ basis: 'data' }), 3);
    assert.equal(t0[0].latest, 1500);
    assert.equal(t0[0].n, 1);               // 窗口內只剩 09-07 那個週一
    assert.equal(t0[0].median, 1000);
  });
});
