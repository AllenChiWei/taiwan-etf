/* 結算價預測的即時指數轉接（Cloudflare Worker，2026-11-21）
 *
 * 為什麼要有它：證交所看盤（mis.twse.com.tw）與 Yahoo 的即時指數都沒有 CORS 標頭，
 * 網頁不能直接讀；證交所每 5 秒指數（MI_5MINS_INDEX）有 CORS，但收盤後才有資料。
 * 這支代抓證交所的加權指數（最新一筆＋當天每分鐘收盤），加上 CORS 回給網站。
 *
 * 不是開放代理：只接受 GET /taiex，上游網址寫死，CORS 只放行本站與本機預覽。
 * 證交所抓不到時退回 Yahoo（^TWII 每分鐘），回應裡 src 會標明來源。
 *
 * 2026-11-21 加兩件事：
 *   ① 4 秒快取：同一台轉接站 4 秒內的請求共用同一份結果（含正在抓的那一次），
 *      看的人再多，打證交所的次數都一樣，不會因為太頻繁被封鎖、也不會用完免費額度。
 *      workers.dev 網域不能用 Cache API，所以放在記憶體（同一個執行個體共用；換執行個體就重抓，沒關係）。
 *   ② 自己存每 5 秒取樣：排程（Cron Trigger，平日 12:59～13:30 每分鐘一次）每次跑將近一分鐘，
 *      跟著證交所每 5 秒抓一次指數，整分鐘存成 KV 一筆（s:YYYYMMDD:HHMM）。
 *      網頁回應多一個 samples，13:00 以後才打開網頁的人也拿得到前面每 5 秒的真值，不用再內插。
 *      沒綁 KV（env.SETTLE_KV）時這段整個略過，其他照常。
 *
 * 2026-11-25 結算日實測：getStockInfo 的加權指數 13:00～13:30 約每 2 分鐘才更新，30 分鐘只存到 9 筆。
 *   取樣改用分時走勢（mis_ohlc）的最後一筆（每 5～15 秒前進），並丟掉時間倒退的舊回應；
 *   網頁回應的最新指數也取兩者中較新的。
 *
 * 回應：{ ok, src: 'mis'|'yahoo', d: 'YYYYMMDD', t: 'HH:MM:SS', z: 最新指數, y: 昨收,
 *        bars: [[HHMMSS, 收盤], …]（12:55 以後的每分鐘，時間標在那一分鐘結束）,
 *        samples: [[HHMMSS, 指數], …]（排程存的證交所揭示值，時間＝證交所揭示時間）, kv: 有沒有綁 KV,
 *        at: 轉接站時間 }
 */

const ALLOW = [/^https:\/\/allenchiwei\.github\.io$/, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/];
const UA = 'Mozilla/5.0 (compatible; settle-proxy)';
const MIS_NOW = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0';
const MIS_OHLC = 'https://mis.twse.com.tw/stock/data/mis_ohlc_TSE.txt';
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1m&range=1d';
const FROM = 125500;
const TTL_MS = 4000;
const SAMPLE_FIRST = 1259, SAMPLE_LAST = 1330;   // 排程存的分鐘（台北 HHMM）

function cors(origin) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin && ALLOW.some(re => re.test(origin))) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split('?')[0]}`);
  return JSON.parse((await res.text()).trim());   // mis_ohlc 前面有一堆空行
}

const num = v => {
  const x = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(x) && x > 0 ? x : null;
};

/** 台北時間 → [YYYYMMDD, HHMM] */
export function taipei(ms) {
  const x = new Date(ms + 8 * 3600_000);
  const p = n => String(n).padStart(2, '0');
  return [`${x.getUTCFullYear()}${p(x.getUTCMonth() + 1)}${p(x.getUTCDate())}`, x.getUTCHours() * 100 + x.getUTCMinutes()];
}

/** 證交所看盤的最新一筆：{ d, t: HHMMSS 整數, z }；抓不到丟錯 */
export async function misNow() {
  const j = await getJson(`${MIS_NOW}&_=${Date.now()}`);
  const m = (j.msgArray || [])[0];
  const z = m && num(m.z);
  const t = m && parseInt(String(m.t || '').replace(/:/g, ''), 10);
  if (!m || z === null || !Number.isFinite(t)) throw new Error('mis 沒有最新指數');
  return { d: m.d, t, z };
}

/**
 * 分時走勢（mis_ohlc）的最新一筆：{ d, t: HHMMSS 整數, z }；抓不到丟錯。
 * 2026-11-25 結算日實測：getStockInfo 的加權指數 13:00～13:30 大約每 2 分鐘才更新（34 分鐘只有 28 個不同時間），
 * mis_ohlc 最後一筆每 5～15 秒前進（115 個不同時間、落後約 10～20 秒）→ 取樣改用這個。
 * 它偶爾會回很舊的內容（13:14:55 回 12:55:55），所以呼叫端要擋「時間倒退」。
 */
export async function ohlcNow() {
  const j = await getJson(`${MIS_OHLC}?_=${Date.now()}`);
  const a = j.ohlcArray || [];
  const b = a[a.length - 1];
  const t = b ? parseInt(b.ts, 10) : NaN;
  const z = b ? num(b.c) : null;
  const d = String(j.infoArray?.[0]?.d || String(j.staticObj?.key || '').replace(/^tse_/, ''));
  if (!b || z === null || !Number.isFinite(t) || !/^\d{8}$/.test(d)) throw new Error('mis_ohlc 沒有最新指數');
  return { d, t, z };
}

export async function fromMis() {
  const [now, ohlc] = await Promise.all([getJson(`${MIS_NOW}&_=${Date.now()}`), getJson(`${MIS_OHLC}?_=${Date.now()}`)]);
  const m = (now.msgArray || [])[0];
  if (!m) throw new Error('mis 沒有 msgArray');
  let z = num(m.z) ?? num(ohlc.lastIndex);
  if (z === null) throw new Error('mis 沒有最新指數');
  let t = m.t;
  const bars = [];
  for (const b of ohlc.ohlcArray || []) {
    const ts = parseInt(b.ts, 10), c = num(b.c);
    if (ts >= FROM && c !== null) bars.push([ts, c]);
  }
  // 11-25：getStockInfo 約 2 分鐘才更新，分時走勢最後一筆比較新就用它（同一天才比）
  const last = bars[bars.length - 1];
  const tNum = parseInt(String(t || '').replace(/:/g, ''), 10);
  if (last && m.d === String(ohlc.infoArray?.[0]?.d || m.d) && (!Number.isFinite(tNum) || last[0] > tNum)) {
    const s = String(last[0]).padStart(6, '0');
    t = `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4)}`;
    z = last[1];
  }
  return { src: 'mis', d: m.d, t, z, y: num(m.y), bars };
}

export async function fromYahoo() {
  const j = await getJson(YAHOO);
  const r = j.chart?.result?.[0];
  if (!r) throw new Error('yahoo 沒有資料');
  const tw = s => {                                 // UTC 秒 → 台北的 YYYYMMDD、HHMMSS
    const x = new Date((s + 8 * 3600) * 1000);
    const p = n => String(n).padStart(2, '0');
    return [`${x.getUTCFullYear()}${p(x.getUTCMonth() + 1)}${p(x.getUTCDate())}`,
            `${p(x.getUTCHours())}${p(x.getUTCMinutes())}${p(x.getUTCSeconds())}`];
  };
  const closes = r.indicators?.quote?.[0]?.close || [];
  const bars = [];
  (r.timestamp || []).forEach((s, i) => {
    const c = num(closes[i]);
    const ts = parseInt(tw(s + 60)[1], 10);         // Yahoo 標每分鐘開始 → 改成結束（同證交所）
    if (c !== null && ts >= FROM) bars.push([ts, c]);
  });
  const [d, hms] = tw(r.meta.regularMarketTime);
  return { src: 'yahoo', d, t: `${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4)}`,
           z: num(r.meta.regularMarketPrice), y: num(r.meta.chartPreviousClose), bars };
}

// ── ② 每 5 秒取樣：排程寫、網頁請求讀 ──────────────────────────────────────

const sampleKey = (d, hhmm) => `s:${d}:${String(hhmm).padStart(4, '0')}`;

/**
 * 排程每分鐘一次：從這分鐘開始抓到 :58 秒，跟著證交所每 5 秒的揭示抓（每格過 1.5 秒抓；
 * 揭示時間沒前進就 2 秒後再抓一次），最後整分鐘存一筆。一次最多 30 個請求（免費方案上限 50）。
 * now／sleep／fetchNow 可以換掉，給本機測試用。回傳存了幾筆。
 */
export async function collect(env, scheduledMs, { now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)), fetchNow = ohlcNow } = {}) {
  const start = Math.floor(scheduledMs / 60000) * 60000;
  const end = start + 58_000;
  const got = new Map();
  // 只收比這一分鐘開始前 2 分鐘還新、而且比已收到的更新的（伺服器偶爾回舊內容 → 時間倒退的丟掉）
  const st = new Date(start + 8 * 3600_000 - 120_000);
  let d = null, maxT = st.getUTCHours() * 10000 + st.getUTCMinutes() * 100 + st.getUTCSeconds();
  for (let polls = 0; polls < 30 && now() < end; polls++) {
    let advanced = false;
    try {
      const m = await fetchNow();
      if (m.t > maxT) {
        d = m.d;
        advanced = true;
        maxT = m.t;
        got.set(m.t, m.z);
      }
    } catch { /* 這一格沒抓到，下一格再抓 */ }
    const t = now();
    const wake = advanced ? start + Math.ceil((t - start + 1) / 5000) * 5000 + 1500 : t + 2000;
    if (wake >= end) break;
    await sleep(wake - t);
  }
  if (d && got.size) {
    await env.SETTLE_KV.put(sampleKey(d, taipei(start)[1]), JSON.stringify([...got]), { expirationTtl: 8 * 86400 });
  }
  return got.size;
}

const done = new Map();   // 已經寫好的分鐘（寫一次就不會再變）：key → 取樣；同一個執行個體不重複讀 KV

async function readSamples(env, d) {
  if (!env.SETTLE_KV) return [];
  const [today, nowHHMM] = taipei(Date.now());
  const keys = [];
  for (let hm = SAMPLE_FIRST; hm <= SAMPLE_LAST; hm = hm % 100 === 59 ? hm + 41 : hm + 1) {
    if (d === today && hm > nowHHMM) break;
    keys.push(sampleKey(d, hm));
  }
  const vals = await Promise.all(keys.map(async k => {
    if (done.has(k)) return done.get(k);
    const v = await env.SETTLE_KV.get(k, 'json').catch(() => null);
    if (Array.isArray(v)) done.set(k, v);
    return v;
  }));
  if (done.size > 200) done.clear();
  const out = new Map();
  for (const v of vals) for (const [t, z] of Array.isArray(v) ? v : []) out.set(t, z);
  return [...out].sort((a, b) => a[0] - b[0]);
}

// ── ① 4 秒快取 ────────────────────────────────────────────────────────────

let snap = null;   // { at, p: Promise<{ status, body }> }

async function build(env) {
  const errors = [];
  for (const get of [fromMis, fromYahoo]) {
    try {
      const live = await get();
      const samples = await readSamples(env, live.d).catch(() => []);
      const body = { ok: true, ...live, samples, kv: !!env.SETTLE_KV, at: new Date().toISOString() };
      if (errors.length) body.fallback = errors;
      return { status: 200, body: JSON.stringify(body) };
    } catch (e) {
      errors.push(String((e && e.message) || e).slice(0, 200));
    }
  }
  return { status: 502, body: JSON.stringify({ ok: false, errors }) };
}

export function snapshot(env, nowMs = Date.now()) {
  if (snap && nowMs - snap.at < TTL_MS) return snap.p;
  const p = build(env);
  snap = { at: nowMs, p };
  p.then(r => { if (r.status !== 200 && snap?.p === p) snap = null; }, () => { if (snap?.p === p) snap = null; });
  return p;
}

export default {
  async fetch(request, env = {}) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors(origin), 'Access-Control-Allow-Methods': 'GET' } });
    }
    if (request.method !== 'GET' || url.pathname !== '/taiex') {
      return new Response(JSON.stringify({ ok: false, error: '只有 GET /taiex' }), { status: 404, headers: cors(origin) });
    }
    const r = await snapshot(env);
    return new Response(r.body, { status: r.status, headers: cors(origin) });
  },

  async scheduled(event, env, ctx) {
    if (!env.SETTLE_KV) return;
    // 2026-11-23 實測：用 ctx.waitUntil 丟背景，排程一結束背景就被收掉，每分鐘只存到第一筆（20 分鐘只有 20 筆）。
    // 直接 await：排程觸發本身可以跑好幾分鐘，一分鐘內每 5 秒取一次（約 12 筆）才跑得完
    await collect(env, event.scheduledTime);
  },
};
