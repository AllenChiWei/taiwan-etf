/* 市場總覽（#/market，2026-11-21 站主：「市場中再獨立一個總結頁，簡潔說明市場（籌碼）狀況，快速知道現在該注意什麼」）。
 * 每個指標一行：數值＋燈號（0 正常／1 注意／2 警戒）＋一句白話。純函式，沒有 React。
 *
 * 燈號原則：
 *   - 有長歷史的（維持率、漲跌家數、站上均線、正逆價差、融資餘額）用「歷史百分位」或籌碼頁同一套門檻，數字才對得上；
 *   - 只有幾個月的（臺指 VIX、外資／散戶、P/C）用絕對門檻或近幾個月的相對位置，並在文字裡講清楚；
 *   - 只標「現在少見、要多看一眼」的狀態，不做買賣建議。
 */

import {
  MAINT_T, distView, maintLevel, maintSeries, retailRatioSeries, txEquivalent, type ChipsData,
} from './chips.ts';
import { knownExdivPoints, type ExdivPointsData } from './exdivPts.ts';

export type Level = 0 | 1 | 2;
export const LEVEL_LABEL = ['正常', '注意', '警戒'] as const;

export interface MarketItem {
  key: string;
  group: '信用交易' | '波動與選擇權' | '期貨籌碼' | '市場廣度';
  label: string;
  /** 主要數字（已格式化） */
  value: string;
  /** 小字：變化或補充 */
  sub?: string;
  level: Level;
  /** 一句白話 */
  text: string;
  /** 詳細在哪一頁 */
  to: '/chips' | '/nextday' | '/settle';
}

/** 隔日漲跌（nextday.json）用到的欄位 */
export interface NextdayLite {
  meta: { date: string; close: number; next: string; sigma: number; sigmaE?: number; sigmaIv?: number | null };
  bands: Array<{ p: number; up: number; dn: number }>;
}

/** values 裡 ≤ x 的比例（0～1）；空陣列回 NaN */
export function pctRank(values: number[], x: number): number {
  const v = values.filter(Number.isFinite);
  if (!v.length) return NaN;
  return v.filter(y => y <= x).length / v.length;
}

const f0 = (v: number) => Math.round(v).toLocaleString('zh-TW');
const f1 = (v: number) => v.toFixed(1);
const sg = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;

/** 最後一個有值的位置 */
function lastIdx(a: (number | null)[]): number {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null && Number.isFinite(a[i] as number)) return i;
  return -1;
}

export function marketItems(c: ChipsData, nd?: NextdayLite | null, exdiv?: ExdivPointsData | null): MarketItem[] {
  const out: MarketItem[] = [];
  const m = c.margin;

  // ── 信用交易 ──
  const ks = maintSeries(m);
  if (ks.rows.length) {
    const [d, v] = ks.rows[ks.rows.length - 1];
    const prev = ks.rows.length > 1 ? ks.rows[ks.rows.length - 2][1] : null;
    const lv = maintLevel(v);
    const txt = ['165% 以上，波動正常', `${MAINT_T.accel}～${MAINT_T.calm}%：跌起來開始變兇`,
      `${MAINT_T.sell}～${MAINT_T.accel}%：最容易連續殺盤（斷頭賣壓）`, `${MAINT_T.sell}% 以下：斷頭區，歷史上多半接近底部、但波動極大`][lv];
    out.push({ key: 'maint', group: '信用交易', label: '大盤融資維持率', value: `${f1(v)}%`,
      sub: `${prev !== null ? sg(v - prev) + ' 點・' : ''}${ks.official.has(d) ? '證交所' : '推估'}`,
      level: lv >= 2 ? 2 : lv === 1 ? 1 : 0, text: txt, to: '/chips' });
  }
  const dv = m?.distHist ? distView(m.distHist, 130) : null;
  if (dv) {
    const r = dv.last.rank;
    out.push({ key: 'dist130', group: '信用交易', label: '維持率 < 130% 的股票', value: `${f0(dv.last.count)} 檔`,
      sub: `占融資股 ${f1(dv.last.pct)}%・比 ${f0(r)}% 的歷史日子多`,
      level: r >= 90 ? 2 : r >= 75 ? 1 : 0,
      text: r >= 90 ? '個股斷頭壓力在歷史前 10%' : r >= 75 ? '個股斷頭壓力偏高' : '個股斷頭壓力不大', to: '/chips' });
  }
  if (m && m.money.length >= 6) {
    const i = m.money.length - 1;
    const d1 = (m.money[i] / m.money[i - 1] - 1) * 100;
    const d5 = (m.money[i] / m.money[i - 5] - 1) * 100;
    out.push({ key: 'money', group: '信用交易', label: '融資餘額', value: `${f0(m.money[i] / 1e8)} 億`,
      sub: `一天 ${sg(d1)}%・五天 ${sg(d5)}%`,
      level: d1 <= -3 ? 2 : d1 <= -1.5 || d5 <= -5 ? 1 : 0,
      text: d1 <= -3 ? '融資一天大減，斷頭／停損賣壓正在出清' : d1 <= -1.5 || d5 <= -5 ? '融資在減，槓桿在退' : '融資變化不大', to: '/chips' });
  }
  const sbl = m?.sblHist;
  if (sbl && sbl.length >= 6) {
    const i = sbl.length - 1;
    const d5 = (sbl[i][1] / sbl[i - 5][1] - 1) * 100;
    out.push({ key: 'sbl', group: '信用交易', label: '借券賣出餘額', value: `${f0(sbl[i][1] / 1e4)} 萬張`,
      sub: `五天 ${sg(d5)}%`, level: d5 >= 5 ? 1 : 0,
      text: d5 >= 5 ? '借券放空五天增加超過 5%，空方在加碼' : '借券放空沒有明顯增加', to: '/chips' });
  }

  // ── 波動與選擇權 ──
  const vix = c.tw?.vix ?? [];
  if (vix.length) {
    const [, v] = vix[vix.length - 1];
    const p = vix.length > 1 ? vix[vix.length - 2][1] : null;
    out.push({ key: 'twvix', group: '波動與選擇權', label: '臺指 VIX（恐慌指數）', value: f1(v),
      sub: p !== null ? `一天 ${sg(v - p)}` : undefined,
      level: v >= 35 ? 2 : v >= 25 ? 1 : 0,
      text: v >= 35 ? '選擇權報價很貴＝市場恐慌，隔日大波動機率高' : v >= 25 ? '波動偏高' : '波動正常（15～25 是平常）', to: '/nextday' });
  }
  if (nd) {
    const b95 = nd.bands.find(b => b.p === 0.95);
    if (b95) {
      const lo = nd.meta.close * (1 + b95.dn), hi = nd.meta.close * (1 + b95.up);
      const w = Math.max(b95.up, -b95.dn) * 100;
      out.push({ key: 'nextday', group: '波動與選擇權', label: `明天（${nd.meta.next.slice(5).replace('-', '/')}）95% 區間`,
        value: `${f0(lo)}～${f0(hi)}`, sub: `${sg(b95.dn * 100)}%／${sg(b95.up * 100)}%・日波動 ${(nd.meta.sigma * 100).toFixed(2)}%`,
        level: w >= 5 ? 2 : w >= 3 ? 1 : 0,
        text: w >= 5 ? 'sell put／call 要抓在這個區間外，而且留餘裕' : w >= 3 ? '區間比平常寬，賣方履約價往外抓' : '區間正常', to: '/nextday' });
    }
  }
  const pcA = c.pc.oiAdj && lastIdx(c.pc.oiAdj) >= 0 ? c.pc.oiAdj : c.pc.oi;
  const pi = lastIdx(pcA);
  if (pi >= 0) {
    const v = pcA[pi] as number;
    const r = pctRank(pcA.filter((x): x is number => x !== null), v);
    out.push({ key: 'pc', group: '波動與選擇權', label: 'P/C 未平倉比', value: `${f1(v)}%`,
      sub: `近 ${pcA.length} 天第 ${f0(r * 100)} 百分位${c.pc.oiAdj ? '・已扣投信賣買權' : ''}`,
      level: r <= 0.1 ? 1 : 0,
      text: r <= 0.1 ? '賣權相對買權少（下檔支撐薄），近幾個月最低一段' : '正常範圍', to: '/chips' });
  }

  // ── 期貨籌碼 ──
  const fx = txEquivalent(c.futHistory, '外資');
  const fi = lastIdx(fx);
  if (fi >= 5) {
    const v = fx[fi] as number, d5 = v - (fx[fi - 5] ?? v);
    const r = pctRank(fx.filter((x): x is number => x !== null), v);
    out.push({ key: 'foreign', group: '期貨籌碼', label: '外資台指期淨口數', value: `${v >= 0 ? '+' : '−'}${f0(Math.abs(v))} 口`,
      sub: `五天 ${d5 >= 0 ? '+' : '−'}${f0(Math.abs(d5))}・大台約當・近 ${fx.length} 天第 ${f0(r * 100)} 百分位`,
      level: v < 0 && r <= 0.1 ? 2 : v < 0 && d5 < 0 ? 1 : 0,
      text: v < 0 && r <= 0.1 ? '外資空單在近幾個月最重的一段' : v < 0 && d5 < 0 ? '外資淨空、還在加空' : v < 0 ? '外資淨空，但沒有再加' : '外資淨多', to: '/chips' });
  }
  const rr = retailRatioSeries(c.futHistory, '小型臺指期貨');
  const ri = lastIdx(rr);
  if (ri >= 0) {
    const v = rr[ri] as number;
    const r = pctRank(rr.filter((x): x is number => x !== null), v);
    out.push({ key: 'retail', group: '期貨籌碼', label: '小台散戶多空比', value: `${sg(v)}%`,
      sub: `近 ${rr.length} 天第 ${f0(r * 100)} 百分位`,
      level: r >= 0.9 ? 1 : 0,
      text: r >= 0.9 ? '散戶偏多到近幾個月最高（反向指標：容易再跌）' : r <= 0.1 ? '散戶偏空到近幾個月最低（反向指標：容易反彈）' : '散戶多空正常', to: '/chips' });
  }
  const bs = c.tw?.basis ?? [];
  if (bs.length > 60) {
    const last = bs[bs.length - 1];
    const exdivPoints = knownExdivPoints(exdiv, last[0]) ?? 0;
    const pts = bs.map(r => (r[1] - r[2]) / r[2] * 100);
    const v = pts[pts.length - 1];
    const r = pctRank(pts, v);
    const spread = last[1] - last[2];
    out.push({ key: 'basis', group: '期貨籌碼', label: '期貨正逆價差', value: `${sg(spread, 0)} 點`,
      sub: `${sg(v, 2)}%・2021 起第 ${f0(r * 100)} 百分位${exdivPoints > 0 ? `・扣除已知除息後約 ${sg(spread + exdivPoints, 0)} 點（${exdiv?.meta.date} 資料；已公告上市公司下限）` : ''}`,
      level: r <= 0.05 ? 2 : r <= 0.15 ? 1 : 0,
      text: r <= 0.05 ? '深度逆價差：期貨比現貨悲觀很多（7～8 月除息季除外）' : r <= 0.15 ? '逆價差偏大，期貨偏悲觀' : '正常', to: '/chips' });
  }

  // ── 市場廣度 ──
  const br = c.tw?.breadth ?? [];
  if (br.length) {
    const [, up, dn] = br[br.length - 1];
    const s = up + dn > 0 ? dn / (up + dn) : 0;
    out.push({ key: 'breadth', group: '市場廣度', label: '上市漲跌家數', value: `漲 ${f0(up)}／跌 ${f0(dn)}`,
      sub: `下跌占 ${f0(s * 100)}%`, level: s >= 0.9 ? 2 : s >= 0.75 ? 1 : 0,
      text: s >= 0.9 ? '全面殺盤（九成以上下跌）' : s >= 0.75 ? '多數下跌' : s <= 0.25 ? '多數上漲' : '漲跌參半', to: '/chips' });
  }
  const mb = c.tw?.maBreadth ?? [];
  if (mb.length) {
    const v = mb[mb.length - 1][1];
    out.push({ key: 'ma20', group: '市場廣度', label: '站上 20 日線的股票', value: `${f1(v)}%`,
      sub: `站上 60 日線 ${f1(mb[mb.length - 1][2])}%`,
      level: v <= 15 || v >= 85 ? 1 : 0,
      text: v <= 15 ? '極度超賣（歷史上少見，常在急跌尾聲，但不保證見底）' : v >= 85 ? '極度過熱' : '正常', to: '/chips' });
  }
  const us = c.us;
  const ui = us?.vix ? lastIdx(us.vix) : -1;
  if (us && ui >= 0) {
    const v = us.vix[ui] as number;
    out.push({ key: 'usvix', group: '市場廣度', label: '美股 VIX', value: f1(v),
      level: v >= 30 ? 2 : v >= 20 ? 1 : 0,
      text: v >= 30 ? '美股恐慌' : v >= 20 ? '美股波動偏高' : '美股平靜', to: '/chips' });
  }
  return out;
}

/** 一句總結：幾項警戒、幾項注意，列出警戒的名稱 */
export function headline(items: MarketItem[]): { warn: MarketItem[]; watch: MarketItem[]; text: string } {
  const warn = items.filter(i => i.level === 2), watch = items.filter(i => i.level === 1);
  const text = warn.length >= 4 ? '多項指標同時警戒：市場處在恐慌／斷頭賣壓階段，波動極大'
    : warn.length >= 2 ? '有幾項警戒：風險偏高，部位與賣方履約價要保守'
      : warn.length === 1 ? '一項警戒，其他大致正常'
        : watch.length ? '沒有警戒，有幾項值得留意' : '各項指標都在正常範圍';
  return { warn, watch, text };
}
