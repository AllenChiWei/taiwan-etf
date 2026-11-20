/* 結算價預測的即時指數轉接（Cloudflare Worker，2026-11-21）
 *
 * 為什麼要有它：證交所看盤（mis.twse.com.tw）與 Yahoo 的即時指數都沒有 CORS 標頭，
 * 網頁不能直接讀；證交所每 5 秒指數（MI_5MINS_INDEX）有 CORS，但收盤後才有資料。
 * 這支只做一件事：代抓證交所的加權指數（最新一筆＋當天每分鐘收盤），加上 CORS 回給網站。
 *
 * 不是開放代理：只接受 GET /taiex，上游網址寫死，CORS 只放行本站與本機預覽。
 * 證交所抓不到時退回 Yahoo（^TWII 每分鐘），回應裡 src 會標明來源。
 *
 * 回應：{ ok, src: 'mis'|'yahoo', d: 'YYYYMMDD', t: 'HH:MM:SS', z: 最新指數, y: 昨收,
 *        bars: [[HHMMSS, 收盤], …]（12:55 以後的每分鐘，時間標在那一分鐘結束）, at: 轉接站時間 }
 */

const ALLOW = [/^https:\/\/allenchiwei\.github\.io$/, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/];
const UA = 'Mozilla/5.0 (compatible; settle-proxy)';
const MIS_NOW = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0';
const MIS_OHLC = 'https://mis.twse.com.tw/stock/data/mis_ohlc_TSE.txt';
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1m&range=1d';
const FROM = 125500;

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

export async function fromMis() {
  const [now, ohlc] = await Promise.all([getJson(`${MIS_NOW}&_=${Date.now()}`), getJson(`${MIS_OHLC}?_=${Date.now()}`)]);
  const m = (now.msgArray || [])[0];
  if (!m) throw new Error('mis 沒有 msgArray');
  const z = num(m.z) ?? num(ohlc.lastIndex);
  if (z === null) throw new Error('mis 沒有最新指數');
  const bars = [];
  for (const b of ohlc.ohlcArray || []) {
    const ts = parseInt(b.ts, 10), c = num(b.c);
    if (ts >= FROM && c !== null) bars.push([ts, c]);
  }
  return { src: 'mis', d: m.d, t: m.t, z, y: num(m.y), bars };
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

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors(origin), 'Access-Control-Allow-Methods': 'GET' } });
    }
    if (request.method !== 'GET' || url.pathname !== '/taiex') {
      return new Response(JSON.stringify({ ok: false, error: '只有 GET /taiex' }), { status: 404, headers: cors(origin) });
    }
    const errors = [];
    for (const get of [fromMis, fromYahoo]) {
      try {
        const body = { ok: true, ...(await get()), at: new Date().toISOString() };
        if (errors.length) body.fallback = errors;
        return new Response(JSON.stringify(body), { headers: cors(origin) });
      } catch (e) {
        errors.push(String((e && e.message) || e).slice(0, 200));
      }
    }
    return new Response(JSON.stringify({ ok: false, errors }), { status: 502, headers: cors(origin) });
  },
};
