/* 民生股：區的判斷、條狀圖刻度、排序、10 年區間算法（並與 Python 版對答案）、失真提醒與持有 ETF 篩選。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  computeDefensiveRow, currentEtfHolders, distortionWarnings, normalizeStockCode, quantile, rankLe,
  scale, shiftDays, sortRows, zoneOf,
  type DefData, type DefRow, type FinMindDividendRow, type FinMindPerRow, type FinMindPriceRow,
} from '../src/lib/defensive.ts';
import type { ActiveData } from '../src/lib/active.ts';
import type { Top10Data } from '../src/lib/top10.ts';

const b = { cheap: 100, fair: 120, rich: 140 };

test('區：便宜價以下、合理偏低、合理偏高、昂貴', () => {
  assert.equal(zoneOf(95, b), 'cheap');
  assert.equal(zoneOf(100, b), 'cheap');
  assert.equal(zoneOf(110, b), 'fairLow');
  assert.equal(zoneOf(130, b), 'fairHigh');
  assert.equal(zoneOf(150, b), 'rich');
  assert.equal(zoneOf(100, null), null);
});

test('刻度：股價超出區間時延伸、位置夾在 0～1', () => {
  const s = scale(200, b);
  assert.ok(s.hi >= 200 * 1.03 - 1e-9);
  assert.equal(s.at(1e9), 1);
  assert.equal(s.at(-1), 0);
});

test('排序：便宜的在前，同區殖利率百分位高的在前', () => {
  const r = (c: string, price: number, yr: number) => ({ c, price, yieldRank: yr, byYield: b }) as unknown as DefRow;
  assert.deepEqual(sortRows([r('A', 150, 0.1), r('B', 95, 0.5), r('C', 90, 0.9)]).map(x => x.c), ['C', 'B', 'A']);
});

test('分位數與排名純函式邊界條件', () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([42], 0.8), 42);
  assert.equal(quantile([10, 20, 30, 40], 0.5), 25);
  assert.equal(rankLe([], 5), null);
  assert.equal(rankLe([1, 2, 2, 4], 2), 0.75);
  assert.equal(shiftDays('2026-11-26', -365 * 10), '2016-11-28');
  assert.equal(normalizeStockCode(' 2886 '), '2886');
  assert.equal(normalizeStockCode('2887e'), '2887E');
  assert.equal(normalizeStockCode('台積電'), null);
});

interface ParityCase {
  code: string;
  cat: string;
  today: string;
  per: FinMindPerRow[];
  px: FinMindPriceRow[];
  dv: FinMindDividendRow[];
}

function makeFixtureCases(): ParityCase[] {
  const px250: FinMindPriceRow[] = Array.from({ length: 250 }, (_, i) => ({
    date: shiftDays('2026-11-25', -(249 - i)),
    close: i === 0 ? 80 : i === 50 ? 75 : i === 100 ? 125 : i === 249 ? 100 : 90,
  }));

  return [
    {
      // 穩健存股：含超出 10 年的舊資料（應排除）、一年兩次配息、公積現金、空除息日回退 date、滿 250 日價
      code: '9991',
      cat: '自選',
      today: '2026-11-26',
      per: [
        { date: '2016-11-01', PER: 99, PBR: 9.0, dividend_yield: 99 },
        { date: '2017-01-05', PER: 20, PBR: 2.0, dividend_yield: 5.0 },
        { date: '2019-01-05', PER: 10, PBR: 1.0, dividend_yield: 3.0 },
        { date: '2021-01-05', PER: 16, PBR: 1.6, dividend_yield: 4.0 },
        { date: '2023-01-05', PER: 12, PBR: 1.2, dividend_yield: 6.0 },
        { date: '2025-01-05', PER: 18, PBR: 1.8, dividend_yield: 7.0 },
        { date: '2026-11-25', PER: 14, PBR: 1.4, dividend_yield: 4.6 },
      ],
      px: px250,
      dv: [
        { date: '2020-07-01', CashExDividendTradingDate: '2020-07-01', CashEarningsDistribution: 0, CashStatutorySurplus: 0 },
        { date: '2021-07-01', CashExDividendTradingDate: '2021-07-01', CashEarningsDistribution: 4.0, CashStatutorySurplus: 0 },
        { date: '2022-07-01', CashExDividendTradingDate: '2022-07-01', CashEarningsDistribution: 4.5, CashStatutorySurplus: 0 },
        { date: '2023-07-01', CashExDividendTradingDate: '2023-07-01', CashEarningsDistribution: 5.0, CashStatutorySurplus: 0 },
        { date: '2024-07-01', CashExDividendTradingDate: '2024-07-01', CashEarningsDistribution: 5.5, CashStatutorySurplus: 0 },
        { date: '2025-07-01', CashExDividendTradingDate: '2025-07-01', CashEarningsDistribution: 5.0, CashStatutorySurplus: 1.0 },
        { date: '2026-03-15', CashExDividendTradingDate: '2026-03-15', CashEarningsDistribution: 2.4, CashStatutorySurplus: 0 },
        { date: '2026-09-15', CashExDividendTradingDate: '', CashEarningsDistribution: 3.6, CashStatutorySurplus: 0 },
      ],
    },
    {
      // 虧損且無配息股：只有淨值比區間算得出來，其餘為 null
      code: '9992',
      cat: '自選',
      today: '2026-11-26',
      per: [
        { date: '2024-01-05', PER: 0, PBR: 1.0, dividend_yield: 0 },
        { date: '2025-01-05', PER: 0, PBR: 1.5, dividend_yield: 0 },
        { date: '2026-11-25', PER: 0, PBR: 2.0, dividend_yield: 0 },
      ],
      px: [
        { date: '2026-11-20', close: 20 },
        { date: '2026-11-24', close: 22 },
        { date: '2026-11-25', close: 25 },
      ],
      dv: [],
    },
    {
      // 配息中斷且大起大落股：近兩年沒配、沿用較早年度股利
      code: '9993',
      cat: '自選',
      today: '2026-11-26',
      per: [
        { date: '2020-01-05', PER: 8, PBR: 0.8, dividend_yield: 2.0 },
        { date: '2022-01-05', PER: 12, PBR: 1.2, dividend_yield: 8.0 },
        { date: '2024-01-05', PER: 16, PBR: 1.6, dividend_yield: 4.0 },
        { date: '2026-11-25', PER: 20, PBR: 2.0, dividend_yield: 1.0 },
      ],
      px: [
        { date: '2026-11-24', close: 48 },
        { date: '2026-11-25', close: 50 },
      ],
      dv: [
        { date: '2022-07-01', CashExDividendTradingDate: '2022-07-01', CashEarningsDistribution: 10.0, CashStatutorySurplus: 0 },
        { date: '2024-07-01', CashExDividendTradingDate: '2024-07-01', CashEarningsDistribution: 1.0, CashStatutorySurplus: 0 },
      ],
    },
  ];
}

test('10 年區間算法：穩健存股、虧損無配息、配息中斷三種情境手算對帳', () => {
  const [steady, loss, erratic] = makeFixtureCases();

  const r1 = computeDefensiveRow(steady)!;
  assert.equal(r1.price, 100);
  assert.equal(r1.pdate, '2026-11-25');
  assert.equal(r1.since, '2017-01-05', '10 年視窗以前的 PER 應排除');
  assert.equal(r1.chg1y, 0.25);
  assert.equal(r1.hi52, 125);
  assert.equal(r1.lo52, 75);
  assert.equal(r1.div, 6);
  assert.equal(r1.divYear, '2026');
  assert.equal(r1.avg5, 5);
  assert.equal(r1.streak, 6);
  assert.equal(r1.streakMin, true);
  assert.equal(r1.yield, 6);
  assert.equal(r1.yieldRank, 0.833);
  assert.equal(r1.pe, 14);
  assert.equal(r1.peRank, 0.5);
  assert.equal(r1.pb, 1.4);
  assert.equal(r1.pbRank, 0.5);
  assert.deepEqual(r1.byYield, { cheap: 100, fair: 125, rich: 150, q: [4, 4.8, 6] });
  assert.deepEqual(r1.byPe, { cheap: 85.71, fair: 107.14, rich: 128.57, q: [12, 15, 18] });
  assert.deepEqual(r1.byPb, { cheap: 85.71, fair: 107.14, rich: 128.57, q: [1.2, 1.5, 1.8] });
  assert.deepEqual(r1.byClassic, { cheap: 80, fair: 100, rich: 160 });

  const r2 = computeDefensiveRow(loss)!;
  assert.equal(r2.pe, null);
  assert.equal(r2.div, null);
  assert.equal(r2.byYield, null);
  assert.equal(r2.byPe, null);
  assert.equal(r2.byClassic, null);
  assert.deepEqual(r2.byPb, { cheap: 15, fair: 18.75, rich: 22.5, q: [1.2, 1.5, 1.8] });

  const r3 = computeDefensiveRow(erratic)!;
  assert.equal(r3.div, 1);
  assert.equal(r3.divYear, '2024');
  assert.equal(r3.avg5, 5.5);
  assert.equal(r3.streak, 0);
  assert.deepEqual(r3.byYield, { cheap: 17.86, fair: 33.33, rich: 62.5, q: [1.6, 3, 5.6] });
  assert.deepEqual(r3.byPe, { cheap: 26, fair: 35, rich: 44, q: [10.4, 14, 17.6] });
  assert.deepEqual(r3.byClassic, { cheap: 88, fair: 110, rich: 176 });

  assert.equal(computeDefensiveRow({ code: '9999', today: '2026-11-26', per: [], px: [], dv: [] }), null);
});

function findPython(): string | null {
  for (const bin of ['python', 'python3']) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore' });
      return bin;
    } catch {
      /* 試下一個 */
    }
  }
  return null;
}

const PY_BIN = findPython();
const SCRIPTS_DIR = fileURLToPath(new URL('../../scripts', import.meta.url));

test('與 scripts/fetch_defensive.py 用同一組假資料對答案', { skip: !PY_BIN && '環境無 python' }, () => {
  const cases = makeFixtureCases();
  const pyCode = [
    'import sys, json, datetime',
    'sys.path.insert(0, sys.argv[1])',
    'import fetch_defensive as fd',
    'cases = json.loads(sys.stdin.read())',
    'out = [fd.compute(c["code"], c["cat"], datetime.date.fromisoformat(c["today"]), c["per"], c["px"], c["dv"]) for c in cases]',
    'sys.stdout.write(json.dumps(out, ensure_ascii=False))',
  ].join('\n');

  const raw = execFileSync(PY_BIN!, ['-c', pyCode, SCRIPTS_DIR], {
    input: JSON.stringify(cases),
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  const pyRows = JSON.parse(raw) as Record<string, unknown>[];
  assert.equal(pyRows.length, cases.length);

  cases.forEach((c, idx) => {
    const tsRow = computeDefensiveRow(c)!;
    // Python 的 compute() 不帶 n／m／i（由 main() 從 pe.json 補），比對所有計算欄位
    const { n: _n, m: _m, i: _i, ...tsCore } = tsRow;
    assert.deepEqual(tsCore, pyRows[idx], `${c.code} 與 Python 版計算結果不一致`);
  });
});

test('失真提醒：穩健股不誤報；虧損、無配息、配息中斷／起伏大、短歷史、自選景氣股皆提示', () => {
  const [steady, loss, erratic] = makeFixtureCases();
  const rSteady = computeDefensiveRow(steady)!;
  assert.deepEqual(distortionWarnings(rSteady, { custom: true }), []);

  const rLoss = computeDefensiveRow(loss)!;
  const wLoss = distortionWarnings(rLoss, { custom: true });
  assert.ok(wLoss.some(s => s.includes('虧損')), '應提示虧損');
  assert.ok(wLoss.some(s => s.includes('無現金股利')), '應提示無現金股利');
  assert.ok(wLoss.some(s => s.includes('未滿 3 年')), '應提示歷史資料不足 3 年');

  const rErratic = computeDefensiveRow(erratic)!;
  const wErratic = distortionWarnings(rErratic, { custom: true });
  assert.ok(wErratic.some(s => s.includes('近兩年未配發現金股利')), '應提示中斷配息');
  assert.ok(wErratic.some(s => s.includes('起伏較大')), '應提示配息起伏大');

  const rCyclical = { ...rSteady, i: '鋼鐵工業' };
  assert.ok(distortionWarnings(rCyclical, { custom: true }).some(s => s.includes('景氣循環')));
  assert.equal(distortionWarnings(rCyclical, { custom: false }).length, 0, '內建民生股不誤觸發景氣循環警示');
});

test('持有該股的 ETF 數：排除主動式已剔除的標的，保留目前持有與月報前十大', () => {
  const active: ActiveData = {
    meta: { updated: '2026-11-26', minChange: 0.005, blocked: [], source: 's', errors: [] },
    etfs: {
      '00981A': {
        name: '主動甲', issuer: '統一', asof: '2026-11-25',
        holdings: [['2412', '中華電', 100000, 2.5]],
        changes: [],
      },
      '00403A': {
        name: '主動乙', issuer: '統一', asof: '2026-11-25',
        holdings: [],
        changes: [{ d: '2026-11-20', p: '2026-11-19', f: 0, items: [['2412', '中華電', 50000, 0, 0, 160]] }],
      },
    },
  };
  const monthly: Top10Data = {
    meta: { ym: '202610', updated: '2026-11-13', source: '公會' },
    etfs: {
      '00701': { name: '國泰低波動', rows: [[2, '國內上市', '2412', '中華電', 13.72]] },
      '00981A': { name: '主動甲月報', rows: [[5, '國內上市', '2412', '中華電', 2.0]] },
    },
  };
  const list = currentEtfHolders('2412', monthly, active, { '00701': '國泰股利精選30' });
  assert.deepEqual(list.map(x => x.etf), ['00701', '00981A'], '已剔除的 00403A 不應計入持有數');
});

const PATH = new URL('../public/data/defensive.json', import.meta.url);
test('真實資料：便宜 ≤ 合理 ≤ 昂貴、殖利率合理、電信三檔都在', { skip: !existsSync(PATH) && '沒有 defensive.json' }, () => {
  const d = JSON.parse(readFileSync(PATH, 'utf8')) as DefData;
  for (const r of d.rows) {
    for (const band of [r.byYield, r.byPe, r.byPb, r.byClassic]) {
      if (!band) continue;
      assert.ok(band.cheap <= band.fair && band.fair <= band.rich, `${r.c}`);
    }
    if (r.yield !== null) assert.ok(r.yield > 0 && r.yield < 20, `${r.c} 殖利率 ${r.yield}`);
  }
  for (const c of ['2412', '3045', '4904']) assert.ok(d.rows.some(r => r.c === c), c);
});
