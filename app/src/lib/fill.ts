export interface FillEvent {
  date: string;
  amount: number;
  filled: boolean;
  /** 經過的交易日數；尚未填息時為 null。 */
  days: number | null;
  /** 尚未填息時，最新收盤價距填息基準的百分比。 */
  gapPct: number | null;
}

export interface FillCodeSummary {
  name: string;
  events: FillEvent[];
  /** 近三年單次配息的變異係數（%），少於兩筆時為 null。 */
  payoutCv3y: number | null;
}

export interface FillSummaryData {
  asof: string;
  codes: Record<string, FillCodeSummary>;
}
