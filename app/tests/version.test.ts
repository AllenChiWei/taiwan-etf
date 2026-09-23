/* 部署後自動更新：什麼情況重新整理、什麼情況只提示。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideUpdate } from '../src/lib/version.ts';

test('版本相同或查不到時什麼都不做', () => {
  assert.equal(decideUpdate('abc', 'abc', { returning: true, pathname: '/' }), 'none');
  assert.equal(decideUpdate('abc', null, { returning: true, pathname: '/' }), 'none');
});

test('切回分頁時直接重新整理，正在看時倒數', () => {
  assert.equal(decideUpdate('abc', 'def', { returning: true, pathname: '/' }), 'reload');
  assert.equal(decideUpdate('abc', 'def', { returning: false, pathname: '/chips' }), 'countdown');
});

test('對帳單頁只提示：上傳的檔案在記憶體裡，自動重新整理會清掉', () => {
  assert.equal(decideUpdate('abc', 'def', { returning: true, pathname: '/futures' }), 'prompt');
  assert.equal(decideUpdate('abc', 'def', { returning: false, pathname: '/futures' }), 'prompt');
});
