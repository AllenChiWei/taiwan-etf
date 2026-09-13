import type { FreqLabel } from '../types';
import { freqPillClass } from '../lib/format';

/** 配息頻率標籤。'—' 代表不配息（MoneyDJ 的空白欄位）。 */
export function FreqPill({ freq }: { freq: FreqLabel }) {
  const title = freq === '—' ? '不配息' : `配息頻率：${freq}`;
  return (
    <span
      title={title}
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${freqPillClass(freq)}`}
    >
      {freq}
    </span>
  );
}
