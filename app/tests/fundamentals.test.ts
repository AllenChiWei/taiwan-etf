/* 個股財務分析：三張表的期間對齊、杜邦恆等式、TTM 的連續性、金融業的空值。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  parseQuarters, computeRatios, yoyDelta, dupontDrivers, prevQuarterEndAny,
  type FmRow,
} from '../src/lib/fundamentals.ts';

const DATES = ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'];

/** 一家很規律的公司：每季營收 100、成本 60、淨利 20；現金流量表照實寫成年初累計。 */
function fixture(opts: { skip?: string; bank?: boolean } = {}) {
  const income: FmRow[] = []; const balance: FmRow[] = []; const cashflow: FmRow[] = [];
  let ytdOcf = 0; let ytdCapex = 0;
  DATES.forEach((date, i) => {
    if (date === opts.skip) return;
    if (date.endsWith('03-31')) { ytdOcf = 0; ytdCapex = 0; }
    const rev = 100 + i * 10;
    income.push({ date, type: 'Revenue', value: rev });
    if (!opts.bank) {
      income.push({ date, type: 'CostOfGoodsSold', value: rev * 0.6 });
      income.push({ date, type: 'GrossProfit', value: rev * 0.4 });
    }
    income.push({ date, type: 'OperatingIncome', value: rev * 0.3 });
    income.push({ date, type: 'EquityAttributableToOwnersOfParent', value: rev * 0.2 });
    balance.push({ date, type: 'TotalAssets', value: 1000 });
    balance.push({ date, type: 'Liabilities', value: 400 });
    balance.push({ date, type: 'EquityAttributableToOwnersOfParent', value: 600 });
    balance.push({ date, type: 'CurrentAssets', value: 300 });
    balance.push({ date, type: 'CurrentLiabilities', value: 150 });
    if (!opts.bank) {
      balance.push({ date, type: 'Inventories', value: 50 });
      balance.push({ date, type: 'AccountsReceivableNet', value: 40 });
      balance.push({ date, type: 'AccountsPayable', value: 30 });
    }
    ytdOcf += 25; ytdCapex += 10;
    cashflow.push({ date, type: 'CashFlowsFromOperatingActivities', value: ytdOcf });
    cashflow.push({ date, type: 'PropertyAndPlantAndEquipment', value: -ytdCapex });
  });
  return { income, balance, cashflow };
}

test('現金流量表是年初累計：還原成單季，Q1 不減', () => {
  const f = fixture();
  const qs = parseQuarters(f.income, f.balance, f.cashflow);
  assert.deepEqual(qs.map(q => q.ocf), [25, 25, 25, 25, 25, 25]);
  assert.deepEqual(qs.map(q => q.capex), [10, 10, 10, 10, 10, 10]);   // 轉成正數
});

test('前一季缺資料就還原不了單季，留 null 而不是把累計當單季', () => {
  const f = fixture({ skip: '2025-09-30' });
  const qs = parseQuarters(f.income, f.balance, f.cashflow);
  const q4 = qs.find(q => q.date === '2025-12-31')!;
  assert.equal(q4.ocf, null);
});

test('杜邦恆等式：ROE = 淨利率 × 週轉率 × 乘數', () => {
  const f = fixture();
  const r = computeRatios(parseQuarters(f.income, f.balance, f.cashflow));
  const last = r[r.length - 1];
  assert.ok(last.roe !== null);
  const product = (last.netMargin! / 100) * last.assetTurnover! * last.equityMultiplier! * 100;
  assert.ok(Math.abs(product - last.roe!) < 1e-9, `${product} vs ${last.roe}`);
  // 近四季營收 120+130+140+150 = 540，淨利 108
  assert.equal(last.revTtm, 540);
  assert.equal(last.niTtm, 108);
  assert.equal(last.roe, 18);
  assert.equal(last.gm, 40);
  assert.equal(last.debt, 40);
  assert.equal(last.current, 2);
  assert.equal(last.fcf, 60);
  // 存貨週轉率 = 營業成本 324 ÷ 平均存貨 50
  assert.ok(Math.abs(last.invTurnover! - 6.48) < 1e-9);
  assert.ok(Math.abs(last.ccc! - (last.dio! + last.dso! - last.dpo!)) < 1e-9);
});

test('前三季湊不滿 TTM；中間缺一季也不算 TTM', () => {
  const f = fixture();
  const r = computeRatios(parseQuarters(f.income, f.balance, f.cashflow));
  assert.deepEqual(r.slice(0, 3).map(x => x.roe), [null, null, null]);
  assert.ok(r[3].roe !== null);

  const g = fixture({ skip: '2025-06-30' });
  const r2 = computeRatios(parseQuarters(g.income, g.balance, g.cashflow));
  // 2025-12-31 往回四筆會跨過缺掉的 Q2，不能把它當一年
  assert.equal(r2.find(x => x.label === '2025Q4')!.roe, null);
  // 單季的比率不受影響
  assert.equal(r2.find(x => x.label === '2025Q4')!.gm, 40);
});

test('跨年的前一季', () => {
  assert.equal(prevQuarterEndAny('2026-03-31'), '2025-12-31');
  assert.equal(prevQuarterEndAny('2026-06-30'), '2026-03-31');
});

test('金融業沒有營業成本與存貨：那些比率是 null，不是 0', () => {
  const f = fixture({ bank: true });
  const last = computeRatios(parseQuarters(f.income, f.balance, f.cashflow)).at(-1)!;
  assert.equal(last.gm, null);
  assert.equal(last.invTurnover, null);
  assert.equal(last.dio, null);
  assert.equal(last.ccc, null);
  assert.ok(last.roe !== null);                     // 杜邦照樣算得出來
});

test('yoyDelta 跟四季前比', () => {
  const f = fixture();
  const r = computeRatios(parseQuarters(f.income, f.balance, f.cashflow));
  assert.equal(yoyDelta(r, 'gm'), 0);
  assert.equal(yoyDelta(r.slice(0, 4), 'gm'), null);
});

test('dupontDrivers：只有淨利率變 -> 100% 來自淨利率；比例加總 100', () => {
  const base = computeRatios(parseQuarters(fixture().income, fixture().balance, fixture().cashflow)).at(-1)!;
  const d = dupontDrivers({ ...base, netMargin: base.netMargin! * 1.5 }, base)!;
  assert.equal(d[0].key, 'netMargin');
  assert.equal(Math.round(d[0].share), 100);
  assert.equal(d[0].up, true);
  const d2 = dupontDrivers({ ...base, netMargin: base.netMargin! * 2, equityMultiplier: base.equityMultiplier! / 2 }, base)!;
  assert.equal(Math.round(d2.reduce((s, x) => s + x.share, 0)), 100);
  assert.equal(Math.round(d2[0].share), 50);
  assert.equal(d2[2].up, false);
  assert.equal(dupontDrivers({ ...base, roe: null, netMargin: null }, base), null);
});

// 台積電的真實 FinMind 回應（本機 .cache 有才跑；CI 沒有就略過）
const dir = new URL('../../.cache/', import.meta.url);
const file = (n: string) => new URL(`fm_2330_TaiwanStock${n}.json`, dir);
const have = ['FinancialStatements', 'BalanceSheet', 'CashFlowsStatement'].every(n => existsSync(file(n)));

test('台積電真實財報', { skip: !have && '沒有 .cache/fm_2330_*.json' }, () => {
  const load = (n: string) => (JSON.parse(readFileSync(file(n), 'utf8')).data as FmRow[])
    .map(r => ({ ...r, value: Number(r.value) }));
  const r = computeRatios(parseQuarters(load('FinancialStatements'), load('BalanceSheet'), load('CashFlowsStatement')));
  const q = r.find(x => x.label === '2026Q2')!;
  // 單位是元：台積電 TTM 營收在兆元等級，不是十億（千元誤當元會差一千倍）
  assert.ok(q.revTtm! > 3e12 && q.revTtm! < 1e13, `${q.revTtm}`);
  assert.ok(q.roe! > 25 && q.roe! < 50, `ROE ${q.roe}`);
  assert.ok(q.gm! > 50 && q.gm! < 75);
  assert.ok(q.dio! > 40 && q.dio! < 120);
  const product = (q.netMargin! / 100) * q.assetTurnover! * q.equityMultiplier! * 100;
  assert.ok(Math.abs(product - q.roe!) < 1e-6);
});
