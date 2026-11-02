/* 定期定額紀錄：每月合計、券商／人別、扣款日（月底、多天）、接下來的扣款、壞資料的清理。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  monthlyOf, monthTotal, byBroker, byPerson, actualDay, monthDeductions, upcoming, parseDays, daysText, peopleOf, cleanDca, type DcaPlan,
  summarize, compareHoldings, cleanHoldings, renamePerson, type DcaHolding, type Quote,
} from '../src/lib/dca.ts';

const plan = (o: Partial<DcaPlan>): DcaPlan => ({ id: 'x', who: '我', code: '0050', name: '元大台灣50', days: [6], amount: 3000, broker: '華南', ...o });

test('每月金額＝每次金額×扣款天數；合計只算沒暫停的、可以只看某個人', () => {
  const ps = [
    plan({ id: 'a', days: [6, 16, 26], amount: 1000 }),
    plan({ id: 'b', who: '小孩', broker: '永豐', amount: 5000 }),
    plan({ id: 'c', amount: 9999, off: true }),
  ];
  assert.equal(monthlyOf(ps[0]), 3000);
  assert.equal(monthTotal(ps, null), 8000);
  assert.equal(monthTotal(ps, '我'), 3000);
  assert.equal(monthTotal(ps, '小孩'), 5000);
  assert.deepEqual(byBroker(ps, null).map(x => [x.key, x.monthly]), [['永豐', 5000], ['華南', 3000]]);
  assert.deepEqual(byPerson(ps).map(x => [x.key, x.monthly, x.n]), [['小孩', 5000, 1], ['我', 3000, 1]]);
});

test('31 日在小月算月底；同一天扣兩次合併', () => {
  assert.equal(actualDay(31, 2026, 2), 28);
  assert.equal(actualDay(31, 2028, 2), 29);
  assert.equal(actualDay(31, 2026, 4), 30);
  const d = monthDeductions([plan({ days: [30, 31], amount: 1000 })], null, 2026, 2);
  assert.deepEqual(d.map(x => [x.date, x.amount]), [['2026-02-28', 2000]]);
});

test('接下來的扣款：今天（含）以後，接著下個月', () => {
  const ps = [plan({ id: 'a', days: [6, 26] }), plan({ id: 'b', who: '小孩', days: [16] })];
  const u = upcoming(ps, null, new Date(2026, 11, 16), 4);         // 12 月 16 日
  assert.deepEqual(u.map(x => x.date), ['2026-12-16', '2026-12-26', '2027-01-06', '2027-01-16']);
  assert.deepEqual(upcoming(ps, '我', new Date(2026, 11, 16), 2).map(x => x.date), ['2026-12-26', '2027-01-06']);
});

test('扣款日的輸入與文字', () => {
  assert.deepEqual(parseDays('26, 6、16 6'), [6, 16, 26]);
  assert.equal(parseDays('0'), null);
  assert.equal(parseDays('32'), null);
  assert.equal(parseDays(''), null);
  assert.equal(daysText([26, 6]), '每月 6、26 日');
});

test('人名清單：存檔的在前、計畫裡有的補上；都沒有用預設（我、莎莎、QQ）', () => {
  assert.deepEqual(peopleOf({ people: [], plans: [] }), ['我', '莎莎', 'QQ']);
  assert.deepEqual(peopleOf({ people: ['我'], plans: [], holdings: [{ id: 'h', who: 'QQ', code: '0050', name: 'x', shares: 1 }] }), ['我', 'QQ']);
  assert.deepEqual(peopleOf({ people: ['爸爸'], plans: [plan({ who: '妹妹' })] }), ['爸爸', '妹妹']);
});

test('壞資料丟掉、欄位整理', () => {
  const d = cleanDca({
    generated: '2026-11-02 10:00:00', people: ['我', ' 小孩 ', '我', 3],
    plans: [
      { id: 'ok', who: '小孩', code: '00406a', name: '', days: [26, 6, 6, 40], amount: '2000', broker: '永豐' },
      { name: '沒有扣款日', days: [], amount: 100 },
      { name: '金額不對', days: [1], amount: -5 },
      null,
    ],
  });
  assert.deepEqual(d.people, ['我', '小孩']);
  assert.equal(d.plans.length, 1);
  assert.deepEqual(d.plans[0], { id: 'ok', who: '小孩', code: '00406A', name: '00406A', days: [6, 26], amount: 2000, broker: '永豐' });
  assert.equal(cleanDca(null).plans.length, 0);
});

const hold = (o: Partial<DcaHolding>): DcaHolding => ({ id: 'h', who: '莎莎', code: '0050', name: '元大台灣50', shares: 1000, ...o });
const quotes = new Map<string, Quote>([['0050', { price: 50, perYear: 1.5 }], ['00646', { price: 60, perYear: 0 }]]);

test('小孩比較：市值、成本報酬、年配息、每月定期定額、缺報價', () => {
  const hs = [
    hold({ id: 'a', shares: 1000, cost: 40000 }), hold({ id: 'b', shares: 500 }),          // 同一檔分兩筆
    hold({ id: 'c', code: '00646', name: '元大S&P500', shares: 200, cost: 10000 }),
    hold({ id: 'd', code: '9999', name: '沒有報價', shares: 10 }),
    hold({ id: 'e', who: 'QQ', shares: 300 }),
  ];
  const plans = [plan({ who: '莎莎', amount: 3000 }), plan({ who: 'QQ', amount: 1000, days: [6, 16] })];
  const a = summarize('莎莎', hs, plans, quotes);
  assert.equal(a.mv, 1500 * 50 + 200 * 60);
  assert.equal(a.div, 1500 * 1.5);
  assert.equal(a.cost, 50000);
  assert.equal(a.mvWithCost, 1000 * 50 + 200 * 60);
  assert.equal(a.monthly, 3000);
  assert.equal(a.n, 3);
  assert.deepEqual(a.noQuote, ['9999']);
  assert.equal(a.rows[0].code, '0050');
  const b = summarize('QQ', hs, plans, quotes);
  assert.equal(b.monthly, 2000);
  const c = compareHoldings(a, b);
  assert.equal(c.both, 1);
  assert.deepEqual(c.onlyA.sort(), ['00646', '9999']);
  assert.deepEqual(c.onlyB, []);
});

test('持股清理與改名', () => {
  const hs = cleanHoldings([{ who: 'QQ', code: '0050', shares: '2000', cost: '' }, { code: 'x', shares: 0 }, { name: '', code: '' }, null]);
  assert.equal(hs.length, 1);
  assert.equal(hs[0].shares, 2000);
  assert.equal(hs[0].cost, undefined);
  const r = renamePerson({ people: ['我', '小孩'], plans: [plan({ who: '小孩' })], holdings: [hold({ who: '小孩' })] }, '小孩', '莎莎');
  assert.deepEqual(r.people, ['我', '莎莎']);
  assert.equal(r.plans[0].who, '莎莎');
  assert.equal(r.holdings[0].who, '莎莎');
  // 改成已經存在的名字＝合併
  assert.deepEqual(renamePerson({ people: ['莎莎', '小孩'], plans: [], holdings: [] }, '小孩', '莎莎').people, ['莎莎']);
});
