/* 回測與退休試算的測試。
   刻意用手算得出來的小資料，這樣斷言失敗時知道是哪一步錯，
   而不是「某個數字跟快照不一樣」。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runBacktest, project, irrAnnualized, monthIndex,
  type CalcSeries, type BacktestInput,
} from '../src/lib/backtest.ts';

const MONTHS = ['2024-01', '2024-02', '2024-03', '2024-04'];

/** 價格固定 100、每月配 1 元的假標的，方便手算。 */
function flatSeries(over: Partial<CalcSeries> = {}): CalcSeries {
  return {
    code: 'TEST',
    name: '測試',
    freq: '月配',
    first: 0,
    p: [100, 100, 100, 100],
    d: [0, 0, 0, 0],
    q: [null, null, null, null],
    last: { date: '2024-04-30', close: 100 },
    splits: [],
    ...over,
  };
}

function baseInput(over: Partial<BacktestInput> = {}): BacktestInput {
  return {
    series: flatSeries(),
    months: MONTHS,
    lump: 0,
    monthly: 10_000,
    timing: 'monthStart',
    reinvest: false,
    feeRate: 0,
    feeMin: 0,
    wholeShares: false,
    divTaxRate: 0,
    nhiSupplement: false,
    ...over,
  };
}

test('沒有配息、價格不動時，期末市值等於總投入', () => {
  const r = runBacktest(baseInput());
  assert.equal(r.months, 4);
  assert.equal(r.totalInvested, 40_000);
  assert.equal(r.finalShares, 400);
  assert.ok(Math.abs(r.finalValue - 40_000) < 1e-6);
  assert.ok(Math.abs(r.totalReturnPct) < 1e-9);
});

test('單筆投入只在第一個月計入一次', () => {
  const r = runBacktest(baseInput({ lump: 100_000, monthly: 0 }));
  assert.equal(r.totalInvested, 100_000);
  assert.equal(r.finalShares, 1000);
  assert.equal(r.rows[0].contribution, 100_000);
  assert.equal(r.rows[1].contribution, 0);
});

test('領現金：配息不買回，累積成閒置現金', () => {
  const r = runBacktest(baseInput({
    series: flatSeries({ d: [1, 1, 1, 1], q: [100, 100, 100, 100] }),
    reinvest: false,
  }));
  // 月初買 100 股，除息時持有 100/200/300/400 股，每股 1 元
  assert.equal(r.totalDividend, 100 + 200 + 300 + 400);
  assert.equal(r.finalShares, 400);
  assert.equal(r.cash, 1000);
  assert.equal(r.marketValue, 40_000);
  assert.equal(r.finalValue, 41_000);
});

test('股息再投入：配息換成股數，總股數比領現金多', () => {
  const cash = runBacktest(baseInput({
    series: flatSeries({ d: [1, 1, 1, 1], q: [100, 100, 100, 100] }),
    reinvest: false,
  }));
  const re = runBacktest(baseInput({
    series: flatSeries({ d: [1, 1, 1, 1], q: [100, 100, 100, 100] }),
    reinvest: true,
  }));
  assert.ok(re.finalShares > cash.finalShares);
  assert.ok(re.cash < 1e-9);          // 全部投回去了，不留現金

  // 再投入的優勢跟價格漲不漲無關：買回來的股票下個月又能領息。
  // 手算（價 100、每股每月配 1）：
  //   1月 100 股 → 領 100 → +1 股 = 101
  //   2月 +100 = 201 → 領 201 → +2.01 股 = 203.01
  //   3月 +100 = 303.01 → 領 303.01 → +3.0301 股 = 306.0401
  //   4月 +100 = 406.0401 → 領 406.0401 → +4.060401 股 = 410.100501
  assert.ok(Math.abs(re.finalShares - 410.100501) < 1e-6);
  assert.ok(Math.abs(re.finalValue - 41_010.0501) < 1e-4);
  assert.ok(re.finalValue > cash.finalValue);
});

test('配息後買進：當月新買的股數領不到這次配息', () => {
  const s = flatSeries({ d: [1, 0, 0, 0], q: [100, null, null, null] });
  const atStart = runBacktest(baseInput({ series: s, timing: 'monthStart' }));
  const afterDiv = runBacktest(baseInput({ series: s, timing: 'afterDividend' }));

  // 月初買：第一個月就持有 100 股，領到 100 元
  assert.equal(atStart.totalDividend, 100);
  // 配息後買：第一個月除息時還是 0 股，一毛都領不到
  assert.equal(afterDiv.totalDividend, 0);
});

test('配息後買進會買在除息後的價格，不是月初價', () => {
  const s = flatSeries({
    p: [100, 100, 100, 100],
    d: [0, 5, 0, 0],
    q: [null, 80, null, null],      // 除息後跌到 80
    last: { date: '2024-04-30', close: 100 },
  });
  const r = runBacktest(baseInput({ series: s, timing: 'afterDividend', monthly: 8000 }));
  assert.equal(r.rows[1].price, 80);
  assert.equal(r.rows[0].price, 100);     // 沒配息的月份仍然月初買
  // 第一個月 80 股，第二個月用 8000 元買在 80 元 = 100 股
  assert.ok(Math.abs(r.rows[1].shares - 180) < 1e-9);
});

test('整股模式會留下零頭，下個月併入', () => {
  const s = flatSeries({ p: [300, 300, 300, 300], last: { date: '2024-04-30', close: 300 } });
  const r = runBacktest(baseInput({ series: s, monthly: 1000, wholeShares: true }));
  // 第一個月 1000 元買 3 股（900 元），剩 100
  assert.equal(r.rows[0].shares, 3);
  assert.ok(Math.abs(r.rows[0].cash - 100) < 1e-9);
  // 第二個月 1000+100=1100，買 3 股，剩 200
  assert.equal(r.rows[1].shares, 6);
  assert.ok(Math.abs(r.rows[1].cash - 200) < 1e-9);
  // 第四個月 1000+300=1300，買 4 股
  assert.equal(r.finalShares, 3 + 3 + 3 + 4);
});

test('手續費：最低收費在小額扣款時會蓋過費率', () => {
  const r = runBacktest(baseInput({ monthly: 1000, feeRate: 0.1425, feeMin: 20 }));
  // 1000 × 0.1425% = 1.4 元，低於最低 20 元，所以每個月都收 20
  assert.ok(Math.abs(r.totalFee - 80) < 1e-6);
  // 買進金額因此少了手續費那一份
  assert.ok(r.finalShares < 40);
});

test('手續費不會讓花掉的錢超過可用金額', () => {
  const r = runBacktest(baseInput({ monthly: 1000, feeRate: 0.5, feeMin: 20, wholeShares: true }));
  for (const row of r.rows) assert.ok(row.cash >= -1e-9, `第 ${row.month} 個月現金為負`);
});

test('二代健保補充保費只在單次配息達兩萬時課', () => {
  const small = runBacktest(baseInput({
    series: flatSeries({ d: [1, 0, 0, 0], q: [100, null, null, null] }),
    nhiSupplement: true,
  }));
  assert.equal(small.totalTax, 0);         // 100 股 × 1 元 = 100 元，沒到門檻

  const big = runBacktest(baseInput({
    series: flatSeries({ d: [1, 0, 0, 0], q: [100, null, null, null] }),
    lump: 10_000_000, monthly: 0, nhiSupplement: true,
  }));
  // 100,000 股 × 1 元 = 100,000 元，超過門檻
  assert.ok(Math.abs(big.totalTax - 100_000 * 0.0211) < 1e-6);
});

test('資料缺漏的月份會被跳過，不會用 null 當價格算股數', () => {
  const s = flatSeries({ p: [100, null, 100, 100] });
  const r = runBacktest(baseInput({ series: s }));
  assert.equal(r.months, 3);
  assert.equal(r.totalInvested, 30_000);
  assert.ok(Number.isFinite(r.finalShares));
  assert.equal(r.finalShares, 300);
});

test('起訖月份會被夾回這檔實際有資料的範圍', () => {
  const s = flatSeries({ first: 1, p: [100, 100, 100], d: [0, 0, 0], q: [null, null, null] });
  const r = runBacktest(baseInput({ series: s, from: '2024-01', to: '2024-12' }));
  assert.equal(r.rows[0].month, '2024-02');
  assert.equal(r.rows[r.rows.length - 1].month, '2024-04');
});

test('年化報酬率把投入時間算進去，不是總報酬除以年數', () => {
  // 每月投入 1，最後拿回 13（12 個月共投 12）—— 總報酬 8.3%，
  // 但平均只放了半年，所以年化明顯高於 8.3%
  const rows = Array.from({ length: 12 }, (_, i) => ({
    month: `2024-${String(i + 1).padStart(2, '0')}`,
    price: 1, contribution: 1, dividend: 0, tax: 0, fee: 0,
    shares: i + 1, value: i + 1, invested: i + 1, cash: 0,
  }));
  const a = irrAnnualized(rows, 13);
  assert.ok(a !== null && a > 8.3, `年化 ${a} 應該大於總報酬率 8.3%`);
});

test('虧損時年化為負，且是有限值', () => {
  const r = runBacktest(baseInput({
    series: flatSeries({ p: [100, 95, 90, 85], last: { date: '2024-04-30', close: 80 } }),
  }));
  assert.ok(r.annualizedPct !== null && r.annualizedPct < 0);
  assert.ok(Number.isFinite(r.annualizedPct));
});

test('期末市值連最後一次扣款都不到時，年化報酬率不存在', () => {
  // 現金流從頭到尾都是負的、沒有變號，內部報酬率在數學上無解。
  // 這時要回傳 null 讓畫面顯示「—」，不能硬湊一個數字。
  const r = runBacktest(baseInput({
    series: flatSeries({ p: [100, 50, 25, 12], last: { date: '2024-04-30', close: 1 } }),
  }));
  assert.equal(r.annualizedPct, null);
});

test('領現金時，配息不會被下個月的扣款拿去買回股票', () => {
  const s = flatSeries({ d: [5, 0, 0, 0], q: [100, null, null, null] });
  const r = runBacktest(baseInput({ series: s, monthly: 10_000, reinvest: false }));
  // 第一個月 100 股，領 500 元現金
  assert.equal(r.totalDividend, 500);
  assert.equal(r.dividendCash, 500);
  // 之後每個月都只用 10,000 元買 100 股，那 500 元原封不動
  assert.equal(r.finalShares, 400);
  assert.equal(r.cash, 500);
});

test('monthIndex 找不到時回傳 -1', () => {
  assert.equal(monthIndex(MONTHS, '2024-03'), 2);
  assert.equal(monthIndex(MONTHS, '2099-01'), -1);
  assert.equal(monthIndex(MONTHS, undefined), -1);
});

test('退休試算：不投入不成長時資產不變', () => {
  const r = project({
    initial: 1_000_000, monthly: 0, monthlyGrowthPct: 0, years: 10,
    returnPct: 0, inflationPct: 0, withdrawPct: 4, yieldPct: 5,
  });
  assert.equal(r.finalValue, 1_000_000);
  assert.ok(Math.abs(r.monthlyWithdraw - 1_000_000 * 0.04 / 12) < 1e-6);
  assert.ok(Math.abs(r.monthlyDividend - 1_000_000 * 0.05 / 12) < 1e-6);
});

test('退休試算：通膨會壓低實質購買力', () => {
  const r = project({
    initial: 1_000_000, monthly: 0, monthlyGrowthPct: 0, years: 20,
    returnPct: 0, inflationPct: 2, withdrawPct: 4, yieldPct: 5,
  });
  assert.ok(Math.abs(r.finalReal - 1_000_000 / Math.pow(1.02, 20)) < 1e-6);
  assert.ok(r.finalReal < r.finalValue);
});

test('退休試算：年化 12% 的複利十年約 3.1 倍', () => {
  const r = project({
    initial: 1_000_000, monthly: 0, monthlyGrowthPct: 0, years: 10,
    returnPct: 12, inflationPct: 0, withdrawPct: 4, yieldPct: 5,
  });
  // 用月複利換算，十年後 1.12^10 ≈ 3.106
  assert.ok(Math.abs(r.finalValue / 1_000_000 - Math.pow(1.12, 10)) < 0.01);
  assert.equal(r.rows.length, 10);
});

test('退休試算：每年調升投入金額會增加總投入', () => {
  const flat = project({
    initial: 0, monthly: 10_000, monthlyGrowthPct: 0, years: 5,
    returnPct: 5, inflationPct: 0, withdrawPct: 4, yieldPct: 5,
  });
  const rising = project({
    initial: 0, monthly: 10_000, monthlyGrowthPct: 5, years: 5,
    returnPct: 5, inflationPct: 0, withdrawPct: 4, yieldPct: 5,
  });
  assert.ok(rising.totalInvested > flat.totalInvested);
  assert.ok(rising.finalValue > flat.finalValue);
});
