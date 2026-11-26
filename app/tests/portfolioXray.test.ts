/* 持股穿透健檢（lib/portfolioXray.ts）純邏輯測試：
 * 持股解析、市值加權穿透、前十大下限與日期差異、債券／美股／期貨排除、
 * 低融資維持率、可轉債轉換賣壓（排除交換債）、未來 14 天行事曆、近期重訊與真實資料整合。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  buildPortfolioXray,
  checkPortfolioCb,
  checkPortfolioEvents,
  checkPortfolioFilings,
  checkPortfolioMargin,
  matchesHealthFilter,
  parseStoredHoldings,
  type MarginStateLite,
} from '../src/lib/portfolioXray.ts';
import type { Etf, EtfDataset } from '../src/types.ts';
import type { Top10Data } from '../src/lib/top10.ts';
import type { ActiveData } from '../src/lib/active.ts';
import type { StockDividendData, YieldData } from '../src/lib/dividend.ts';
import type { CbBond, CbData } from '../src/lib/cb.ts';
import type { CalendarData } from '../src/lib/calendar.ts';
import type { NewsData } from '../src/lib/news.ts';

function mkEtf(code: string, name: string, sec: Etf['sec'], act = false): Etf {
  return {
    code, name, cust: '—', freq: '季配', yield: 'N/A',
    r3: 'N/A', r6: 'N/A', r12: 'N/A', r36: 'N/A', r60: 'N/A', sec, act,
  };
}

function mkBond(over: Partial<CbBond>): CbBond {
  return {
    c: '23301', n: '測試一', s: '2330', sn: '台積電', ind: '半導體業', mk: '上市',
    px: 110, close: 110, chg: 0, vol: 10, val: 1100000, cp: 100, cpEff: null, sp: 110, exch: false,
    cv: 110, prem: 0, convS: '2026-01-01', convE: '2029-01-01', putS: null, putE: null, putP: null,
    callS: null, callP: null, end: null, halt: null, tot: 1e8, out: 8e7, coupon: 0,
    issue: '2025-10-01', mat: '2029-01-01', g: '無擔保', ...over,
  };
}

const ETFS: Etf[] = [
  mkEtf('0050', '元大台灣50', 'cat-domestic'),
  mkEtf('00981A', '主動統一台股增長', 'cat-domestic', true),
  mkEtf('00679B', '元大美債20年', 'cat-bond'),
  mkEtf('00646', '元大S&P500', 'cat-foreign'),
  mkEtf('00420A', '主動野村亞洲科技', 'cat-foreign', true),
  mkEtf('00631L', '元大台灣50正2', 'cat-leveraged'),
];

const TOP10: Top10Data = {
  meta: { ym: '202610', updated: '2026-11-13', source: 'SITCA' },
  etfs: {
    '0050': {
      name: '元大台灣50',
      rows: [
        [1, '國內上市', '2330', '台積電', 50],
        [2, '國內上市', '2454', '聯發科', 10],
      ],
    },
    '00679B': {
      name: '元大美債20年',
      rows: [[1, '政府公債 無擔保', 'US912810UK24', 'US TREASURY', 10]],
    },
    '00646': {
      name: '元大S&P500',
      rows: [[1, '國外股票(含承銷)', 'US0378331005', 'APPLE INC', 8]],
    },
  },
};

const ACTIVE = {
  meta: { updated: '2026-11-26', minChange: 0.005, blocked: [], source: 'test', errors: [] },
  etfs: {
    '00981A': {
      name: '主動統一台股增長', issuer: '統一投信', asof: '2026-11-25', changes: [],
      holdings: [
        ['2330', '台灣積體電路製造', 1000, 20],
        ['3017', '奇鋐科技', 1000, 10],
        ['TX', '台灣證交所加權股價指數', 10, 15],
        ['6669', '緯穎', 1000, 0.2],
      ],
    },
    '00420A': {
      name: '主動野村亞洲科技', issuer: '野村投信', asof: '2026-11-24', changes: [],
      holdings: [
        ['2330', '台灣積體電路製造', 1000, 10],
        ['6857 JP', '愛德萬測試', 1000, 8],
        ['000660 KS', '海力士', 1000, 7],
      ],
    },
  },
} as unknown as ActiveData;

const YIELDS: YieldData = {
  meta: { asof: '2026-11-25' },
  yields: {
    '0050': { price: 100 },
    '00981A': { price: 50 },
    '00679B': { price: 25 },
    '00646': { price: 50 },
    '00420A': { price: 20 },
    '00631L': { price: 100 },
  },
};

const STOCK_DIVS: StockDividendData = {
  meta: { updated: '2026-11-26', source: 'TWSE', note: '' },
  stocks: {
    '2330': { n: '台積電', m: 'twse', c: 1000, ev: [] },
    '2454': { n: '聯發科', m: 'twse', c: 1200, ev: [] },
    '3017': { n: '奇鋐', m: 'twse', c: 500, ev: [] },
    '6669': { n: '緯穎', m: 'twse', c: 2000, ev: [] },
  },
};

test('parseStoredHoldings：過濾損毀與無效項目，保留台股與美股與帳戶欄位', () => {
  assert.deepEqual(parseStoredHoldings(null), []);
  assert.deepEqual(parseStoredHoldings('{bad json'), []);
  const rows = parseStoredHoldings(JSON.stringify([
    { code: '0050', shares: 1000, acct: '帳戶A' },
    { code: ' spy ', shares: 10, m: 'us' },
    { code: '2330', shares: 0 },
    { code: '', shares: 100 },
    { code: '2454', shares: -5 },
    null,
  ]));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { code: '0050', shares: 1000, acct: '帳戶A' });
  assert.deepEqual(rows[1], { code: 'SPY', shares: 10, m: 'us' });
});

test('穿透展開：直接持股＋月報前十大＋主動式每日加總正確，排除期貨 TX、債券與美股 ETF', () => {
  // 投組總市值 = 0050 (100*2000=20萬) + 00981A (50*2000=10萬) + 2330 (1000*100=10萬)
  //           + 00679B (25*4000=10萬，債券) + SPY (500*100=5萬，美股) + 00646 (50*1000=5萬，純海外)
  //           = 60萬（同檔跨帳戶會自動合併）
  const xray = buildPortfolioXray({
    holdings: [
      { code: '0050', shares: 1000, acct: '帳戶A' },
      { code: '0050', shares: 1000, acct: '帳戶B' },
      { code: '00981A', shares: 2000 },
      { code: '2330', shares: 100 },
      { code: '00679B', shares: 4000 },
      { code: 'SPY', shares: 100, m: 'us' },
      { code: '00646', shares: 1000 },
    ],
    etfs: ETFS,
    top10: TOP10,
    active: ACTIVE,
    yields: YIELDS,
    stockDivs: STOCK_DIVS,
    usPricesTwd: new Map([['SPY', 500]]),
    usNames: new Map([['SPY', 'SPDR S&P 500 ETF']]),
  });

  assert.equal(xray.holdingCount, 6, '0050 兩筆應合併為一筆');
  assert.equal(xray.pricedCount, 6);
  assert.equal(xray.totalValue, 600_000);
  assert.equal(xray.hasLowerBound, true, '含 0050 月報前十大');
  assert.equal(xray.hasDateMismatch, true, '每日 2026-11-25 與月報 2026/10 並存');
  assert.deepEqual(xray.dailyDates, ['2026-11-25']);
  assert.equal(xray.monthlyAsof, '2026/10');

  // 2330 真實曝險 = 直接 100,000 + 0050 (200,000*50%=100,000) + 00981A (100,000*20%=20,000) = 220,000
  const tsmc = xray.exposures[0];
  assert.equal(tsmc.code, '2330');
  assert.equal(tsmc.name, '台積電', '優先使用官方簡稱而非投信全名');
  assert.equal(tsmc.amount, 220_000);
  assert.equal(tsmc.directAmount, 100_000);
  assert.equal(tsmc.etfAmount, 120_000);
  assert.ok(Math.abs(tsmc.pct - (220_000 / 600_000) * 100) < 1e-9);
  assert.equal(tsmc.isDirect, true);
  assert.equal(tsmc.sources.length, 3);

  // TX 期貨與 US/債券 ISIN 不得出現在 exposures
  assert.equal(xray.exposures.some(e => e.code === 'TX'), false);
  assert.equal(xray.exposures.some(e => e.code.startsWith('US')), false);

  // 覆蓋分類加總應等於總市值：直接 10萬 + 穿透 (10+2+2+1+0.02=15.02萬) + 未揭露 ((20-12)+(10-3.02)=14.98萬) + 無法穿透 (10+5+5=20萬) = 60萬
  assert.equal(xray.directStockValue, 100_000);
  assert.ok(Math.abs(xray.penetratedEtfValue - 150_200) < 1e-6);
  assert.ok(Math.abs(xray.unrevealedEtfValue - 149_800) < 1e-6);
  assert.equal(xray.unpenetrableValue, 200_000);
  assert.ok(Math.abs(
    xray.directStockPct + xray.penetratedEtfPct + xray.unrevealedEtfPct + xray.unpenetrablePct - 100,
  ) < 1e-9);

  // 無法穿透標的分類正確
  const bondRow = xray.breakdown.find(b => b.code === '00679B')!;
  assert.equal(bondRow.status, 'unpenetrable');
  assert.equal(bondRow.unpenetrableKind, 'bond');
  const usRow = xray.breakdown.find(b => b.code === 'SPY')!;
  assert.equal(usRow.status, 'unpenetrable');
  assert.equal(usRow.unpenetrableKind, 'us');
  const foreignRow = xray.breakdown.find(b => b.code === '00646')!;
  assert.equal(foreignRow.status, 'unpenetrable');
  assert.equal(foreignRow.unpenetrableKind, 'foreign');
});

test('跨國主動式 ETF（如 00420A）僅展開台股成分，缺報價標的不 crash 且不計入分母', () => {
  const xray = buildPortfolioXray({
    holdings: [
      { code: '00420A', shares: 1000 }, // 市值 20,000，其中 2330 佔 10% = 2,000；日韓股排除
      { code: 'VOO', shares: 10, m: 'us' }, // 缺報價
    ],
    etfs: ETFS,
    top10: TOP10,
    active: ACTIVE,
    yields: YIELDS,
    stockDivs: STOCK_DIVS,
  });
  assert.equal(xray.totalValue, 20_000);
  assert.equal(xray.pricedCount, 1);
  assert.equal(xray.unpriced.length, 1);
  assert.equal(xray.unpriced[0].code, 'VOO');
  assert.equal(xray.exposures.length, 1);
  assert.equal(xray.exposures[0].code, '2330');
  assert.equal(xray.exposures[0].amount, 2_000);
  assert.equal(xray.unrevealedEtfValue, 18_000);
});

test('低融資維持率、可轉債賣壓（排除交換債）、未來 14 天行事曆與重大訊息交叉檢查＋缺檔容錯', () => {
  const xray = buildPortfolioXray({
    holdings: [
      { code: '0050', shares: 2000 },
      { code: '00981A', shares: 2000 },
      { code: '2330', shares: 100 },
    ],
    etfs: ETFS,
    top10: TOP10,
    active: ACTIVE,
    yields: YIELDS,
    stockDivs: STOCK_DIVS,
  });

  // 1. 低維持率
  const margin: MarginStateLite = {
    d: '2026-11-25',
    m: { '2330': 168.5, '2454': 142.3, '3017': 126.4, '6669': 122.0 },
  };
  const mc = checkPortfolioMargin(xray, margin, 150);
  assert.equal(mc.available, true);
  assert.equal(mc.below130Count, 2);
  assert.equal(mc.below150Count, 3);
  assert.equal(mc.lowest?.code, '6669');
  // 6669 曝險 200 / 400,000 = 0.05% < 0.5%，在 major 篩選下會被隱藏
  const majorMargin = mc.flagged.filter(r => matchesHealthFilter(r, 'major'));
  assert.deepEqual(majorMargin.map(r => r.code), ['3017', '2454']);
  assert.equal(checkPortfolioMargin(xray, null).available, false);

  // 2. 可轉債（交換債 exch: true 必須排除）
  const cb: CbData = {
    meta: { date: '2026-11-25', board: '2026-11-24', updated: '2026-11-26', count: 3, traded: 3, source: '', errors: [] },
    bonds: [
      mkBond({ c: '30171', n: '奇鋐一', s: '3017', sn: '奇鋐', px: 135, cv: 140, prem: -3.5, cv1: 80, tot: 1e8, out: 6e7 }),
      mkBond({ c: '24541', n: '交換債', s: '2454', sn: '聯發科', exch: true, cv1: 500 }),
      mkBond({ c: '23302', n: '台積二', s: '2330', sn: '台積電', px: 101, cv: 80, prem: 26, cv1: 0 }),
    ],
    upcoming: [],
  };
  const cbc = checkPortfolioCb(xray, cb);
  assert.equal(cbc.available, true);
  assert.equal(cbc.all.some(r => r.bond.c === '24541'), false, '交換債不可對應到標的股');
  assert.equal(cbc.pressured.length, 1);
  assert.equal(cbc.pressured[0].bond.c, '30171');
  assert.equal(cbc.pressured[0].pressureLevel, 2, '近月轉換 80 張＝800 萬／1 億＝8% >= 5%');
  assert.equal(checkPortfolioCb(xray, null).available, false);

  // 3. 未來 14 天行程（含直接持有 ETF 除息與穿透個股法說／股東會，不含 15 天後）
  const cal: CalendarData = {
    meta: { updated: '2026-11-26', until: '2027-02-01', source: '', errors: [] },
    exdiv: [
      { d: '2026-11-28', code: '0050', name: '元大台灣50', k: '息', cash: 1, stock: null, m: 'twse' },
      { d: '2026-12-15', code: '2330', name: '台積電', k: '息', cash: 7, stock: null, m: 'twse' },
    ],
    meetings: [
      { d: '2026-12-05', code: '2454', name: '聯發科', k: '臨時會', elect: false, place: '新竹', m: 'twse' },
    ],
    calls: [
      { d: '2026-12-01', code: '3017', name: '奇鋐', m: 'twse', t: '14:00', place: '線上', topic: 'Q3 財報' },
    ],
  };
  const evs = checkPortfolioEvents(xray, cal, '2026-11-26', 14);
  assert.deepEqual(evs.map(e => e.code), ['0050', '3017', '2454']);
  assert.equal(evs[0].isDirect, true);
  assert.equal(evs[0].targetKind, 'etf');
  assert.equal(evs[1].isDirect, false);
  assert.deepEqual(evs[1].viaEtfs, ['00981A']);
  assert.deepEqual(checkPortfolioEvents(xray, null, '2026-11-26', 14), []);

  // 4. 近期重大訊息
  const news: NewsData = {
    meta: { updated: '2026-11-26T12:00:00+08:00', sources: ['公開資訊觀測站'], note: '', news: 0, filings: 2 },
    news: [],
    filings: [
      { code: '2330', name: '台積電', subject: '董事會決議', at: '2026-11-26T10:00:00+08:00', market: '上市', clause: '11', u: 'https://mopsov.twse.com.tw/', known: true },
      { code: '9999', name: '無關公司', subject: '測試', at: '2026-11-26T11:00:00+08:00', market: '上市', clause: '1', u: 'https://mopsov.twse.com.tw/', known: false },
    ],
  };
  const fils = checkPortfolioFilings(xray, news);
  assert.equal(fils.length, 1);
  assert.equal(fils[0].filing.code, '2330');
  assert.equal(fils[0].isDirect, true);
  assert.deepEqual(checkPortfolioFilings(xray, null), []);
});

const ETFS_PATH = new URL('../public/data/etfs.json', import.meta.url);
const TOP10_PATH = new URL('../public/data/top10.json', import.meta.url);
const ACTIVE_PATH = new URL('../public/data/active_holdings.json', import.meta.url);
const YIELDS_PATH = new URL('../public/data/yields.json', import.meta.url);
const SDIV_PATH = new URL('../public/data/stock_dividends.json', import.meta.url);

test('真實資料整合：0050＋00878＋00981A＋00980A＋2330＋00679B 穿透結果合理、無期貨與債券滲入', {
  skip: (!existsSync(ETFS_PATH) || !existsSync(TOP10_PATH) || !existsSync(YIELDS_PATH)) && '缺少靜態資料檔',
}, () => {
  const etfs = (JSON.parse(readFileSync(ETFS_PATH, 'utf8')) as EtfDataset).etfs;
  const top10 = JSON.parse(readFileSync(TOP10_PATH, 'utf8')) as Top10Data;
  const active = existsSync(ACTIVE_PATH) ? JSON.parse(readFileSync(ACTIVE_PATH, 'utf8')) as ActiveData : null;
  const yields = JSON.parse(readFileSync(YIELDS_PATH, 'utf8')) as YieldData;
  const stockDivs = existsSync(SDIV_PATH) ? JSON.parse(readFileSync(SDIV_PATH, 'utf8')) as StockDividendData : null;

  const xray = buildPortfolioXray({
    holdings: [
      { code: '0050', shares: 2000 },
      { code: '00878', shares: 5000 },
      { code: '00981A', shares: 5000 },
      { code: '00980A', shares: 5000 },
      { code: '2330', shares: 100 },
      { code: '00679B', shares: 5000 },
    ],
    etfs,
    top10,
    active,
    yields,
    stockDivs,
  });

  assert.ok(xray.totalValue > 0);
  assert.equal(xray.hasLowerBound, true);
  assert.equal(xray.exposures[0]?.code, '2330', '同時持有 0050＋主動式＋台積電，最大曝險應為台積電');
  assert.ok(xray.exposures[0].sources.length >= 2);
  assert.equal(xray.exposures.some(e => e.code.startsWith('TX') || e.code.startsWith('WTX')), false, '不可把主動式期貨算進個股');
  assert.equal(xray.exposures.some(e => e.code.startsWith('US')), false, '不可把美債 ISIN 算進個股');
  const b00679 = xray.breakdown.find(b => b.code === '00679B');
  assert.equal(b00679?.status, 'unpenetrable');
  assert.equal(b00679?.unpenetrableKind, 'bond');
});
