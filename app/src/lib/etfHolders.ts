/* ETF 受益人數（集保股權分散表，每週累積，scripts/fetch_etf_holders.py）。純函式，沒有 React。
 *
 * 張數＝流通的受益權單位 ÷ 1000，週變化就是淨申購／贖回。
 * 第一週只有一個點，變化要等資料累積（集保只給最新一週，沒有歷史可補）。
 */

export interface EtfHoldersData {
  meta: { source: string; asof: string; weeks: number };
  dates: string[];
  /** 和 dates 對齊：[受益人數, 張數]，那週沒有資料是 null */
  etfs: Record<string, ([number, number] | null)[]>;
}

export interface HoldersView {
  asof: string;
  holders: number;
  lots: number;
  /** 和前一週、4 週前比（人數、張數）；沒有那一週就是 null */
  w1: { holders: number; lots: number } | null;
  w4: { holders: number; lots: number } | null;
  /** 有資料的週：[日期, 人數] */
  series: [string, number][];
}

function diffAt(row: ([number, number] | null)[], last: number, back: number) {
  const prev = last - back >= 0 ? row[last - back] : null;
  const cur = row[last];
  return prev && cur ? { holders: cur[0] - prev[0], lots: cur[1] - prev[1] } : null;
}

export function holdersFor(code: string, d: EtfHoldersData | null | undefined): HoldersView | null {
  const row = d?.etfs[code];
  if (!d || !row) return null;
  let last = row.length - 1;
  while (last >= 0 && !row[last]) last--;
  if (last < 0) return null;
  const [holders, lots] = row[last]!;
  return {
    asof: d.dates[last],
    holders,
    lots,
    w1: diffAt(row, last, 1),
    w4: diffAt(row, last, 4),
    series: row.flatMap((v, i) => (v ? [[d.dates[i], v[0]] as [string, number]] : [])),
  };
}
