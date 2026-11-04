/* 可轉債統計。百分位與區間邊界手算對得上才算數 —— 看板上的數字錯一格，
   畫面看起來仍然很合理。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  percentile, cbStats, byIndustry, filterBonds, outPct, addDays, yi,
  ytp, ytm, convertible, cbEvents, marketRows, rankInHistory, CB_PRESETS, MARKET_METRICS,
  type CbBond, type CbUpcoming, type CbData, type CbFilter,
} from '../src/lib/cb.ts';

function bond(p: Partial<CbBond>): CbBond {
  return {
    c: '11011', n: '測試一', s: '1101', sn: '測試', ind: '水泥工業', mk: '上市',
    px: 100, close: 100, chg: 0, vol: 1, val: 100000, cp: 50, cpEff: null, sp: 50, exch: false,
    cv: 100, prem: 0, convS: null, convE: null, putS: null, putE: null, putP: null,
    callS: null, callP: null, end: null, halt: null, tot: 1e8, out: 1e8, coupon: 0,
    issue: '2026-01-01', mat: '2029-01-01', g: '無擔保', ...p,
  };
}

test('percentile 等同 Excel PERCENTILE.INC', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([1, 2, 3, 4], 75), 3.25);           // 位置 2.25
  assert.equal(percentile([10], 90), 10);
  assert.equal(percentile([], 90), null);
});

test('區間邊界：95 算 95~100、120 算 ≥120，累計到最後一格是 100%', () => {
  const rows = [94.99, 95, 99.99, 100, 104.9, 105, 110, 119.99, 120, 150, 200]
    .map((px, i) => bond({ c: String(i), px, close: px }));
  const s = cbStats(rows);
  assert.deepEqual(s.buckets.map(b => b.count), [1, 2, 2, 1, 2, 3]);
  assert.equal(s.buckets.at(-1)!.cum, 100);
  assert.deepEqual(s.high.map(b => b.count), [1, 2]);       // 120 在 120~150；150、200 在 ≥150
});

test('只算有成交：沒成交的不進樣本，但 untraded 照算', () => {
  const rows = [bond({ c: 'a', close: null, px: 99 }), bond({ c: 'b', px: 130, close: 130 })];
  assert.equal(cbStats(rows).valid, 2);
  const t = cbStats(rows, true);
  assert.equal(t.valid, 1);
  assert.equal(t.untraded, 1);
  assert.equal(t.avgPx, 130);
});

test('價內平均溢價率只算轉換價值 ≥ 100 的', () => {
  const rows = [
    bond({ c: 'a', cv: 120, prem: 5 }), bond({ c: 'b', cv: 100, prem: 15 }),
    bond({ c: 'c', cv: 60, prem: 80 }), bond({ c: 'd', cv: null, prem: null }),
  ];
  const s = cbStats(rows);
  assert.equal(s.avgPremItm, 10);
  assert.equal(s.cvGe100, 2);
  assert.equal(s.cvGe120, 1);
  assert.equal(s.premGe50, 1);
  assert.equal(s.avgCv, (120 + 100 + 60) / 3);
});

test('產業整理：近期發行與待發行多的排前面，發行公司去重', () => {
  const bonds = [
    bond({ c: '1', s: '2330', ind: '半導體業', issue: '2026-10-01' }),
    bond({ c: '2', s: '2330', ind: '半導體業', issue: '2025-01-01' }),
    bond({ c: '3', s: '1101', ind: '水泥工業', issue: '2025-01-01' }),
  ];
  const up: CbUpcoming[] = [{ c: '9', n: '新債', issuer: '某公司', s: '1102', ind: '水泥工業',
    issue: '2026-11-10', list: '2026-11-10', mat: null, amt: 1e8, cp: 10, g: '無擔保', y: 3 }];
  const rows = byIndustry(bonds, up, '2026-11-04', 180);
  assert.equal(rows[0].ind, '半導體業');
  assert.equal(rows[0].issuers, 1);
  assert.equal(rows[0].bonds, 2);
  assert.equal(rows[0].recent, 1);
  assert.equal(rows[1].upcoming, 1);
  assert.equal(rows[1].issuers, 2);
});

test('排序：空值永遠排最後', () => {
  const rows = [bond({ c: 'a', prem: null }), bond({ c: 'b', prem: 30 }), bond({ c: 'c', prem: -2 })];
  const f = { q: '', bucket: null, ind: null, onlyTraded: false, sort: 'prem' as const, desc: false };
  assert.deepEqual(filterBonds(rows, f).map(b => b.c), ['c', 'b', 'a']);
  assert.deepEqual(filterBonds(rows, { ...f, desc: true }).map(b => b.c), ['b', 'c', 'a']);
});

test('雜項：餘額比例、日期加減、金額單位', () => {
  assert.equal(outPct(bond({ tot: 4e8, out: 1e8 })), 25);
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(yi(1.5e8), '1.5 億');
  assert.equal(yi(8e7), '8,000 萬');
});

const BASE: CbFilter = { q: '', bucket: null, ind: null, onlyTraded: false, sort: 'prem', desc: false, asOf: '2026-11-04' };

test('賣回殖利率：100 買、一年後 102 賣回 ≈ 2%；不到 30 天不算；賣回日已過不算', () => {
  const b = bond({ px: 100, putP: 102, putS: '2027-10-05', putE: '2027-11-04' });
  assert.ok(Math.abs(ytp(b, '2026-11-04')! - 2) < 0.01);
  assert.equal(ytp(bond({ px: 100, putP: 101, putE: '2026-11-20' }), '2026-11-04'), null);
  assert.equal(ytp(bond({ px: 100, putP: 101, putE: '2026-10-01' }), '2026-11-04'), null);
  assert.equal(ytp(bond({ px: 100, putP: null, putE: null }), '2026-11-04'), null);
  // 到期殖利率假設 100 償還：98 買、一年後 100 ≈ 2.04%
  assert.ok(Math.abs(ytm(bond({ px: 98, mat: '2027-11-04' }), '2026-11-04')! - 2.0408) < 0.01);
});

test('篩選器：區間、距賣回、已可轉換、成交量、收藏', () => {
  const rows = [
    bond({ c: 'a', px: 101, prem: 3, putE: '2027-06-01', putP: 101, convS: '2026-01-01', vol: 50 }),
    bond({ c: 'b', px: 130, prem: 2, putE: null, convS: '2027-01-01', vol: 0 }),
    bond({ c: 'c', px: 99, prem: -1, putE: '2029-01-01', putP: 100, convS: '2025-01-01', vol: 5 }),
  ];
  const ids = (f: Partial<CbFilter>) => filterBonds(rows, { ...BASE, ...f }).map(b => b.c).sort();
  assert.deepEqual(ids({ px: { min: null, max: 105 } }), ['a', 'c']);
  assert.deepEqual(ids({ putWithin: 365 }), ['a']);
  assert.deepEqual(ids({ convertibleOnly: true }), ['a', 'c']);
  assert.deepEqual(ids({ minVol: 10 }), ['a']);
  assert.deepEqual(ids({ favs: new Set(['b']) }), ['b']);
  // 預設策略「負溢價」：溢價率 < 0 且已可轉換
  assert.deepEqual(ids(CB_PRESETS.find(p => p.id === 'neg')!.f), ['c']);
  assert.equal(convertible(rows[1], '2026-11-04'), false);
});

test('依成交量排序：高→低，沒成交的排後面', () => {
  const rows = [bond({ c: 'a', vol: 5 }), bond({ c: 'b', vol: null }), bond({ c: 'c', vol: 80 })];
  assert.deepEqual(filterBonds(rows, { ...BASE, sort: 'vol', desc: true }).map(b => b.c), ['c', 'a', 'b']);
});

test('行事曆事件：只放區間內的賣回、到期、轉換價生效、新上櫃', () => {
  const data: CbData = {
    meta: { date: '2026-11-04', board: '2026-11-03', updated: '', count: 1, traded: 1, source: '', errors: [] },
    bonds: [bond({ c: '11011', n: '台泥一永', putS: '2026-12-01', putE: '2026-12-31', mat: '2029-12-10',
                   cp: 34, cpEff: '2026-11-20', convS: '2025-03-11' })],
    upcoming: [{ c: '37024', n: '大聯大四', issuer: '大聯大', s: '3702', ind: '電子通路業', issue: '2026-11-05',
                 list: '2026-11-05', mat: null, amt: 1.5e10, cp: 135, g: '無擔保', y: 3 }],
  };
  const ev = cbEvents(data, '2026-11-04', '2027-01-31');
  assert.deepEqual(ev.map(e => `${e.d} ${e.title}`), [
    '2026-11-05 大聯大四 新上櫃',
    '2026-11-20 台泥一永 轉換價 34 生效',
    '2026-12-01 台泥一永 開始受理賣回',
    '2026-12-31 台泥一永 賣回申請截止',
  ]);
  assert.ok(ev.every(e => e.kind === 'cb'));
});

test('市場溫度計：欄位對應與歷史百分位', () => {
  const rows = marketRows({ cols: ['d', 'n', 'avg', 'b120p'], rows: [['2026-11-03', 200, 110.5, 50]] });
  assert.equal(rows[0].d, '2026-11-03');
  assert.equal(MARKET_METRICS.find(m => m.id === 'hot')!.get(rows[0].r), 25);
  assert.equal(MARKET_METRICS.find(m => m.id === 'avg')!.get(rows[0].r), 110.5);
  assert.equal(rankInHistory([1, 2, 3, 4], 3), 75);
});
