/* 結算價預測：用證交所每 5 秒的實際指數重算，必須和期交所公告的最後結算價一樣。
   另外看兩種不完整的情況（網頁 13:00 後才打開只有每分鐘資料、還沒收盤）誤差在合理範圍。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  hmsSec, secLabel, predictSettle, settleDates, nextSettle, taipeiNow, strikeNeed, strikesAround, settleCurve,
  isoFromYmd, mergeLiveResponse, collectLivePoints, shouldPollSettle, shouldFetchExact, exactPointsForDate,
  settleCardTitle, SLOT_FIRST, SLOT_LAST, CLOSE_SEC, POLL_END_SEC, TOTAL, type ExactSeries, type LiveSnapshot, type Point,
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

const mkLive = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  src: 'mis',
  d: '20261125',
  t: '13:14:20',
  z: 38143.54,
  bars: [[131300, 38145.87], [131400, 38149.11]],
  samples: [],
  ...over,
});

test('即時合併：時間倒退只補沒收過的點，畫面時間與預測值不往回跳', () => {
  const today = '2026-11-25';
  const r1 = mergeLiveResponse(null, mkLive({ t: '13:14:20', z: 38143.54 }), new Map(), today);
  assert.equal(r1.live?.t, '13:14:20');
  assert.equal(r1.samples.get(hmsSec('13:14:20')), 38143.54);

  // 晚到的真實 5 秒點（13:13:05）：補進 samples，但畫面維持 13:14:20 不倒退
  const r2 = mergeLiveResponse(r1.live, mkLive({ t: '13:13:05', z: 38143.69 }), r1.samples, today);
  assert.equal(r2.live?.t, '13:14:20');
  assert.equal(r2.live?.z, 38143.54);
  assert.equal(r2.samples.get(hmsSec('13:13:05')), 38143.69);

  // 已收過的舊時間點再回來：不覆蓋原值
  const r3 = mergeLiveResponse(r2.live, mkLive({ t: '13:13:05', z: 99999 }), r2.samples, today);
  assert.equal(r3.live?.t, '13:14:20');
  assert.equal(r3.samples.get(hmsSec('13:13:05')), 38143.69);

  // mis_ohlc 偶發失敗（bars 空）但時間前進：沿用前一份 bars
  const r4 = mergeLiveResponse(r3.live, mkLive({ t: '13:14:30', z: 38143.87, bars: [] }), r3.samples, today);
  assert.equal(r4.live?.t, '13:14:30');
  assert.deepEqual(r4.live?.bars, [[131300, 38145.87], [131400, 38149.11]]);
});

test('即時合併：非 MIS 或非今日回應不寫入 samples，非 MIS 不覆蓋畫面', () => {
  const today = '2026-11-25';
  assert.equal(isoFromYmd('20261125'), today);

  // 首次就收到 Yahoo：忽略，不寫入 samples 也不設為 live
  const y0 = mergeLiveResponse(null, mkLive({ src: 'yahoo', t: '12:54:55', z: 38193.68 }), new Map(), today);
  assert.equal(y0.live, null);
  assert.equal(y0.samples.size, 0);

  // 已有 MIS 時收到 Yahoo：不寫入 samples、不覆蓋既有畫面
  const m1 = mergeLiveResponse(null, mkLive({ t: '13:14:20', z: 38143.54 }), new Map(), today);
  const y1 = mergeLiveResponse(m1.live, mkLive({ src: 'yahoo', t: '13:15:00', z: 38000 }), m1.samples, today);
  assert.equal(y1.live?.t, '13:14:20');
  assert.equal(y1.live?.z, 38143.54);
  assert.equal(y1.samples.has(hmsSec('13:15:00')), false);

  // 非今日（前一天）MIS 回應：不寫入今日 samples
  const oldDay = mergeLiveResponse(null, mkLive({ d: '20261124', t: '13:30:00', z: 38000 }), new Map(), today);
  assert.equal(oldDay.samples.size, 0);
});

test('收盤後校正：interpolated 為 0 仍觸發證交所每 5 秒資料校正', () => {
  const fullPts: Point[] = [];
  for (let s = SLOT_FIRST; s <= SLOT_LAST; s += 5) fullPts.push({ sec: s, v: 38000 });
  const predFull = predictSettle(fullPts, { sec: CLOSE_SEC, v: 38141.53 });
  assert.equal(predFull.final, true);
  assert.equal(predFull.interpolated, 0);
  assert.equal(shouldFetchExact(predFull, true, false), true);
  assert.equal(shouldFetchExact(predFull, true, true), false);
  assert.equal(shouldFetchExact(predFull, false, false), false);

  const predMid = predictSettle(fullPts.slice(0, 10), { sec: SLOT_FIRST + 50, v: 38000 });
  assert.equal(predMid.final, false);
  assert.equal(shouldFetchExact(predMid, true, false), false);
});

test('13:30 後輪詢延續至 13:35（或校正完成）且收盤值可更新', () => {
  const today = '2026-11-25';
  const startSec = 12 * 3600 + 55 * 60;

  // 13:30:10 看到 13:30:00 凍結價：不立刻停，繼續輪詢
  assert.equal(shouldPollSettle({ isToday: true, demo: false, nowSec: hmsSec('13:30:10'), startSec, liveSec: CLOSE_SEC, hasExact: false }), true);
  // 13:34:00 若 MI_5MINS_INDEX 已校正完成：停止輪詢
  assert.equal(shouldPollSettle({ isToday: true, demo: false, nowSec: hmsSec('13:34:00'), startSec, liveSec: hmsSec('13:33:00'), hasExact: true }), false);
  // 台北時間到 13:35:00 且已收盤：停止輪詢
  assert.equal(shouldPollSettle({ isToday: true, demo: false, nowSec: POLL_END_SEC, startSec, liveSec: hmsSec('13:33:00'), hasExact: false }), false);
  // 13:40 才打開頁面尚未取得資料：先抓一次
  assert.equal(shouldPollSettle({ isToday: true, demo: false, nowSec: hmsSec('13:40:00'), startSec, liveSec: null, hasExact: false }), true);

  // 模擬 300 格皆 38000，13:30 先收到凍結價 38141.53（結算價 38000），13:33 收到真收盤 38195.43（翻成 38001）
  const baseSamples = new Map<number, number>();
  for (let s = SLOT_FIRST; s <= SLOT_LAST; s += 5) baseSamples.set(s, 38000);
  baseSamples.set(SLOT_FIRST - 5, 38000);

  const freeze = mergeLiveResponse(
    null,
    mkLive({ t: '13:30:00', z: 38141.53, bars: [[133000, 38141.53]], samples: [[133000, 38141.53]] }),
    baseSamples,
    today,
  );
  assert.equal(freeze.samples.get(CLOSE_SEC), 38141.53);
  const pFreeze = predictSettle(collectLivePoints(freeze.live!, freeze.samples), { sec: CLOSE_SEC, v: freeze.live!.z });
  assert.equal(pFreeze.rounded, 38000);

  // 同時間 13:30:00 更新為真收盤價
  const sameTsUpdate = mergeLiveResponse(
    freeze.live,
    mkLive({ t: '13:30:00', z: 38195.43, bars: [[133000, 38195.43]], samples: [[133000, 38141.53]] }),
    freeze.samples,
    today,
  );
  assert.equal(sameTsUpdate.live?.z, 38195.43);
  assert.equal(sameTsUpdate.samples.get(CLOSE_SEC), 38195.43);

  // 13:33:00 延遲揭露的真收盤價更新（如 11-25 mis_ohlc 實測）
  const lateClose = mergeLiveResponse(
    freeze.live,
    mkLive({ t: '13:33:00', z: 38195.43, bars: [[133300, 38195.43]], samples: [[133000, 38141.53]] }),
    freeze.samples,
    today,
  );
  assert.equal(lateClose.live?.t, '13:33:00');
  assert.equal(lateClose.live?.z, 38195.43);
  assert.equal(lateClose.samples.get(CLOSE_SEC), 38195.43);
  const latePts = collectLivePoints(lateClose.live!, lateClose.samples);
  const pLate = predictSettle(latePts, { sec: hmsSec(lateClose.live!.t), v: lateClose.live!.z });
  assert.equal(pLate.rounded, 38001);
  const curve = settleCurve([...latePts, { sec: hmsSec(lateClose.live!.t), v: lateClose.live!.z }], hmsSec(lateClose.live!.t));
  assert.equal(curve[curve.length - 1].v, 38195.43);
  assert.equal(curve[curve.length - 1].p, 38001);

  // 已拿到 13:33:00 真收盤後，舊節點再回 13:30:00 凍結價：不得倒退覆蓋
  const staleAfter = mergeLiveResponse(
    lateClose.live,
    mkLive({ t: '13:30:00', z: 38141.53, bars: [[133000, 38141.53]] }),
    lateClose.samples,
    today,
  );
  assert.equal(staleAfter.live?.t, '13:33:00');
  assert.equal(staleAfter.live?.z, 38195.43);
  assert.equal(staleAfter.samples.get(CLOSE_SEC), 38195.43);
});

test('即時合併：舊日期回應直接忽略不清空 samples，只有新日期才換日清空', () => {
  const today = '2026-11-25';
  const r0 = mergeLiveResponse(null, mkLive({ d: '20261125', t: '13:14:20', z: 38143.54 }), new Map(), today);
  const r1 = mergeLiveResponse(r0.live, mkLive({ d: '20261125', t: '13:14:25', z: 38144 }), r0.samples, today);
  assert.equal(r1.samples.size, 2);

  // 舊後端偶發回昨天（20261124）：直接忽略，保留今日畫面與已累積 samples
  const staleDay = mergeLiveResponse(
    r1.live,
    mkLive({ d: '20261124', t: '13:30:00', z: 37000, samples: [[131430, 37000]] }),
    r1.samples,
    today,
  );
  assert.equal(staleDay.live?.d, '20261125');
  assert.equal(staleDay.live?.t, '13:14:25');
  assert.equal(staleDay.live?.z, 38144);
  assert.equal(staleDay.samples.size, 2);
  assert.equal(staleDay.samples.get(hmsSec('13:14:20')), 38143.54);
  assert.equal(staleDay.samples.get(hmsSec('13:14:25')), 38144);
  assert.equal(staleDay.samples.has(CLOSE_SEC), false);
  assert.equal(staleDay.samples.has(hmsSec('13:14:30')), false);

  // 跨到下一個較新日期（20261127）：清空舊日 samples 並切到新日
  const rolled = mergeLiveResponse(
    staleDay.live,
    mkLive({ d: '20261127', t: '13:00:05', z: 38500 }),
    staleDay.samples,
    '2026-11-27',
  );
  assert.equal(rolled.live?.d, '20261127');
  assert.equal(rolled.live?.t, '13:00:05');
  assert.equal(rolled.live?.z, 38500);
  assert.equal(rolled.samples.size, 1);
  assert.equal(rolled.samples.has(hmsSec('13:14:20')), false);
  assert.equal(rolled.samples.get(SLOT_FIRST), 38500);
});

test('收盤後保護：收到 > 13:30:00 真收盤後，<= 該時間（含同時間）回應不可覆蓋 CLOSE 與畫面', () => {
  const today = '2026-11-25';
  const trueClose = mergeLiveResponse(
    null,
    mkLive({ t: '13:33:00', z: 38195.43, bars: [[133300, 38195.43]] }),
    new Map(),
    today,
  );
  assert.equal(trueClose.live?.t, '13:33:00');
  assert.equal(trueClose.samples.get(CLOSE_SEC), 38195.43);

  // 舊節點回 13:30:00 凍結價（< 13:33:00）：不得覆蓋
  const afterOlder = mergeLiveResponse(
    trueClose.live,
    mkLive({ t: '13:30:00', z: 38141.53, bars: [[133000, 38141.53]] }),
    trueClose.samples,
    today,
  );
  assert.equal(afterOlder.live?.t, '13:33:00');
  assert.equal(afterOlder.live?.z, 38195.43);
  assert.equal(afterOlder.samples.get(CLOSE_SEC), 38195.43);

  // 時間相同（=== 13:33:00）也算不比較新：不得覆蓋 CLOSE 與畫面
  const afterSame = mergeLiveResponse(
    trueClose.live,
    mkLive({ t: '13:33:00', z: 38141.53, bars: [[133300, 38141.53]] }),
    trueClose.samples,
    today,
  );
  assert.equal(afterSame.live?.t, '13:33:00');
  assert.equal(afterSame.live?.z, 38195.43);
  assert.equal(afterSame.samples.get(CLOSE_SEC), 38195.43);

  // 更晚時間（> 13:33:00）才允許更新
  const afterNewer = mergeLiveResponse(
    trueClose.live,
    mkLive({ t: '13:34:00', z: 38196.12, bars: [[133400, 38196.12]] }),
    trueClose.samples,
    today,
  );
  assert.equal(afterNewer.live?.t, '13:34:00');
  assert.equal(afterNewer.live?.z, 38196.12);
  assert.equal(afterNewer.samples.get(CLOSE_SEC), 38196.12);
});

test('證交所每 5 秒校正資料綁定日期：換日或跨日開著分頁時失效並重新輪詢校正', () => {
  const wedExact: ExactSeries = { d: '20261125', points: [{ sec: CLOSE_SEC, v: 38195.43 }] };
  assert.equal(exactPointsForDate(wedExact, '20261125'), wedExact.points);
  assert.equal(exactPointsForDate(null, '20261125'), null);

  // 跨到下一個結算日（liveToday 尚未拿到今日資料，liveDate 為 null）：舊日 exact 失效，恢復輪詢
  const crossDayExact = exactPointsForDate(wedExact, null);
  assert.equal(crossDayExact, null);
  assert.equal(shouldPollSettle({
    isToday: true,
    demo: false,
    nowSec: hmsSec('12:55:00'),
    startSec: hmsSec('12:55:00'),
    liveSec: null,
    hasExact: !!crossDayExact,
  }), true);

  // live 換成別天（20261127）：舊日 exact 失效，收盤後重新抓新日 MI_5MINS_INDEX
  const nextDayExact = exactPointsForDate(wedExact, '20261127');
  assert.equal(nextDayExact, null);
  assert.equal(shouldFetchExact({ final: true }, true, !!nextDayExact), true);
  assert.equal(shouldFetchExact({ final: true }, true, !!exactPointsForDate(wedExact, '20261125')), false);
});

test('卡片標題：盤中為預測、收盤後未校正為暫估、校正後才顯示最後結算價', () => {
  assert.equal(settleCardTitle(false, false), '預測最後結算價');
  const tentative = settleCardTitle(true, false);
  assert.equal(tentative, '收盤後暫估（等證交所資料校正）');
  assert.ok(!tentative.includes('最後結算價'));
  const calibrated = settleCardTitle(true, true);
  assert.equal(calibrated, '今天的最後結算價（自算，以期交所公告為準）');
  assert.ok(calibrated.includes('最後結算價'));
});
