/* 任選兩檔 ETF 比對（lib/overlap.ts 的 holdingsOf／compareHoldings）：來源選擇、期貨不算、重疊度＝Σmin，外加對真實資料的檢查。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { holdingsOf, compareHoldings, overlapPairs } from '../src/lib/overlap.ts';
import type { Top10Data } from '../src/lib/top10.ts';
import type { ActiveData } from '../src/lib/active.ts';
import type { FullHoldingsData } from '../src/lib/fullHoldings.ts';

const monthly: Top10Data = {
  meta: { ym: '202610', updated: '', source: '' },
  etfs: {
    '0050': { name: '元大台灣卓越50', rows: [[1, '國內上市', '2330', '台積電', 57.35], [2, '國內上市', '2454', '聯發科', 5.64], [3, '國內上市', '2317', '鴻海', 4.2]] },
    '006208': { name: '富邦台50', rows: [[1, '國內上市', '2330', '台積電', 57.0], [2, '國內上市', '2317', '鴻海', 4.5], [3, '國內上市', '2308', '台達電', 2.1]] },
    '00625': { name: '富邦上証', rows: [[1, '國外', 'X', 'Y', 10]] },
    '00981A': { name: '統一台股增長', rows: [[1, '國內上市', '2330', '台積電', 9]] },
  },
};
const active: ActiveData = {
  meta: { updated: '', minChange: 0.005, blocked: [], source: '', errors: [] },
  etfs: {
    '00981A': { name: '', issuer: '', asof: '2026-11-18', changes: [],
                holdings: [['2330', '台灣積體電路製造', 1, 10], ['2454', '聯發科', 1, 3], ['TX', '台股期貨', 1, 20], ['6669', '緯穎', 1, 1.5]] },
  },
} as unknown as ActiveData;

test('來源：主動式用每日持股（不只前十大），其他用公會月報', () => {
  const d = holdingsOf('00981A', monthly, active)!;
  assert.equal(d.kind, 'daily');
  assert.equal(d.asof, '2026-11-18');
  assert.equal(d.w.size, 3, '期貨不算持股');
  assert.equal(d.w.get('2330')!.pct, 10, '每日的優先，不用月報的 9%');
  assert.equal(d.covered, 14.5);
  const m = holdingsOf('0050', monthly, active)!;
  assert.equal(m.kind, 'monthly');
  assert.equal(m.asof, '2026/10');
  assert.equal(holdingsOf('00625K', monthly, null)!.code, '00625K', '雙幣別代號退回本尊');
  assert.equal(holdingsOf('9999', monthly, active), null);
});

test('重疊度＝共同持股取較小佔比相加；共同、只有一邊的都列出', () => {
  const r = compareHoldings(holdingsOf('0050', monthly, null)!, holdingsOf('006208', monthly, null)!);
  assert.deepEqual(r.common.map(c => c.code), ['2330', '2317']);
  assert.ok(Math.abs(r.overlap - (57.0 + 4.2)) < 1e-9);
  assert.ok(Math.abs(r.sumA - (57.35 + 4.2)) < 1e-9);
  assert.ok(Math.abs(r.sumB - (57.0 + 4.5)) < 1e-9);
  assert.deepEqual(r.onlyA.map(x => x.code), ['2454']);
  assert.deepEqual(r.onlyB.map(x => x.code), ['2308']);
});

test('每日 vs 月報：代號對得上就算共同，名稱取短的', () => {
  const r = compareHoldings(holdingsOf('00981A', monthly, active)!, holdingsOf('0050', monthly, active)!);
  assert.deepEqual(r.common.map(c => c.code), ['2330', '2454']);
  assert.equal(r.common[0].name, '台積電');
  assert.equal(r.overlap, 10 + 3);
  assert.deepEqual(r.onlyA.map(x => x.code), ['6669']);
});

test('同一檔跟自己比：重疊度＝自己的涵蓋', () => {
  const s = holdingsOf('0050', monthly, null)!;
  const r = compareHoldings(s, s);
  assert.ok(Math.abs(r.overlap - s.covered) < 1e-9);
  assert.equal(r.onlyA.length + r.onlyB.length, 0);
});

test('overlapPairs：主動式改用每日完整持股、期貨不計，且僅有每日資料也納入', () => {
  const activeOnly: ActiveData = {
    meta: { updated: '', minChange: 0.005, blocked: [], source: '', errors: [] },
    etfs: {
      ...active.etfs,
      '00999A': { name: '新主動', issuer: '', asof: '2026-11-18', changes: [],
                  holdings: [['6669', '緯穎', 1, 5], ['TX', '台股期貨', 1, 30]] },
    },
  } as unknown as ActiveData;
  const r = overlapPairs(monthly, ['0050', '00981A', '00999A', '00981A', 'UNKNOWN'], activeOnly);
  assert.deepEqual(r.covered, ['0050', '00981A', '00999A'], '重複代號只算一次，僅有每日資料的新主動式也涵蓋');
  assert.equal(r.sets['00981A'].kind, 'daily');
  assert.equal(r.sets['0050'].kind, 'monthly');
  const p050 = r.pairs.find(p => (p.a === '0050' && p.b === '00981A') || (p.a === '00981A' && p.b === '0050'))!;
  assert.equal(p050.overlap, 13, '使用每日的 10%+3% 而非月報的 9%');
  const pAct = r.pairs.find(p => (p.a === '00981A' && p.b === '00999A') || (p.a === '00999A' && p.b === '00981A'))!;
  assert.equal(pAct.overlap, 1.5, '期貨不計重疊，只算 6669 緯穎的 min(1.5, 5)');

  // 缺 top10.json 時仍能用 active_holdings.json 比較主動式 ETF
  const noTop10 = overlapPairs(null, ['00981A', '00999A'], activeOnly);
  assert.deepEqual(noTop10.covered, ['00981A', '00999A']);
  assert.equal(noTop10.pairs.length, 1);
  assert.equal(noTop10.pairs[0].overlap, 1.5);
});

test('holdingsOf 四層優先序：主動式每日 > 被動式每日全部持股 > 公會季報 1%↑（覆蓋更高時）> 公會月報前十大', () => {
  const full: FullHoldingsData = {
    meta: { updated: '2026-11-28', source: 'test' },
    etfs: {
      // 主動式 00981A 即使出現在 full，仍以 active 每日優先
      '00981A': {
        name: '統一台股增長', asof: '2026-11-27', src: '統一投信', basis: 'weight',
        holdings: [['2330', '台積電', 100, 12]],
      },
      // 被動式 0050：投信 PCF（qty 換算）優先於月報前十大
      '0050': {
        name: '元大台灣50', asof: '2026-11-27', src: '元大投信', basis: 'qty', denom: 'stock',
        holdings: [['2330', '台積電', 100, 60], ['2454', '聯發科', 100, 5], ['2881', '富邦金', 100, 2]],
      },
      // 006208 季報 1%↑（合計 72% > 月報 63.6%）→ 改用季報
      '006208': {
        name: '富邦台50', asof: '2026Q3', src: '投信投顧公會季報', basis: 'quarterly1pct',
        holdings: [
          ['2330', '台積電', 0, 58, '國內上市'],
          ['2317', '鴻海', 0, 5, '國內上市'],
          ['2454', '聯發科', 0, 5, '國內上市'],
          ['2308', '台達電', 0, 4, '國內上市'],
        ],
      },
      // 00625 季報合計僅 8% <= 月報 10% → 保留較新的月報前十大
      '00625': {
        name: '富邦上証', asof: '2026Q3', src: '投信投顧公會季報', basis: 'quarterly1pct',
        holdings: [['X', 'Y', 0, 8, '國外']],
      },
      // 只有季報、沒有月報 → 採用季報
      '00878': {
        name: '國泰永續高股息', asof: '2026Q3', src: '投信投顧公會季報', basis: 'quarterly1pct',
        holdings: [['2357', '華碩', 0, 5.1, '國內上市'], ['2303', '聯電', 0, 4.2, '國內上市']],
      },
    },
  };

  const act = holdingsOf('00981A', monthly, active, full)!;
  assert.equal(act.kind, 'daily');
  assert.equal(act.w.get('2330')!.pct, 10);

  const pcf = holdingsOf('0050', monthly, active, full)!;
  assert.equal(pcf.kind, 'pcf');
  assert.equal(pcf.asof, '2026-11-27');
  assert.equal(pcf.src, '元大投信');
  assert.equal(pcf.basis, 'qty');
  assert.equal(pcf.denom, 'stock');
  assert.equal(pcf.w.size, 3);
  assert.equal(pcf.w.get('2881')!.pct, 2);

  const qBetter = holdingsOf('006208', monthly, active, full)!;
  assert.equal(qBetter.kind, 'quarterly');
  assert.equal(qBetter.asof, '2026Q3');
  assert.equal(qBetter.covered, 72);

  const mFresher = holdingsOf('00625', monthly, active, full)!;
  assert.equal(mFresher.kind, 'monthly', '季報涵蓋權重未高於月報時保留月報');
  assert.equal(mFresher.covered, 10);

  const qOnly = holdingsOf('00878', monthly, active, full)!;
  assert.equal(qOnly.kind, 'quarterly');
  assert.equal(qOnly.w.size, 2);

  // 缺 full（null）時一切照舊
  assert.equal(holdingsOf('0050', monthly, active, null)!.kind, 'monthly');

  // overlapPairs 帶入 full 會採用 0050 PCF 與 006208 季報
  const op = overlapPairs(monthly, ['0050', '006208'], active, full);
  assert.equal(op.sets['0050'].kind, 'pcf');
  assert.equal(op.sets['006208'].kind, 'quarterly');
  assert.equal(op.pairs[0].overlap, 58 + 5);
});

test('真實資料：0050 vs 006208 重疊高、都有台積電；主動式與被動式每日持股合計合理', () => {
  const tf = new URL('../public/data/top10.json', import.meta.url);
  const af = new URL('../public/data/active_holdings.json', import.meta.url);
  const ff = new URL('../public/data/etf_holdings.json', import.meta.url);
  if (!existsSync(tf)) return;
  const top10 = JSON.parse(readFileSync(tf, 'utf-8')) as Top10Data;
  const act = existsSync(af) ? JSON.parse(readFileSync(af, 'utf-8')) as ActiveData : null;
  const full = existsSync(ff) ? JSON.parse(readFileSync(ff, 'utf-8')) as FullHoldingsData : null;
  const a = holdingsOf('0050', top10, act, full), b = holdingsOf('006208', top10, act, full);
  if (a && b) {
    const r = compareHoldings(a, b);
    assert.ok(r.overlap > 30, `兩檔都追蹤台灣 50，重疊度應該很高（${r.overlap.toFixed(1)}%）`);
    assert.ok(r.overlap <= Math.min(a.covered, b.covered) + 1e-9, '重疊度不會超過任一邊的涵蓋');
    assert.ok(r.common.some(c => c.code === '2330'));
  }
  for (const [code, e] of Object.entries(act?.etfs ?? {})) {
    if (!e.holdings.length) continue;
    const s = holdingsOf(code, top10, act, full);
    assert.ok(s && s.kind === 'daily' && s.covered > 0 && s.covered <= 130, `${code} 每日持股合計合理（${s?.covered}）`);
  }
  for (const [code, e] of Object.entries(full?.etfs ?? {})) {
    if (e.basis === 'quarterly1pct' || !e.holdings.length || act?.etfs[code]?.holdings.length) continue;
    const s = holdingsOf(code, top10, act, full);
    assert.ok(s && s.kind === 'pcf' && s.covered > 0 && s.covered <= 115, `${code} 被動式 PCF 合計合理（${s?.covered}）`);
  }
});
