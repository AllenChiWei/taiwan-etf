/* 行事曆：規則推算的日子與篩選。日期都用固定值，不看今天。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  thirdWednesday, ruleEvents, allEvents, filterEvents, groupByDate, dayLabel, daysUntil,
  exdivEvent, etfExDivMonth, shiftMonth, type CalendarData, type EventKind, type EtfInfo,
} from '../src/lib/calendar.ts';

test('第三個星期三（期交所月結算日）', () => {
  assert.equal(thirdWednesday(2026, 10), '2026-10-21');   // 10/1 是星期四
  assert.equal(thirdWednesday(2026, 9), '2026-09-16');    // 9/1 是星期二
  assert.equal(thirdWednesday(2026, 7), '2026-07-15');    // 7/1 是星期三：第三個是 15 號
});

test('財報法定期限：3/31、5/15、8/14、11/14；月營收每月 10 日', () => {
  const ev = ruleEvents('2026-01-01', '2026-12-31');
  const reports = ev.filter(e => e.kind === 'report').map(e => e.d);
  assert.deepEqual(reports, ['2026-03-31', '2026-05-15', '2026-08-14', '2026-11-14']);
  const rev = ev.filter(e => e.kind === 'revenue');
  assert.equal(rev.length, 12);
  assert.equal(rev[0].title, '12 月營收公告期限');           // 1 月 10 日公告的是去年 12 月
  assert.equal(ev.find(e => e.d === '2026-03-31')!.title, '2025 年度財報公告期限');
});

test('規則事件只在區間內', () => {
  const ev = ruleEvents('2026-09-27', '2026-10-31');
  assert.deepEqual(ev.map(e => `${e.d} ${e.kind}`),
    ['2026-10-10 revenue', '2026-10-21 settle']);
});

const DATA: CalendarData = {
  meta: { updated: '2026-09-27', until: '2027-01-25', source: '', errors: [] },
  exdiv: [
    { d: '2026-10-08', code: '00400A', name: '主動國泰動能高息', k: '息', cash: null, stock: null, m: 'twse' },
    { d: '2026-09-29', code: '2109', name: '華豐', k: '息', cash: 0.5, stock: null, m: 'twse' },
  ],
  meetings: [
    { d: '2026-09-29', code: '3489', name: '森寶', k: '臨時會', elect: true, place: '桃園', m: 'tpex' },
  ],
};

test('合併後依日期排序，同一天公告事件在前', () => {
  const ev = allEvents(DATA, '2026-09-27', '2026-10-31');
  assert.deepEqual(ev.map(e => e.code ?? e.kind),
    ['2109', '3489', '00400A', 'revenue', 'settle']);
  assert.equal(ev[0].title, '華豐 除息');
  assert.equal(ev[0].detail, '現金 0.5 元（上市）');
  assert.equal(ev[1].detail, '改選董監・桃園');
});

test('ETF 還沒公告金額時寫「金額待公告」而不是 0', () => {
  assert.equal(exdivEvent(DATA.exdiv[0]).detail, '金額待公告（上市）');
});

test('篩選：類別、關鍵字、只看我的（規則事件不受「只看我的」影響）', () => {
  const ev = allEvents(DATA, '2026-09-27', '2026-10-31');
  const all = new Set<EventKind>(['exdiv', 'meeting', 'report', 'revenue', 'settle']);
  assert.equal(filterEvents(ev, { kinds: new Set(['meeting']), query: '', mine: null }).length, 1);
  assert.deepEqual(filterEvents(ev, { kinds: all, query: '華豐', mine: null }).map(e => e.code),
    ['2109']);
  assert.deepEqual(
    filterEvents(ev, { kinds: all, query: '', mine: new Set(['00400A']) }).map(e => e.code ?? e.kind),
    ['00400A', 'revenue', 'settle']);
});

test('分組與日期文字', () => {
  const g = groupByDate(allEvents(DATA, '2026-09-27', '2026-10-31'));
  assert.deepEqual(g.map(x => [x.d, x.items.length]),
    [['2026-09-29', 2], ['2026-10-08', 1], ['2026-10-10', 1], ['2026-10-21', 1]]);
  assert.equal(dayLabel('2026-10-08'), '10/8（四）');
  assert.equal(daysUntil('2026-09-29', '2026-09-27'), 2);
});

// ── ETF 除息月曆 ──

const ETFS = new Map<string, EtfInfo>([
  ['00400A', { name: '主動國泰動能高息', freq: '月配' }],
  ['00939', { name: '統一台灣高息動能', freq: '月配' }],
]);

const DIVS: Record<string, [string, number, number][]> = {
  '00939': [['2026-08-01', 0.12, 1], ['2026-09-01', 0.125, 1]],
  '00400A': [['2026-09-07', 0.12, 1]],
  '2881': [['2026-09-10', 1.5, 1]],                       // 個股：不收
  '00999': [['2026-09-20', 0.3, 0]],                      // 不在清單但代號像 ETF；權息合併計價
};

test('ETF 除息月曆：合併配息紀錄與預告、只收 ETF、只收該月', () => {
  const rows = etfExDivMonth('2026-09', DIVS, DATA, ETFS);
  assert.deepEqual(rows.map(r => `${r.d} ${r.code}`),
    ['2026-09-01 00939', '2026-09-07 00400A', '2026-09-20 00999']);
  assert.equal(rows[0].name, '統一台灣高息動能');
  assert.equal(rows[0].freq, '月配');
  assert.equal(rows[2].name, '00999');                      // 兩邊都沒有名稱時用代號
  assert.equal(rows[2].exact, false);
});

test('ETF 除息月曆：只有預告的也列出，金額未公布是 null 而不是 0', () => {
  const rows = etfExDivMonth('2026-10', DIVS, DATA, ETFS);
  assert.equal(rows.length, 1);                             // 00400A 10/8 預告；2109 是個股
  assert.equal(rows[0].code, '00400A');
  assert.equal(rows[0].cash, null);
});

test('ETF 除息月曆：同一檔同一天兩邊都有只留一筆，金額以配息紀錄為準', () => {
  const cal: CalendarData = {
    ...DATA,
    exdiv: [{ d: '2026-09-07', code: '00400A', name: '主動國泰動能高息', k: '息', cash: 0.2, stock: null, m: 'twse' }],
  };
  const rows = etfExDivMonth('2026-09', DIVS, cal, ETFS).filter(r => r.code === '00400A');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cash, 0.12);
  // 配息紀錄缺席時用預告的金額
  assert.equal(etfExDivMonth('2026-09', null, cal, ETFS)[0].cash, 0.2);
});

test('月份加減跨年', () => {
  assert.equal(shiftMonth('2026-09', 1), '2026-10');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-09', -12), '2025-09');
});
