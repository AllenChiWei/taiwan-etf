/* ETF 前十大持股。純函式，沒有 React。
 *
 * 兩個來源，新的優先：
 *   1. active_holdings.json —— 站主指定的六檔主動式 ETF，各投信每日公告的完整持股
 *   2. top10.json —— 投信投顧公會「基金投資明細－月前十大」，所有 ETF，月報
 *
 * 槓桿／反向、期貨、不動產與平衡型的 ETF 公會沒有前十大（它們主要持有期貨、
 * 現金或受益憑證），查不到時畫面要說原因，不要只顯示空白。
 */

import type { ActiveData } from './active.ts';
import {
  lookupFullHoldings,
  type FullHoldingBasis,
  type FullHoldingsData,
  type QtyDenom,
} from './fullHoldings.ts';

/** [名次, 標的種類, 代號（債券是 ISIN）, 名稱, 佔淨值%] */
export type Top10Row = [number, string, string, string, number | null];

export interface Top10Data {
  meta: { ym: string; updated: string; source: string; unmatched?: string[] };
  etfs: Record<string, { name: string; rows: Top10Row[] }>;
}

export interface Top10View {
  /** 'daily' = 主動式每日公告；'pcf' = 被動式投信申購買回清單；'quarterly' = 公會季報；'monthly' = 公會月報 */
  kind: 'daily' | 'pcf' | 'quarterly' | 'monthly';
  /** 資料日期：每日／清單為交易日 YYYY-MM-DD，季報為 YYYYQ#，月報為 YYYY/MM */
  asof: string;
  /** 全部成分股檔數（每日／申購清單／季報才有） */
  totalCount?: number;
  src?: string;
  basis?: FullHoldingBasis;
  denom?: QtyDenom;
  rows: { rank: number; code: string; name: string; pct: number | null; type: string }[];
  /** 前十大佔淨值合計 */
  total: number | null;
}

/**
 * 雙幣別或分級的交易代號（00625K、00687C、00980T 之類）跟本尊是同一檔基金，
 * 公會只登記一個代號。查不到時退回去掉最後一個英文字母的代號。
 */
export function lookupMonthly(data: Top10Data, code: string) {
  return data.etfs[code] ?? (/[A-Z]$/.test(code) ? data.etfs[code.slice(0, -1)] : undefined);
}

export function top10For(
  code: string,
  monthly: Top10Data | null,
  active: ActiveData | null,
  full: FullHoldingsData | null = null,
): Top10View | null {
  const daily = active?.etfs[code];
  if (daily && daily.holdings.length) {
    const rows = [...daily.holdings].sort((a, b) => b[3] - a[3]).slice(0, 10)
      .map(([c, n, , w], i) => ({ rank: i + 1, code: c, name: n, pct: w, type: '' }));
    return { kind: 'daily', asof: daily.asof, totalCount: daily.holdings.length, rows, total: sum(rows.map(r => r.pct)) };
  }
  const f = full ? lookupFullHoldings(full, code) : undefined;
  if (f && f.basis !== 'quarterly1pct' && f.holdings.length) {
    const rows = [...f.holdings].sort((a, b) => b[3] - a[3]).slice(0, 10)
      .map((r, i) => ({ rank: i + 1, code: r[0], name: r[1], pct: r[3], type: r[4] ?? '' }));
    return {
      kind: 'pcf',
      asof: f.asof,
      totalCount: f.holdings.length,
      src: f.src,
      basis: f.basis,
      ...(f.denom ? { denom: f.denom } : {}),
      rows,
      total: sum(rows.map(r => r.pct)),
    };
  }
  const m = monthly ? lookupMonthly(monthly, code) : undefined;
  if (m && m.rows.length) {
    const rows = m.rows.map(([rank, type, c, n, pct]) => ({ rank, code: c, name: n, pct, type }));
    const ym = monthly!.meta.ym;
    return { kind: 'monthly', asof: `${ym.slice(0, 4)}/${ym.slice(4)}`, rows, total: sum(rows.map(r => r.pct)) };
  }
  if (f && f.basis === 'quarterly1pct' && f.holdings.length) {
    const rows = [...f.holdings].sort((a, b) => b[3] - a[3]).slice(0, 10)
      .map((r, i) => ({ rank: i + 1, code: r[0], name: r[1], pct: r[3], type: r[4] ?? '' }));
    return {
      kind: 'quarterly',
      asof: f.asof,
      totalCount: f.holdings.length,
      src: f.src,
      basis: f.basis,
      rows,
      total: sum(rows.map(r => r.pct)),
    };
  }
  return null;
}

function sum(xs: (number | null)[]): number | null {
  const nums = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

/** 查不到前十大時的說明：依分區猜原因，而不是只說「沒有資料」。 */
export function missingReason(section: string): string {
  if (section === 'cat-leveraged' || section === 'cat-futures' || section === 'cat-leveraged-futures') {
    return '槓桿／反向與期貨 ETF 主要持有期貨與現金，投信投顧公會的月前十大沒有收錄。';
  }
  return '投信投顧公會的月前十大查不到這一檔（不動產、平衡型，或上個月底之後才成立的新 ETF）。';
}
