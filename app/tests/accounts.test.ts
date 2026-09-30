/* 配息試算的多帳戶：舊資料的升級、合併、改名與刪除。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  accountList, withAccounts, nextAccountName, mergeByCode, renameAccount, removeAccount,
  addHolding, entryKey, DEFAULT_ACCOUNT, type AcctEntry,
} from '../src/lib/accounts.ts';

test('舊資料（沒有 acct）全部歸到第一個帳戶，畫面跟升級前一樣', () => {
  const old: AcctEntry[] = [{ code: '0056', shares: 10000 }, { code: 'SCHD', shares: 500, m: 'us' }];
  const accts = accountList([], old);
  assert.deepEqual(accts, [DEFAULT_ACCOUNT]);
  assert.deepEqual(withAccounts(old, accts[0]).map(e => e.acct), ['帳戶A', '帳戶A']);
});

test('帳戶清單：存下的順序在前，持股裡多出來的補在後', () => {
  const e: AcctEntry[] = [{ code: '0056', shares: 1, acct: '復華' }, { code: '0050', shares: 1, acct: '帳戶A' }];
  assert.deepEqual(accountList(['帳戶A', '空帳戶'], e), ['帳戶A', '空帳戶', '復華']);
});

test('下一個預設名稱跳過已用的', () => {
  assert.equal(nextAccountName(['帳戶A']), '帳戶B');
  assert.equal(nextAccountName(['帳戶A', '帳戶B', '元大']), '帳戶C');
});

test('總帳戶：同一檔在兩個帳戶合併股數；美股與台股同代號不合併', () => {
  const e: AcctEntry[] = [
    { code: '0056', shares: 1000, acct: '帳戶A' },
    { code: '00878', shares: 2000, acct: '帳戶A' },
    { code: '0056', shares: 3000, acct: '帳戶B' },
    { code: 'QQQ', shares: 10, m: 'us', acct: '帳戶B' },
  ];
  assert.deepEqual(mergeByCode(e), [
    { code: '0056', shares: 4000 }, { code: '00878', shares: 2000 },
    { code: 'QQQ', m: 'us', shares: 10 },
  ]);
});

test('改名：帶著持股一起改；空白或重名不改', () => {
  const e: AcctEntry[] = [{ code: '0056', shares: 1, acct: '帳戶A' }, { code: '0050', shares: 1, acct: '帳戶B' }];
  const r = renameAccount(['帳戶A', '帳戶B'], e, '帳戶A', ' 國泰 ')!;
  assert.deepEqual(r.accounts, ['國泰', '帳戶B']);
  assert.deepEqual(r.entries.map(x => x.acct), ['國泰', '帳戶B']);
  assert.equal(renameAccount(['帳戶A', '帳戶B'], e, '帳戶A', '帳戶B'), null);
  assert.equal(renameAccount(['帳戶A', '帳戶B'], e, '帳戶A', '  '), null);
});

test('刪帳戶連同持股；最後一個不能刪', () => {
  const e: AcctEntry[] = [{ code: '0056', shares: 1, acct: '帳戶A' }, { code: '0050', shares: 1, acct: '帳戶B' }];
  const r = removeAccount(['帳戶A', '帳戶B'], e, '帳戶B')!;
  assert.deepEqual(r.accounts, ['帳戶A']);
  assert.deepEqual(r.entries.map(x => x.code), ['0056']);
  assert.equal(removeAccount(['帳戶A'], e, '帳戶A'), null);
});

test('同一帳戶重複加入同一檔是加股數，不同帳戶是另一筆', () => {
  let e: AcctEntry[] = [{ code: '0056', shares: 1000, acct: '帳戶A' }];
  e = addHolding(e, { code: '0056', shares: 500, acct: '帳戶A' });
  assert.deepEqual(e, [{ code: '0056', shares: 1500, acct: '帳戶A' }]);
  e = addHolding(e, { code: '0056', shares: 200, acct: '帳戶B' });
  assert.equal(e.length, 2);
  assert.notEqual(entryKey(e[0]), entryKey(e[1]));
});
