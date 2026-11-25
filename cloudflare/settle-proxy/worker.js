/* 結算價預測的即時指數轉接（Cloudflare Worker，2026-11-21）
 *
 * 為什麼要有它：證交所看盤（mis.twse.com.tw）的即時指數沒有 CORS 標頭，
 * 網頁不能直接讀；證交所每 5 秒指數（MI_5MINS_INDEX）有 CORS，但收盤後才有資料。
 * 這支代抓證交所的加權指數（最新一筆＋當天每分鐘收盤），加上 CORS 回給網站。
 *
 * 不是開放代理：只接受 GET /taiex，上游網址寫死，CORS 只放行本站與本機預覽。
 * getStockInfo 與 mis_ohlc 各自獨立請求，任一成功即可回傳；兩者皆失敗時回 502（ok:false），不給假資料。
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
 * 2026-11-25 結算日實測與修正：
 *   - getStockInfo 盤中更新慢且偶爾回空 body，fromMis 改為 Promise.allSettled 各自獨立、並移除 Yahoo 備援（robots.txt 禁用）。
 *   - 取樣改用分時走勢（mis_ohlc）最後一筆，並改為視窗內 Set 去重，不丟掉因負載均衡晚到的真實 5 秒點。
 *   - readSamples 不讀尚未寫完的當前分鐘（hm >= nowHHMM），避開 KV 負快取延遲。
 *
 * 回應：{ ok, src: 'mis', d: 'YYYYMMDD', t: 'HH:MM:SS', z: 最新指數, y: 昨收,
 *        bars: [[HHMMSS, 收盤], …]（12:55 以後的每分鐘，時間標在那一分鐘結束）,
 *        samples: [[HHMMSS, 指數], …]（排程存的證交所揭示值，時間＝證交所揭示時間）, kv: 有沒有綁 KV,
 *        at: 轉接站時間 }
 */

const ALLOW = [/^https:\/\/allenchiwei\.github\.io$/, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/];
const UA = 'Mozilla/5.0 (compatible; TaiwanETF/1.0; +https://allenchiwei.github.io/taiwan-etf/) settle-proxy';
const MIS_NOW = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0';
const MIS_OHLC = 'https://mis.twse.com.tw/stock/data/mis_ohlc_TSE.txt';
const FROM = 125500;
const TTL_MS = 4000;
const FETCH_TIMEOUT_MS = 4000;                   // 單次上游逾時，避免慢端點拖住 Promise.allSettled
const SAMPLE_FIRST = 1259, SAMPLE_LAST = 1330;   // 排程存的分鐘（台北 HHMM）

function cors(origin) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin && ALLOW.some(re => re.test(origin))) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

async function getJson(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const ac = new AbortController();
  let timer;
  const onTimeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`timeout ${timeoutMs}ms ${url.split('?')[0]}`);
      ac.abort(err);
      reject(err);
    }, timeoutMs);
  });
  onTimeout.catch(() => {});
  try {
    const work = (async () => {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' },
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split('?')[0]}`);
      return JSON.parse((await res.text()).trim());   // mis_ohlc 前面有一堆空行
    })();
    work.catch(() => {});
    return await Promise.race([work, onTimeout]);
  } finally {
    clearTimeout(timer);
  }
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
 * 2026-11-25 結算日實測：getStockInfo 的加權指數 13:00～13:30 更新稀疏，
 * mis_ohlc 最後一筆每 5～15 秒前進；因證交所多台後端略不同步，呼叫端改用視窗內去重接收晚到點。
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

const fmtHms = n => {
  const s = String(n).padStart(6, '0');
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4)}`;
};

export async function fromMis() {
  const [nowRes, ohlcRes] = await Promise.allSettled([
    getJson(`${MIS_NOW}&_=${Date.now()}`),
    getJson(`${MIS_OHLC}?_=${Date.now()}`),
  ]);
  const errs = [];
  const errMsg = r => String((r.reason && r.reason.message) || r.reason);

  let nowData = null;
  if (nowRes.status === 'fulfilled') {
    const m = (nowRes.value?.msgArray || [])[0];
    const d = m && /^\d{8}$/.test(String(m.d || '')) ? String(m.d) : null;
    const t = m && typeof m.t === 'string' && m.t.trim() ? m.t.trim() : null;
    const tNum = t ? parseInt(t.replace(/:/g, ''), 10) : NaN;
    const z = m ? num(m.z) : null;
    if (d && t && Number.isFinite(tNum) && z !== null) {
      nowData = { d, t, tNum, z, y: num(m.y) };
    } else {
      errs.push('mis getStockInfo 沒有最新指數');
    }
  } else {
    errs.push(`getStockInfo: ${errMsg(nowRes)}`);
  }

  let ohlcData = null;
  if (ohlcRes.status === 'fulfilled') {
    const ohlc = ohlcRes.value;
    const arr = ohlc?.ohlcArray || [];
    const bars = [];
    for (const b of arr) {
      const ts = parseInt(b.ts, 10), c = num(b.c);
      if (ts >= FROM && c !== null) bars.push([ts, c]);
    }
    const rawD = String(ohlc?.infoArray?.[0]?.d || String(ohlc?.staticObj?.key || '').replace(/^tse_/, ''));
    const d = /^\d{8}$/.test(rawD) ? rawD : null;
    const lastBar = arr[arr.length - 1];
    const tNum = lastBar ? parseInt(lastBar.ts, 10) : NaN;
    const z = (lastBar ? num(lastBar.c) : null) ?? num(ohlc?.lastIndex);
    const y = num(ohlc?.infoArray?.[0]?.y);
    if (Number.isFinite(tNum) && z !== null) {
      ohlcData = { d, t: fmtHms(tNum), tNum, z, y, bars };
    } else if (bars.length) {
      const last = bars[bars.length - 1];
      ohlcData = { d, t: fmtHms(last[0]), tNum: last[0], z: last[1], y, bars };
    } else {
      errs.push('mis_ohlc 沒有最新指數');
    }
  } else {
    errs.push(`mis_ohlc: ${errMsg(ohlcRes)}`);
  }

  // 兩者都成功且各有日期時，以日期較新者為準（不無條件沿用 mis_ohlc 日期）；
  // 同日（或 mis_ohlc 未帶日期而沿用 getStockInfo 日期）才合併 bars 並取時間較新者。
  if (nowData && ohlcData) {
    if (ohlcData.d && nowData.d > ohlcData.d) {
      return { src: 'mis', d: nowData.d, t: nowData.t, z: nowData.z, y: nowData.y, bars: [] };
    }
    if (ohlcData.d && ohlcData.d > nowData.d) {
      return { src: 'mis', d: ohlcData.d, t: ohlcData.t, z: ohlcData.z, y: ohlcData.y, bars: ohlcData.bars };
    }
    const d = ohlcData.d || nowData.d;
    const useNow = nowData.tNum > ohlcData.tNum;
    return {
      src: 'mis',
      d,
      t: useNow ? nowData.t : ohlcData.t,
      z: useNow ? nowData.z : ohlcData.z,
      y: nowData.y ?? ohlcData.y,
      bars: ohlcData.bars,
    };
  }
  if (ohlcData && ohlcData.d) {
    return { src: 'mis', d: ohlcData.d, t: ohlcData.t, z: ohlcData.z, y: ohlcData.y, bars: ohlcData.bars };
  }
  if (nowData) {
    return { src: 'mis', d: nowData.d, t: nowData.t, z: nowData.z, y: nowData.y, bars: [] };
  }
  if (ohlcData && !ohlcData.d) errs.push('mis_ohlc 沒有日期');
  throw new Error(errs.join('; ') || 'mis 沒有資料');
}

// ── ② 每 5 秒取樣：排程寫、網頁請求讀 ──────────────────────────────────────

const sampleKey = (d, hhmm) => `s:${d}:${String(hhmm).padStart(4, '0')}`;

const taipeiHms = ms => {
  const x = new Date(ms + 8 * 3600_000);
  return x.getUTCHours() * 10000 + x.getUTCMinutes() * 100 + x.getUTCSeconds();
};

/**
 * 排程每分鐘一次：從這分鐘開始抓到 :58 秒，跟著證交所每 5 秒的揭示抓（每格過 1.5 秒抓；
 * 沒收到新點就 2 秒後再抓一次），最後整分鐘存一筆。一次最多 30 個請求（免費方案上限 50）。
 * now／sleep／fetchNow 可以換掉，給本機測試用。回傳存了幾筆。
 */
export async function collect(env, scheduledMs, { now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)), fetchNow = ohlcNow } = {}) {
  const start = Math.floor(scheduledMs / 60000) * 60000;
  const end = start + 58_000;
  const [today] = taipei(start);
  // 同一天、落在「本分鐘前 2 分鐘～本分鐘結束」內、還沒收過的點就收（Set 去重，晚到的真實 5 秒點不丟）
  const minT = taipeiHms(start - 120_000);
  const maxT = taipeiHms(start + 60_000);
  const seen = new Set();
  const got = [];
  for (let polls = 0; polls < 30 && now() < end; polls++) {
    let gotNew = false;
    try {
      const m = await fetchNow();
      if (m.d === today && m.t >= minT && m.t <= maxT && !seen.has(m.t)) {
        seen.add(m.t);
        got.push([m.t, m.z]);
        gotNew = true;
      }
    } catch { /* 這一格沒抓到，下一格再抓 */ }
    const t = now();
    const wake = gotNew ? start + Math.ceil((t - start + 1) / 5000) * 5000 + 1500 : t + 2000;
    if (wake >= end) break;
    await sleep(wake - t);
  }
  if (got.length) {
    got.sort((a, b) => a[0] - b[0]);
    await env.SETTLE_KV.put(sampleKey(today, taipei(start)[1]), JSON.stringify(got), { expirationTtl: 8 * 86400 });
  }
  return got.length;
}

const done = new Map();   // 已經寫好的分鐘（寫一次就不會再變）：key → 取樣；同一個執行個體不重複讀 KV

export async function readSamples(env, d, nowMs = Date.now()) {
  if (!env.SETTLE_KV) return [];
  const [today, nowHHMM] = taipei(nowMs);
  const keys = [];
  for (let hm = SAMPLE_FIRST; hm <= SAMPLE_LAST; hm = hm % 100 === 59 ? hm + 41 : hm + 1) {
    // 當前分鐘排程尚未寫完，提早讀會拿到 null 並觸發 KV 負快取延遲約 60 秒
    if (d === today && hm >= nowHHMM) break;
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
  try {
    const live = await fromMis();
    const samples = await readSamples(env, live.d).catch(() => []);
    const body = { ok: true, ...live, samples, kv: !!env.SETTLE_KV, at: new Date().toISOString() };
    return { status: 200, body: JSON.stringify(body) };
  } catch (e) {
    const errors = [String((e && e.message) || e).slice(0, 200)];
    return { status: 502, body: JSON.stringify({ ok: false, errors }) };
  }
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
