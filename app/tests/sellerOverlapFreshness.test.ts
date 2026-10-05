/* 賣方決策卡、持股重疊、資料過期判斷的純函式測試 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { tradingDaysBetween, realizedVol, impliedVol, decisionOn, latestDecision, pastEntries, RULE } from '../src/lib/sellerCard.ts';
import { overlapPair, overlapPairs } from '../src/lib/overlap.ts';
import { missedTradingDays } from '../src/lib/freshness.ts';
import type { AtmData, AtmRow } from '../src/lib/atm.ts';
import type { Top10Data } from '../src/lib/top10.ts';

function row(over: Partial<AtmRow> & { d: string }): AtmRow {
  return { s: 'wed', r: 1, c: '202610W2', e: '2026-10-14', dte: 12, k: 48500, call: 595, put: 595,
           diff: 0, sum: 1190, pairs: 141, thin: 0, ...over } as AtmRow;
}

test('交易日天數：週末不算', () => {
  assert.equal(tradingDaysBetween('2026-10-02', '2026-10-14'), 8);   // 10/2 週五 → 10/14 週三
  assert.equal(tradingDaysBetween('2026-10-07', '2026-10-07'), 0);
});

test('實際波動：每天同樣漲 1% → 波動 0；資料不足回 null', () => {
  const tx: Record<string, number> = {};
  let p = 100;
  for (let i = 0; i < 25; i++) { tx[`2026-09-${String(i + 1).padStart(2, '0')}`] = p; p *= 1.01; }
  assert.ok(Math.abs(realizedVol(tx, '2026-09-25')!) < 1e-9);
  assert.equal(realizedVol({ '2026-09-01': 1 }, '2026-09-01'), null);
});

test('預期波動：價平和 1190、標的 48500、8 個交易日', () => {
  const v = impliedVol(row({ d: '2026-10-02' }))!;
  assert.equal(v.forward, 48500);
  assert.equal(v.days, 8);
  const expect = 1190 / (0.8 * 48500 * Math.sqrt(8 / 252));
  assert.ok(Math.abs(v.iv - expect) < 1e-12);
});

test('決策：結算日判斷、建議履約價取 50 點整數往外', () => {
  const tx: Record<string, number> = {};
  const base = Date.parse('2026-08-20T00:00:00Z');
  for (let i = 0; i < 40; i++) tx[new Date(base + i * 86400000).toISOString().slice(0, 10)] = 48000 * (1 + 0.004 * Math.sin(i));
  const data: AtmData = {
    meta: {} as AtmData['meta'], taiex: tx,
    rows: [row({ d: '2026-09-23', r: 0, c: '202609W4', e: '2026-09-23', dte: 0, sum: 1, call: 1, put: 0, k: 48000 }),
           row({ d: '2026-09-23', r: 1, c: '202610W1', e: '2026-09-30', dte: 7, sum: 800, k: 48000, call: 400, put: 400 })],
  };
  const d = decisionOn(data, '2026-09-23')!;
  assert.equal(d.entryDay, true);
  assert.equal(d.callStrike, Math.ceil((48000 + RULE.strikeMult * 800) / 50) * 50);
  assert.equal(d.putStrike, Math.floor((48000 - RULE.strikeMult * 800) / 50) * 50);
  assert.equal(d.favorable, d.ratio !== null && d.ratio > RULE.ratioMin);
  assert.equal(pastEntries(data).length, 1);
});

test('真實 atm.json 算得出最新決策', { skip: !existsSync('public/data/atm.json') }, () => {
  const data = JSON.parse(readFileSync('public/data/atm.json', 'utf8')) as AtmData;
  const d = latestDecision(data);
  assert.ok(d);
  assert.ok(d!.iv > 0 && d!.iv < 2, `IV ${d!.iv}`);
  assert.ok(d!.callStrike > d!.forward && d!.putStrike < d!.forward);
});

test('持股重疊：共同持股取較小的比重相加', () => {
  const data = { meta: {} as Top10Data['meta'], etfs: {
    A: { name: 'A', rows: [[1, '國內上市', '2330', '台積電', 10], [2, '國內上市', '2317', '鴻海', 5], [3, '國內上市', '1101', '台泥', 2]] },
    B: { name: 'B', rows: [[1, '國內上市', '2330', '台積電', 6], [2, '國內上市', '2317', '鴻海', 8]] },
    C: { name: 'C', rows: [] },
  } } as unknown as Top10Data;
  const p = overlapPair(data, 'A', 'B');
  assert.equal(p.overlap, 6 + 5);
  assert.deepEqual(p.common.map(c => c.code), ['2330', '2317']);
  const all = overlapPairs(data, ['A', 'B', 'C']);
  assert.deepEqual(all.covered, ['A', 'B']);
  assert.equal(all.pairs.length, 1);
});

test('資料過期：週末不算、今天 21:00 前不算', () => {
  // 2026-10-02 週五的資料，10/05 週一 20:00（台北）→ 0；週一 22:00 → 1；10/07 週三 22:00 → 3
  assert.equal(missedTradingDays('2026-10-02', new Date('2026-10-05T12:00:00Z')), 0);
  assert.equal(missedTradingDays('2026-10-02', new Date('2026-10-05T14:00:00Z')), 1);
  assert.equal(missedTradingDays('2026-10-02', new Date('2026-10-07T14:00:00Z')), 3);
  assert.equal(missedTradingDays('2026-10-05', new Date('2026-10-05T14:00:00Z')), 0);
});

import { equityStats, type EquityRow } from '../src/lib/accountEquity.ts';

test('實盤權益統計：第一天不算損益、回撤取最低、本月加總', () => {
  const r = (d: string, pnl: number, cum: number, dd: number): EquityRow =>
    ({ d, tv: 0, flow: 0, pnl, cum, dd, twr: 0, upl: 0, cpl: 0, fee: 0, margin: 0, risk: 0, oi: 0, taiex: 0 });
  const s = equityStats([r('2026-09-29', 0, 0, 0), r('2026-09-30', 100, 100, 0),
                         r('2026-10-01', -300, -200, -300), r('2026-10-02', 50, -150, -250)])!;
  assert.equal(s.days, 3);
  assert.equal(s.mdd, -300);
  assert.equal(s.dd, -250);
  assert.equal(s.month, -250);
  assert.equal(s.winDays, 2);
  assert.equal(equityStats([]), null);
});
