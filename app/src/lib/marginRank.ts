import type { StockIndexRow } from './stock.ts';
import type { PeRow } from './cheap.ts';

export interface MarginRankRow {
  code: string;
  name: string;
  market: string;
  industry: string;
  ratio: number;
  turnover: number | null;
  price: number | null;
}

/** 合併部署時產生的維持率、個股索引與成交額；只保留普通上市櫃股票。 */
export function joinMarginRank(
  margin: Record<string, number>, stocks: StockIndexRow[], prices: PeRow[],
): MarginRankRow[] {
  const index = new Map(stocks.map(s => [s.c, s]));
  const pe = new Map(prices.map(s => [s.c, s]));
  const rows: MarginRankRow[] = [];
  for (const [code, ratio] of Object.entries(margin)) {
    if (!Number.isFinite(ratio)) continue;
    const stock = index.get(code);
    if (stock?.i === 'ETF') continue;
    const market = stock?.m || pe.get(code)?.m || '';
    if (market !== '上市' && market !== '上櫃') continue;
    const priced = pe.get(code);
    rows.push({
      code,
      name: stock?.n || priced?.n || code,
      market,
      industry: stock?.i || priced?.i || '未分類',
      ratio,
      turnover: Number.isFinite(priced?.v) ? priced!.v : null,
      price: Number.isFinite(priced?.p) ? priced!.p : null,
    });
  }
  return rows.sort((a, b) => a.ratio - b.ratio || a.code.localeCompare(b.code));
}

export function screenMarginRank(rows: MarginRankRow[], threshold: number, minTurnover: number): MarginRankRow[] {
  return rows.filter(r => r.ratio < threshold && r.turnover !== null && r.turnover >= minTurnover);
}

export function marginIndustryCounts(rows: MarginRankRow[]): Array<{ industry: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.industry, (counts.get(row.industry) ?? 0) + 1);
  return [...counts].map(([industry, count]) => ({ industry, count }))
    .sort((a, b) => b.count - a.count || a.industry.localeCompare(b.industry, 'zh-TW'));
}
