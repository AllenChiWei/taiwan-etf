/* 元大期貨實盤權益（D:\ai\DashBoard_AI\equity_export.py 產生，與 v18 同密碼、同 salt）。
 * 損益在匯出端已扣掉出入金；這裡只做彙總統計。純函式（保險箱載入在 MePage，測試才不用碰 import.meta.env）。 */

export interface EquityRow {
  d: string;
  tv: number;      // 權益總值
  flow: number;    // 當日出入金（入金正、出金負）
  pnl: number;     // 當日損益（已扣出入金）
  cum: number;     // 累計損益
  dd: number;      // 累計損益距高點（≤ 0）
  twr: number;     // 時間加權累計報酬
  upl: number; cpl: number; fee: number;
  margin: number; risk: number; oi: number; taiex: number;
}
export interface EquityData { generated: string; asof: string; rows: EquityRow[] }

export interface EquityStats {
  days: number; cum: number; twr: number; mdd: number; dd: number;
  winDays: number; best: number; worst: number; month: number; netOverMdd: number | null;
}

export function equityStats(rows: EquityRow[]): EquityStats | null {
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  const traded = rows.slice(1);                       // 第一天沒有前一天，不算損益
  const ym = last.d.slice(0, 7);
  const mdd = Math.min(0, ...rows.map(r => r.dd));
  return {
    days: traded.length,
    cum: last.cum,
    twr: last.twr,
    mdd,
    dd: last.dd,
    winDays: traded.filter(r => r.pnl > 0).length,
    best: Math.max(0, ...traded.map(r => r.pnl)),
    worst: Math.min(0, ...traded.map(r => r.pnl)),
    month: traded.filter(r => r.d.startsWith(ym)).reduce((a, r) => a + r.pnl, 0),
    netOverMdd: mdd < 0 ? last.cum / -mdd : null,
  };
}
