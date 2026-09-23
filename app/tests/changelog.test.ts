/* 更新日誌的測試：資料本身的形狀，以及「有新東西」小紅點的判斷。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHANGELOG, latestDate, hasUnseen, type ChangeDay } from '../src/lib/changelog.ts';

test('更新日誌的資料', async (t) => {
  await t.test('日期是 YYYY-MM-DD、而且真的存在', () => {
    for (const day of CHANGELOG) {
      assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(new Date(`${day.date}T00:00:00Z`).toISOString().slice(0, 10), day.date);
    }
  });

  await t.test('新到舊、日期不重複 —— 同一天的要併在一起', () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      assert.ok(CHANGELOG[i - 1].date > CHANGELOG[i].date,
        `${CHANGELOG[i - 1].date} 應該在 ${CHANGELOG[i].date} 之後，且不能重複`);
    }
  });

  await t.test('每天至少一條，每條都有字', () => {
    for (const day of CHANGELOG) {
      assert.ok(day.items.length > 0, `${day.date} 是空的`);
      for (const it of day.items) assert.ok(it.text.trim().length > 4, `${day.date} 有一條沒有內容`);
    }
  });
});

test('小紅點', async (t) => {
  const log: ChangeDay[] = [
    { date: '2026-09-23', items: [{ kind: 'new', text: '新的功能' }] },
    { date: '2026-09-20', items: [{ kind: 'fix', text: '舊的修正' }] },
  ];

  await t.test('看過的日期比最新一條舊才亮', () => {
    assert.equal(latestDate(log), '2026-09-23');
    assert.equal(hasUnseen('2026-09-20', log), true);
    assert.equal(hasUnseen('2026-09-23', log), false);
  });

  await t.test('第一次來（沒有紀錄）不亮 —— 每一條對他都是新的，亮了沒有資訊', () => {
    assert.equal(hasUnseen(null, log), false);
  });

  await t.test('沒有任何條目時不亮', () => {
    assert.equal(latestDate([]), null);
    assert.equal(hasUnseen('2026-09-20', []), false);
  });
});
