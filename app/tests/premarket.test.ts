/* 盤前作戰卡純邏輯測試：週選挑選、重疊點位合併、手機 390px 防重疊排布、跨檔彙總與缺檔容錯。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  buildAxisModel, buildPremarketSummary, contractShort, fmtInt, layoutAxisLabels, pickOptionContracts, shortDate,
  type PlacedLabel,
} from '../src/lib/premarket.ts';
import type { NextdayData } from '../src/lib/nextday.ts';
import type { AtmData, AtmRow } from '../src/lib/atm.ts';
import type { ChipsData } from '../src/lib/chips.ts';
import type { RetailData } from '../src/lib/retail.ts';
import type { CalendarData } from '../src/lib/calendar.ts';

function mkNextday(over: {
  date?: string; next?: string; close?: number;
  b95?: [number, number]; b99?: [number, number];
  fu?: number; fd?: number; maintVal?: number | null; maintDate?: string | null;
} = {}): NextdayData {
  const [dn95, up95] = over.b95 ?? [-0.022, 0.02];
  const [dn99, up99] = over.b99 ?? [-0.036, 0.031];
  return {
    meta: {
      updated: over.date ?? '2026-11-25',
      date: over.date ?? '2026-11-25',
      close: over.close ?? 38000,
      next: over.next ?? '2026-11-26',
      gap: 1,
      regime: 'normal',
      sigma: 0.015,
      since: '2000-01-04',
      samples: 5000,
      limit: 0.1,
      counts: { normal: 5000, weekend: 1000, holiday: 150 },
      mult99: { normal: [2.3, -2.9], weekend: [2.7, -3.3], holiday: [3.5, -5.1] },
      checkFrom: '2023-11-25',
      checkDays: 700,
      source: 'test',
    },
    bands: [
      { p: 0.9, up: up95 * 0.8, dn: dn95 * 0.8, c: 0.02 },
      { p: 0.95, up: up95, dn: dn95, c: 0.025 },
      { p: 0.99, up: up99, dn: dn99, c: 0.04 },
    ],
    check: [],
    recent: [],
    extremes: {
      H: { v: 0.09, d: '2025-04-09', d1: '2025-04-10' },
      L: { v: -0.09, d: '2025-04-02', d1: '2025-04-07' },
      Cup: { v: 0.09, d: '2025-04-09', d1: '2025-04-10' },
      Cdn: { v: -0.09, d: '2025-04-02', d1: '2025-04-07' },
    },
    state: {
      fu: over.fu ?? 1.0,
      fd: over.fd ?? 1.0,
      whyUp: [{ k: 'ret5', label: '5 日漲跌', x: -0.04, c: 0.12 }],
      whyDn: [{ k: 'dkeep1', label: '維持率今天變化', x: -3.2, c: 0.18 }],
    },
    maint: {
      value: over.maintVal === undefined ? 168.5 : over.maintVal,
      date: over.maintDate === undefined ? '2026-11-25' : over.maintDate,
      thr: 165,
      low: (over.maintVal ?? 168.5) < 165,
      lowDays: 500,
      below140: { days: 0, avgC: 0 },
    },
  };
}

function mkAtm(rows: AtmRow[], taiex: Record<string, number> = { '2026-11-25': 38000 }): AtmData {
  return {
    meta: {
      updated: '2026-11-26', latest: '2026-11-25', days: 100, counts: { wed: 100, fri: 100 },
      minPairs: 20, source: 'TAIFEX', note: '', errors: [],
    },
    rows,
    taiex,
  };
}

function assertNoOverlap(items: PlacedLabel[], width: number, gap: number) {
  const byLane = new Map<number, PlacedLabel[]>();
  for (const it of items) {
    assert.ok(it.left >= -1e-6, `${it.id} 超出左邊界 (${it.left})`);
    assert.ok(it.right <= width + 1e-6, `${it.id} 超出右邊界 (${it.right} > ${width})`);
    const list = byLane.get(it.lane) ?? [];
    list.push(it);
    byLane.set(it.lane, list);
  }
  for (const [lane, list] of byLane) {
    list.sort((a, b) => a.left - b.left);
    for (let i = 1; i < list.length; i++) {
      assert.ok(
        list[i - 1].right + gap <= list[i].left + 1e-6,
        `lane ${lane} 重疊：${list[i - 1].id}(${list[i - 1].right.toFixed(1)}) 與 ${list[i].id}(${list[i].left.toFixed(1)})`,
      );
    }
  }
}

test('格式小工具', () => {
  assert.equal(fmtInt(38195.43), '38,195');
  assert.equal(fmtInt(-1234.6), '−1,235');
  assert.equal(shortDate('2026-11-25'), '11/25');
  assert.equal(contractShort('202611F4'), 'F4');
  assert.equal(contractShort('202612'), '月選');
});

test('週選合約挑選：排除到期當日，預設取最近到期且標示剛換倉偏薄', () => {
  const atm = mkAtm([
    { d: '2026-11-25', s: 'wed', r: 0, c: '202611W4', e: '2026-11-25', dte: 0, k: 38000, call: 1, put: 10, diff: 9, sum: 11, pairs: 50, thin: 0 },
    { d: '2026-11-25', s: 'wed', r: 1, c: '202612W1', e: '2026-12-02', dte: 7, k: 37800, call: 1300, put: 1300, diff: 0, sum: 2600, pairs: 120, thin: 0, cw: [[41000, 900]], pw: [[34000, 300]], coi: 5000, poi: 2000 },
    { d: '2026-11-25', s: 'fri', r: 0, c: '202611F4', e: '2026-11-27', dte: 2, k: 37950, call: 980, put: 955, diff: 25, sum: 1935, pairs: 200, thin: 0, cw: [[43000, 5800]], pw: [[32400, 1700]], coi: 37000, poi: 8000 },
  ]);
  const picked = pickOptionContracts(atm, '2026-11-26');
  assert.equal(picked.defaultSeries, 'fri');
  assert.equal(picked.list.length, 2);
  assert.equal(picked.list[0].contract, '202611F4');
  assert.equal(picked.list[0].thin, false);
  assert.equal(picked.list[1].contract, '202612W1');
  assert.equal(picked.list[1].thin, true);                 // 總 OI 7,000 < 15,000

  assert.deepEqual(pickOptionContracts(null, '2026-11-26'), { list: [], defaultSeries: null });
});

test('高波動頂到漲跌停：重合點位合併、超出 ±10% 的 OI 牆不被截斷', () => {
  const nd = mkNextday({ close: 38195.43, b95: [-0.1, 0.09153], b99: [-0.1, 0.1] });
  const atm = mkAtm([
    { d: '2026-11-25', s: 'fri', r: 0, c: '202611F4', e: '2026-11-27', dte: 2, k: 37950, call: 985, put: 950, diff: 35, sum: 1935, pairs: 250, thin: 0, cw: [[43000, 5874]], pw: [[32400, 1694]], coi: 37336, poi: 7980 },
  ], { '2026-11-25': 38195.43 });
  const opt = pickOptionContracts(atm, '2026-11-26').list[0];
  const axis = buildAxisModel(nd, opt);

  assert.ok(axis.min < 32400 && axis.max > 43000, '值域必須涵蓋 ±10% 以外的 Put/Call 牆');
  const topLabels = axis.topMarkers.map(m => m.label);
  assert.ok(topLabels.includes('跌停/95%/99%'), `應合併下緣重合標籤，實際：${topLabels.join(', ')}`);
  assert.ok(topLabels.includes('漲停/99%'), `應合併上緣重合標籤，實際：${topLabels.join(', ')}`);
  assert.ok(topLabels.includes('95%上') && topLabels.includes('收盤'));
  assert.equal(axis.topMarkers.length, 4);
  assert.equal(axis.bottomMarkers.length, 4);
});

test('防重疊排布：手機 390px（寬 330px）與寬螢幕（1000px）平靜與劇烈行情皆不重疊不溢出', () => {
  const calm = buildAxisModel(
    mkNextday({ close: 38000, b95: [-0.015, 0.014], b99: [-0.025, 0.023] }),
    {
      series: 'fri', contract: '202611F4', expiry: '2026-11-27', dte: 2, day: '2026-11-25',
      straddle: 600, straddleIndex: 38000, straddleLow: 37400, straddleHigh: 38600,
      callWall: { strike: 39000, oi: 6200 }, putWall: { strike: 37000, oi: 5400 },
      callOi: 50000, putOi: 45000, thin: false,
    },
  );
  for (const [w, compact] of [[330, true], [1000, false]] as const) {
    const top = layoutAxisLabels(calm.topMarkers, calm.min, calm.max, w, 12, 12, compact);
    const bot = layoutAxisLabels(calm.bottomMarkers, calm.min, calm.max, w, 12, 12, compact);
    assert.equal(top.items.length, calm.topMarkers.length);
    assert.equal(bot.items.length, calm.bottomMarkers.length);
    assertNoOverlap(top.items, w, top.gap);
    assertNoOverlap(bot.items, w, bot.gap);
  }
});

test('跨檔彙總：完整資料、結算日、重大事件與時間差提醒', () => {
  const nd = mkNextday({ date: '2026-11-25', next: '2026-11-27', fu: 1.0, fd: 1.28, maintVal: 161.9, maintDate: '2026-11-24' });
  const atm = mkAtm([
    { d: '2026-11-25', s: 'fri', r: 0, c: '202611F4', e: '2026-11-27', dte: 2, k: 38000, call: 900, put: 900, diff: 0, sum: 1800, pairs: 200, thin: 0 },
  ]);
  const chips = {
    meta: { date: '2026-11-25', updated: '2026-11-25', source: '', note: '' },
    futures: [], options: [], large: { fut: [], opt: [] }, top: { twse: null, tpex: null },
    futHistory: {
      dates: ['2026-11-24', '2026-11-25'],
      contracts: {
        臺股期貨: { 外資: [-30000, -32000] },
        小型臺指期貨: { 外資: [4000, 8000], 投信: [0, 0], 自營商: [-1000, -2000] },
        微型臺指期貨: { 外資: [20000, 0] },
      },
      oi: { 小型臺指期貨: [40000, 40000] },
    },
    pc: { dates: ['2026-11-25'], vol: [100], oi: [100] },
    margin: {
      dates: ['2026-11-24', '2026-11-25'], money: [3000e8, 2950e8], lots: [], short: [], maint: null,
      keepHist: [['2026-11-24', 161.9, 1], ['2026-11-25', 154.2, 1]],
    },
  } as unknown as ChipsData;
  const cal: CalendarData = {
    meta: { updated: '2026-11-26', until: '2027-02-01', source: '', errors: [] },
    exdiv: [{ d: '2026-11-27', code: '0050', name: '元大台灣50', k: '息', cash: 1, stock: null, m: 'twse' }],
    meetings: [],
    calls: [{ d: '2026-11-26', end: '2026-11-28', code: '2330', name: '台積電', m: 'twse', t: '14:00', place: '線上', topic: 'NDR' }],
  };

  const sum = buildPremarketSummary({ nextday: nd, atm, chips, calendar: cal });
  // chips 維持率比 nextday 新，優先採用 chips（154.2%，加速區 level 2）
  assert.equal(sum.maint?.value, 154.2);
  assert.equal(sum.maint?.source, 'chips');
  assert.equal(sum.maint?.level, 2);
  assert.ok(Math.abs((sum.maint?.delta ?? 0) - (154.2 - 161.9)) < 1e-6);
  // 狀態放寬
  assert.equal(sum.state?.wide, true);
  assert.deepEqual(sum.state?.topReasons, ['維持率今天變化']);
  // 外資大台約當：-32000 + 8000/4 + 0 = -30000；前日 -30000 + 4000/4 + 20000/20 = -28000 → delta = -2000
  assert.equal(sum.foreignTx?.net, -30000);
  assert.equal(sum.foreignTx?.delta, -2000);
  // 散戶多空比：法人淨額 8000 - 2000 = +6000 → 散戶淨空 -6000 / 40000 = -15%
  assert.equal(sum.retailMtx?.ratio, -15);
  // 2026-11-27 是 202611F4 結算日
  assert.equal(sum.settle.isSettle, true);
  assert.equal(sum.settle.label, '週五週選');
  // 重要事件：跨日 NDR（台積電）＋ 0050 除息；且 calendar.updated=11-26 不應觸發收盤資料時間差警告
  assert.equal(sum.events.important, true);
  assert.equal(sum.events.callsCount, 1);
  assert.equal(sum.events.exdivCount, 1);
  assert.match(sum.events.detail, /台積電法說/);
  assert.equal(sum.hasDateMismatch, false);
});

test('缺檔容錯：沒有 chips／atm／calendar 時不壞掉，散戶退回 retail.json、結算日與營收期限退回規則', () => {
  const nd = mkNextday({ date: '2026-11-09', next: '2026-11-10', maintVal: 162.0, maintDate: '2026-11-06' });
  const retail: RetailData = {
    meta: { updated: '2026-11-09', latest: '2026-11-09', source: '', note: '', errors: [] },
    contracts: {
      MTX: { name: '小型臺指期貨', days: { '2026-11-06': [40000, 10000, 12000], '2026-11-09': [40000, 10000, 14000] } },
    },
    taiex: { '2026-11-09': 38000 },
  };

  const sum = buildPremarketSummary({ nextday: nd, atm: null, chips: null, retail, calendar: null });
  assert.equal(sum.maint?.source, 'nextday');
  assert.equal(sum.maint?.value, 162.0);
  assert.equal(sum.foreignTx, null);
  assert.equal(sum.retailMtx?.source, 'retail');
  assert.equal(sum.retailMtx?.ratio, 10);                  // (14000 - 10000) / 40000 = +10%
  assert.equal(sum.settle.source, 'rule');
  assert.equal(sum.settle.isSettle, false);
  assert.equal(sum.events.calendarLoaded, false);
  assert.equal(sum.events.important, true);                // 11/10 是 10 月營收公告期限
  assert.match(sum.events.summary, /營收/);
  assert.equal(sum.hasDateMismatch, true);                 // nextday 11-09 vs maint 11-06
});

const ND_PATH = new URL('../public/data/nextday.json', import.meta.url);
const ATM_PATH = new URL('../public/data/atm.json', import.meta.url);
const RETAIL_PATH = new URL('../public/data/retail.json', import.meta.url);

test('真實資料整合：盤前作戰卡點位軸在手機與桌機皆無重疊，摘要可正常組出', {
  skip: (!existsSync(ND_PATH) || !existsSync(ATM_PATH)) && '缺少 nextday.json 或 atm.json',
}, () => {
  const nd = JSON.parse(readFileSync(ND_PATH, 'utf8')) as NextdayData;
  const atm = JSON.parse(readFileSync(ATM_PATH, 'utf8')) as AtmData;
  const retail = existsSync(RETAIL_PATH) ? JSON.parse(readFileSync(RETAIL_PATH, 'utf8')) as RetailData : null;
  const picked = pickOptionContracts(atm, nd.meta.next, { date: nd.meta.date, close: nd.meta.close });
  const opt = picked.list.find(o => o.series === picked.defaultSeries) ?? null;
  const axis = buildAxisModel(nd, opt);

  for (const [w, compact] of [[336, true], [1200, false]] as const) {
    const top = layoutAxisLabels(axis.topMarkers, axis.min, axis.max, w, 12, 12, compact);
    const bot = layoutAxisLabels(axis.bottomMarkers, axis.min, axis.max, w, 12, 12, compact);
    assertNoOverlap(top.items, w, top.gap);
    assertNoOverlap(bot.items, w, bot.gap);
  }
  const sum = buildPremarketSummary({ nextday: nd, atm, chips: null, retail, calendar: null, selectedOption: opt });
  assert.ok(sum.dates.length === 6);
  if (retail) assert.ok(sum.retailMtx !== null, '無 chips.json 時應退回 retail.json');
});
