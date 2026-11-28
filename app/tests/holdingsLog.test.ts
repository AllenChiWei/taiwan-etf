/* 持股變動紀錄（lib/holdingsLog.ts）：同日覆蓋、舊格式相容、加減碼比對與加密同步清理。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanHoldingsLog,
  cleanHoldingsSyncPayload,
  collectLogAssets,
  diffHoldings,
  ensureHoldingsLog,
  parseHoldingsLog,
  recordHoldingsLog,
  resolveHoldingsLog,
  taipeiDate,
  type HoldingsSnapshot,
} from '../src/lib/holdingsLog.ts';
import type { AcctEntry } from '../src/lib/accounts.ts';

test('台北日期轉換（UTC+8，跨日正確）', () => {
  // 2026-11-27T16:30:00Z 在台北已是 2026-11-28 00:30
  assert.equal(taipeiDate(new Date('2026-11-27T16:30:00Z')), '2026-11-28');
  assert.equal(taipeiDate(new Date('2026-11-28T15:59:59Z')), '2026-11-28');
});

test('同日多次修改只留最後一筆，跨日附加並依日期排序', () => {
  let log: HoldingsSnapshot[] = [];
  log = recordHoldingsLog(log, [{ code: '0050', shares: 1000, acct: '帳戶A' }], '2026-11-25');
  log = recordHoldingsLog(log, [{ code: '0050', shares: 2000, acct: '帳戶A' }], '2026-11-25');
  assert.equal(log.length, 1);
  assert.equal(log[0].holdings[0].shares, 2000);

  log = recordHoldingsLog(log, [
    { code: '0050', shares: 2000, acct: '帳戶A' },
    { code: 'VOO', shares: 10, m: 'us', acct: '帳戶B' },
  ], '2026-11-27');
  log = recordHoldingsLog(log, [{ code: '0050', shares: 1500, acct: '帳戶A' }], '2026-11-26');
  assert.deepEqual(log.map(s => s.date), ['2026-11-25', '2026-11-26', '2026-11-27']);
  assert.equal(log[2].holdings[1].m, 'us');
});

test('清倉（空陣列）快照應保留，無效日期或損毀 JSON 安全忽略', () => {
  const log = recordHoldingsLog(
    [{ date: '2026-11-25', holdings: [{ code: '0050', shares: 1000 }] }],
    [],
    '2026-11-26',
  );
  assert.equal(log.length, 2);
  assert.deepEqual(log[1], { date: '2026-11-26', holdings: [] });

  assert.deepEqual(parseHoldingsLog('not-json'), []);
  assert.deepEqual(
    cleanHoldingsLog([
      { date: '2026-02-30', holdings: [{ code: '0050', shares: 1000 }] },
      { date: '2026-11-25', holdings: [{ code: ' 0050 ', shares: 500 }, { code: '0056', shares: -1 }] },
    ]),
    [{ date: '2026-11-25', holdings: [{ code: '0050', shares: 500 }] }],
  );
});

test('舊格式相容：無紀錄時用目前持股當第一筆；外部改過持股自動補齊', () => {
  const cur: AcctEntry[] = [{ code: '0050', shares: 1000, acct: '帳戶A' }];
  const seeded = ensureHoldingsLog([], cur, '2026-11-28');
  assert.deepEqual(seeded, [{ date: '2026-11-28', holdings: cur }]);
  assert.deepEqual(ensureHoldingsLog([], [], '2026-11-28'), []);

  // 最後一筆與目前相同時不新增
  const existing: HoldingsSnapshot[] = [{ date: '2026-11-20', holdings: cur }];
  assert.deepEqual(resolveHoldingsLog(existing, cur, '2026-11-28'), existing);

  // 最後一筆與目前不同時在 today 補記
  const changed: AcctEntry[] = [{ code: '0050', shares: 2000, acct: '帳戶A' }];
  const resolved = resolveHoldingsLog(existing, changed, '2026-11-28');
  assert.deepEqual(resolved.map(s => s.date), ['2026-11-20', '2026-11-28']);
  assert.equal(resolved[1].holdings[0].shares, 2000);
});

test('加減碼比對：多帳戶合併、僅搬帳戶不算加減碼、美股個股保留 k', () => {
  const a: AcctEntry[] = [
    { code: '0050', shares: 1000, acct: '帳戶A' },
    { code: '0056', shares: 2000, acct: '帳戶A' },
    { code: 'ANT', shares: 5, m: 'us', k: 'stock', acct: '帳戶B' },
  ];
  // 僅把 0050 拆到兩個帳戶但合計仍 1000 股 → 不應視為加減碼
  const moved: AcctEntry[] = [
    { code: '0050', shares: 400, acct: '帳戶A' },
    { code: '0050', shares: 600, acct: '帳戶B' },
    { code: '0056', shares: 2000, acct: '帳戶A' },
    { code: 'ANT', shares: 5, m: 'us', k: 'stock', acct: '帳戶B' },
  ];
  assert.deepEqual(diffHoldings(a, moved), []);

  const b: AcctEntry[] = [
    { code: '0050', shares: 1500, acct: '帳戶A' },
    { code: '2330', shares: 300, acct: '帳戶A' },
    { code: 'ANT', shares: 2, m: 'us', k: 'stock', acct: '帳戶B' },
  ];
  const diffs = diffHoldings(a, b);
  assert.deepEqual(
    diffs.map(d => ({ code: d.code, kind: d.kind, delta: d.delta, k: d.k })),
    [
      { code: '2330', kind: 'add', delta: 300, k: undefined },
      { code: '0050', kind: 'increase', delta: 500, k: undefined },
      { code: 'ANT', kind: 'decrease', delta: -3, k: 'stock' },
      { code: '0056', kind: 'remove', delta: -2000, k: undefined },
    ],
  );
});

test('加密同步格式清理：相容舊版 v1（無 log）與新版 v2（含 log）', () => {
  const v1 = cleanHoldingsSyncPayload({
    v: 1,
    generated: '2026-11-20 10:00:00',
    accounts: ['帳戶A'],
    holdings: [{ code: '0050', shares: 1000, acct: '帳戶A' }],
  });
  assert.equal(v1.holdings.length, 1);
  assert.deepEqual(v1.log, []);

  const v2 = cleanHoldingsSyncPayload({
    v: 2,
    generated: '2026-11-28 10:00:00',
    accounts: ['帳戶A', '帳戶B'],
    holdings: [{ code: '0050', shares: 2000, acct: '帳戶A' }],
    log: [
      { date: '2026-11-20', holdings: [{ code: '0050', shares: 1000, acct: '帳戶A' }] },
      { date: '2026-11-28', holdings: [{ code: '0050', shares: 2000, acct: '帳戶A' }] },
    ],
  });
  assert.equal(v2.log.length, 2);
  assert.deepEqual(collectLogAssets(v2.log).map(a => a.key), ['tw:0050']);
});
