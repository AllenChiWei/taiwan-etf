/* 結算價預測：用證交所每 5 秒的實際指數重算，必須和期交所公告的最後結算價一樣。
   另外看兩種不完整的情況（網頁 13:00 後才打開只有每分鐘資料、還沒收盤）誤差在合理範圍。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  hmsSec, secLabel, predictSettle, settleDates, nextSettle, taipeiNow, strikeNeed, strikesAround, settleCurve,
  SLOT_FIRST, SLOT_LAST, CLOSE_SEC, TOTAL, type Point,
} from '../src/lib/settle.ts';

interface Day { date: string; fsp: number; from: string; step: number; v: number[] }
const DAYS: Day[] = JSON.parse(readFileSync(new URL('./fixtures/settle_days.json', import.meta.url), 'utf8')).days;

const pointsOf = (d: Day): Point[] => d.v.map((v, i) => ({ sec: hmsSec(d.from) + i * d.step, v }));

test('時間換算', () => {
  assert.equal(hmsSec('13:00:05'), SLOT_FIRST);
  assert.equal(hmsSec('132500'), SLOT_LAST);
  assert.equal(hmsSec(133000), CLOSE_SEC);
  assert.ok(Number.isNaN(hmsSec('13:xx')));
  assert.equal(secLabel(SLOT_LAST), '13:25:00');
  assert.equal(TOTAL, 301);
});

test('每 5 秒都有：和期交所公告的最後結算價一模一樣（4 個結算日）', () => {
  for (const d of DAYS) {
    const pts = pointsOf(d);
    const cur = pts[pts.length - 1];                   // 13:30:00 收盤
    const p = predictSettle(pts.slice(0, -1), cur);
    assert.equal(p.final, true);
    assert.equal(p.fixed, 301);
    assert.equal(p.interpolated, 0);
    assert.equal(p.rounded, d.fsp, `${d.date}`);
  }
});

test('13:00 後才打開網頁、只有每分鐘資料：差不到 10 點', () => {
  for (const d of DAYS) {
    const pts = pointsOf(d).filter(p => p.sec % 60 === 0);
    const cur = pts[pts.length - 1];
    const p = predictSettle(pts.slice(0, -1), cur);
    assert.equal(p.interpolated, 300 - 25);          // 13:01～13:25 共 25 個整分是真值
    assert.ok(Math.abs(p.rounded - d.fsp) < 10, `${d.date} 差 ${p.rounded - d.fsp}`);
  }
});

test('13:25 收盤前：剩收盤一筆，差不到 3 點', () => {
  for (const d of DAYS) {
    const pts = pointsOf(d).filter(p => p.sec <= SLOT_LAST);
    const cur = pts[pts.length - 1];
    const p = predictSettle(pts.slice(0, -1), cur);
    assert.equal(p.final, false);
    assert.equal(p.fixed, 300);
    assert.ok(Math.abs(p.rounded - d.fsp) < 3, `${d.date} 差 ${p.rounded - d.fsp}`);
  }
});

test('13:00 以前：預測就是目前指數；中途預測只用已過的取樣點', () => {
  assert.equal(predictSettle([], { sec: hmsSec('12:59:00'), v: 40000.4 }).rounded, 40000);
  const p = predictSettle([{ sec: SLOT_FIRST, v: 100 }], { sec: SLOT_FIRST + 5, v: 400 });
  assert.equal(p.fixed, 2);
  assert.equal(p.value, (100 + 400 * 300) / 301);
});

test('漏抓的 5 秒用前後內插', () => {
  const p = predictSettle([{ sec: SLOT_FIRST - 5, v: 100 }], { sec: SLOT_FIRST + 5, v: 120 });
  assert.equal(p.interpolated, 1);                   // 13:00:05 介於 100 與 120 之間 → 110
  assert.equal(p.value, (110 + 120 * 299 + 120) / 301);
});

test('結算日：atm.json 的到期日去重排序，下一個（含今天）', () => {
  const ds = settleDates([{ e: '2026-11-25' }, { e: '2026-11-20' }, { e: '2026-11-25' }, {}]);
  assert.deepEqual(ds, ['2026-11-20', '2026-11-25']);
  assert.equal(nextSettle(ds, '2026-11-20'), '2026-11-20');
  assert.equal(nextSettle(ds, '2026-11-21'), '2026-11-25');
  assert.equal(nextSettle(ds, '2026-11-26'), null);
});

test('台北時間', () => {
  const t = taipeiNow(new Date('2026-11-20T05:25:00Z'));
  assert.equal(t.date, '2026-11-20');
  assert.equal(t.sec, SLOT_LAST);
  assert.equal(taipeiNow(new Date('2026-11-20T16:30:00Z')).date, '2026-11-21');
});

test('履約價門檻：剩下的平均剛好到門檻就翻過去，差一點就不會', () => {
  for (const d of DAYS) {
    const all = pointsOf(d);
    const cut = hmsSec('13:15:00');
    const pts = all.filter(p => p.sec <= cut);
    const p = predictSettle(pts.slice(0, -1), pts[pts.length - 1]);
    assert.equal(p.fixed + p.remaining, TOTAL);
    assert.equal(p.remaining, 301 - 180);
    for (const K of strikesAround(p.rounded)) {
      const n = strikeNeed(p, K)!;
      const settleIf = (avg: number) => Math.floor((p.fixedSum + avg * p.remaining) / TOTAL + 0.5);
      assert.ok(settleIf(n.above) > K && settleIf(n.above - 0.01) <= K, `${d.date} K${K} above`);
      assert.ok(settleIf(n.below - 0.01) < K && settleIf(n.below) >= K, `${d.date} K${K} below`);
    }
    // 剩下的平均＝目前指數時，就是 predictSettle 的預測
    assert.equal(Math.floor((p.fixedSum + pts[pts.length - 1].v * p.remaining) / TOTAL + 0.5), p.rounded);
  }
  const fin = predictSettle([], { sec: CLOSE_SEC, v: 100 });
  assert.equal(fin.remaining, 0);
  assert.equal(strikeNeed(fin, 100), null);
});

test('附近履約價：50 點一檔，下兩檔上兩檔', () => {
  assert.deepEqual(strikesAround(35840), [35750, 35800, 35850, 35900]);
  assert.deepEqual(strikesAround(35800), [35750, 35800, 35850, 35900]);
});

test('預測曲線：最後一點＝期交所公告，中途每一點＝當時的 predictSettle', () => {
  for (const d of DAYS) {
    const pts = pointsOf(d);
    const c = settleCurve(pts, CLOSE_SEC);
    assert.equal(c[0].sec, SLOT_FIRST - 5);
    assert.equal(c[c.length - 1].sec, CLOSE_SEC);
    assert.equal(c[c.length - 1].p, d.fsp, d.date);
    for (const sec of [hmsSec('13:03:20'), hmsSec('13:12:00'), SLOT_LAST, hmsSec('13:27:00')]) {
      const upTo = pts.filter(p => p.sec <= sec);
      const want = predictSettle(upTo.slice(0, -1), upTo[upTo.length - 1]).rounded;
      assert.equal(c.find(x => x.sec === sec)!.p, want, `${d.date} ${secLabel(sec)}`);
    }
  }
  assert.deepEqual(settleCurve([], CLOSE_SEC), []);
});

test('結算價歷史：新到舊、13:00 偏移、公告優先', async () => {
  const { settleHistory, driftStats } = await import('../src/lib/settle.ts');
  const v = Array.from({ length: 361 }, () => 100);
  const h = settleHistory([
    { d: '2026-11-18', c: ['202611'], settle: 130, fsp: 130, v },
    { d: '2026-11-20', c: ['202611F3'], settle: 90, fsp: 91, v },
    { d: '2025-12-12', c: ['202512F2'], settle: 50 },
  ]);
  assert.deepEqual(h.map(x => x.d), ['2026-11-20', '2026-11-18', '2025-12-12']);
  assert.equal(h[0].drift, -9);                     // 用公告 91 − 13:00 的 100
  assert.equal(h[1].drift, 30);
  assert.equal(h[2].drift, undefined);
  const s = driftStats(h)!;
  assert.equal(s.n, 2);
  assert.equal(s.meanAbs, 19.5);
  assert.equal(s.maxAbs, 30);
  assert.equal(s.up, 1);
  assert.equal(s.down, 1);
  assert.equal(driftStats([]), null);
});
