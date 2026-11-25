// 結算價預測轉接站離線測試（node 直接執行；可用 WORKER_JS 指定 worker.js，預設讀同目錄 ./worker.js）。
// 覆蓋第二輪修正：fromMis() 跨日取較新日期（項目 5）、getJson() 4 秒逾時隔離慢回應（項目 4）。
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const workerUrl = process.env.WORKER_JS
  ? pathToFileURL(process.env.WORKER_JS).href
  : new URL('./worker.js', import.meta.url).href;
const mod = await import(workerUrl);
const w = mod.default;

let ok = 0;
const pass = m => { ok++; console.log('PASS', m); };
const req = () => new Request('https://x/taiex', { headers: { Origin: 'https://allenchiwei.github.io' } });
const nowBody = (d, t, z, y = '40122.35') => JSON.stringify({
  msgArray: [{ d, t, z: String(z), y: String(y) }],
});
const ohlcBody = (bars, d = '20261125', y = '40122.35') => '\n\n' + JSON.stringify({
  infoArray: [{ d, t: '13:14:00', z: String(bars[bars.length - 1][1]), y }],
  staticObj: { key: 'tse_' + d },
  lastIndex: String(bars[bars.length - 1][1]),
  ohlcArray: bars.map(([ts, c]) => ({ ts: String(ts).padStart(6, '0'), c: String(c), s: '0', t: '0' })),
});

const realNow = Date.now;
const realFetch = globalThis.fetch;
let fake = realNow();
Date.now = () => (fake += 10_000);   // 每次請求都略過 4 秒快取

try {
  // ① 項目 5：兩來源都成功但 getStockInfo 日期較新（mis_ohlc 回昨日）→ 用 getStockInfo，不混昨日 bars
  {
    globalThis.fetch = async url => String(url).includes('getStockInfo')
      ? new Response(nowBody('20261127', '13:05:00', '38500.00', '38195.43'))
      : new Response(ohlcBody([[133000, 38141.53], [133300, 38195.43]], '20261126', '40122.35'));
    const r = await w.fetch(req(), {});
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.ok, true);
    assert.equal(j.src, 'mis');
    assert.equal(j.d, '20261127');
    assert.equal(j.t, '13:05:00');
    assert.equal(j.z, 38500);
    assert.equal(j.y, 38195.43);
    assert.deepEqual(j.bars, []);
    pass('fromMis 跨日：getStockInfo 較新時取今日、不用昨日 mis_ohlc');
  }

  // ② 項目 5：兩來源都成功但 mis_ohlc 日期較新（getStockInfo 回昨日）→ 用 mis_ohlc 與今日 bars
  {
    globalThis.fetch = async url => String(url).includes('getStockInfo')
      ? new Response(nowBody('20261126', '13:30:00', '38195.43', '40122.35'))
      : new Response(ohlcBody([[130500, 38500], [130520, 38512.5]], '20261127', '38195.43'));
    const r = await w.fetch(req(), {});
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.ok, true);
    assert.equal(j.src, 'mis');
    assert.equal(j.d, '20261127');
    assert.equal(j.t, '13:05:20');
    assert.equal(j.z, 38512.5);
    assert.equal(j.y, 38195.43);
    assert.deepEqual(j.bars, [[130500, 38500], [130520, 38512.5]]);
    pass('fromMis 跨日：mis_ohlc 較新時取今日與今日 bars');
  }

  // ③ 項目 5：兩來源同日時仍合併 bars 並取時間較新者
  {
    globalThis.fetch = async url => String(url).includes('getStockInfo')
      ? new Response(nowBody('20261127', '13:15:00', '38520.00', '38195.43'))
      : new Response(ohlcBody([[131400, 38510], [131440, 38515]], '20261127', '38195.43'));
    const r = await w.fetch(req(), {});
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.ok, true);
    assert.equal(j.d, '20261127');
    assert.equal(j.t, '13:15:00');
    assert.equal(j.z, 38520);
    assert.deepEqual(j.bars, [[131400, 38510], [131440, 38515]]);
    pass('fromMis 同日：時間較新者勝出並保留 bars');
  }

  // ④ 項目 4：getStockInfo 永遠不回應 → 約 4 秒逾時並中止 signal，仍用 mis_ohlc 回 ok:true
  {
    let aborted = false;
    globalThis.fetch = (url, init) => {
      if (String(url).includes('getStockInfo')) {
        init?.signal?.addEventListener('abort', () => { aborted = true; });
        return new Promise(() => {});
      }
      return Promise.resolve(new Response(ohlcBody([[131400, 38149.11], [131420, 38143.54]], '20261127', '38195.43')));
    };
    const t0 = performance.now();
    const r = await w.fetch(req(), {});
    const elapsed = performance.now() - t0;
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.ok, true);
    assert.equal(j.src, 'mis');
    assert.equal(j.d, '20261127');
    assert.equal(j.t, '13:14:20');
    assert.equal(j.z, 38143.54);
    assert.equal(aborted, true, '應送出 abort signal 中止掛起的請求');
    assert.ok(elapsed >= 3500 && elapsed < 7000, `逾時耗時異常：${Math.round(elapsed)}ms`);
    pass(`getJson 逾時：getStockInfo 掛起仍於 ${Math.round(elapsed)}ms 用 mis_ohlc 回 ok`);
  }

  // ⑤ 項目 4：mis_ohlc 永遠不回應 → 約 4 秒逾時並中止 signal，仍用 getStockInfo 回 ok:true
  {
    let aborted = false;
    globalThis.fetch = (url, init) => {
      if (String(url).includes('mis_ohlc')) {
        init?.signal?.addEventListener('abort', () => { aborted = true; });
        return new Promise(() => {});
      }
      return Promise.resolve(new Response(nowBody('20261127', '13:15:00', '38520.00', '38195.43')));
    };
    const t0 = performance.now();
    const r = await w.fetch(req(), {});
    const elapsed = performance.now() - t0;
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.ok, true);
    assert.equal(j.src, 'mis');
    assert.equal(j.d, '20261127');
    assert.equal(j.t, '13:15:00');
    assert.equal(j.z, 38520);
    assert.deepEqual(j.bars, []);
    assert.equal(aborted, true, '應送出 abort signal 中止掛起的請求');
    assert.ok(elapsed >= 3500 && elapsed < 7000, `逾時耗時異常：${Math.round(elapsed)}ms`);
    pass(`getJson 逾時：mis_ohlc 掛起仍於 ${Math.round(elapsed)}ms 用 getStockInfo 回 ok`);
  }
} finally {
  Date.now = realNow;
  globalThis.fetch = realFetch;
}
console.log(`全部 ${ok} 項 PASS`);
