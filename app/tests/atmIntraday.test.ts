/* 盤中價平和的統計：整點挑選、到期當日換口、消耗曲線的基準與分組、夜盤／跳空／日盤三段。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

import {
  sums, synthetic, hourlyIndex, pickRow, decayCurves, sessionDecay,
  type AtmDay, type AtmDayRow,
} from '../src/lib/atmIntraday.ts';

const T = ['15:15', '15:30', '04:45', '05:00', '09:00', '09:15', '13:30', '13:45'];
const S: AtmDay['sess'] = ['N', 'N', 'N', 'N', 'D', 'D', 'D', 'D'];

function row(over: Partial<AtmDayRow>): AtmDayRow {
  const n = T.length;
  return {
    s: 'wed', r: 0, c: '202610W1', e: '2026-10-07', dte: 2,
    k: Array(n).fill(48000), call: Array(n).fill(200), put: Array(n).fill(200), ...over,
  };
}

function day(d: string, rows: AtmDayRow[]): AtmDay {
  return { d, step: 15, sess: S, t: T, rows };
}

test('價平和與合成期貨', () => {
  const r = row({ call: [210, null, 0, 0, 0, 0, 0, 0], put: [190, 1, 0, 0, 0, 0, 0, 0] });
  assert.equal(sums(r)[0], 400);
  assert.equal(sums(r)[1], null, '缺一邊就是 null，不能當 0');
  assert.equal(synthetic(r)[0], 48020, '履約價 + C − P');
});

test('60 分鐘只留整點與每個盤別的最後一點', () => {
  const idx = hourlyIndex(day('2026-10-05', [row({})]));
  // 05:00（夜盤最後也是整點）、09:00、13:45（日盤最後）
  assert.deepEqual(idx.map(i => T[i]), ['05:00', '09:00', '13:45']);
});

test('到期當日可以改看下一口', () => {
  const d = day('2026-10-07', [row({ dte: 0 }), row({ r: 1, c: '202610W2', dte: 7 })]);
  assert.equal(pickRow(d, 'wed', false)?.c, '202610W1');
  assert.equal(pickRow(d, 'wed', true)?.c, '202610W2');
  assert.equal(pickRow(d, 'fri', true), null, '沒有這個系列就是 null');
});

test('消耗曲線：以第一個有報價的點為 1，依剩餘天數分組', () => {
  const half = (start: number) => row({
    call: [null, start / 2, start / 2, start / 2, start / 4, start / 4, start / 4, start / 4],
    put: [null, start / 2, start / 2, start / 2, start / 4, start / 4, start / 4, start / 4],
  });
  const days = [day('2026-10-05', [half(800)]), day('2026-10-06', [half(400)]),
                day('2026-10-02', [row({ dte: 5 })])];
  const cs = decayCurves(days, 'wed', 1);
  assert.deepEqual(cs.map(c => c.dte), [2, 5]);
  const c2 = cs[0];
  assert.equal(c2.days, 2);
  assert.equal(c2.ratio[0], null, '第一個點沒有報價');
  assert.equal(c2.ratio[1], 1);
  assert.equal(c2.ratio[4], 0.5, '起點不同，但比例相同 → 中位數 0.5');
  assert.equal(c2.start, 600);
});

test('三段流失：夜盤、隔夜到開盤、日盤', () => {
  const r = row({
    call: [500, 480, 460, 450, 420, 410, 300, 250],
    put: [500, 480, 460, 450, 420, 410, 300, 250],
  });
  const [s] = sessionDecay([day('2026-10-05', [r])], 'wed');
  assert.ok(Math.abs((s.night as number) - 0.1) < 1e-9, '1000 → 900');
  assert.ok(Math.abs((s.gap as number) - (1 - 840 / 900)) < 1e-9);
  assert.ok(Math.abs((s.day as number) - (1 - 500 / 840)) < 1e-9);
});

test('實際資料檔（有產生時）格式一致', () => {
  const dir = new URL('../public/data/atm_intraday/', import.meta.url);
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  for (const f of files.slice(-3)) {
    const d = JSON.parse(readFileSync(new URL(f, dir), 'utf-8')) as AtmDay;
    assert.equal(d.t.length, d.sess.length, f);
    for (const r of d.rows) {
      assert.equal(r.k.length, d.t.length, `${f} ${r.c}`);
      assert.equal(r.call.length, r.put.length, `${f} ${r.c}`);
      assert.ok(r.dte >= 0, `${f} ${r.c} 不該有已到期的合約`);
    }
  }
});
