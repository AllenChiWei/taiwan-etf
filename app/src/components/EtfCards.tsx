/* 手機版卡片（<768px）。
   刻意渲染真正的卡片元件，而不是用 CSS 把 <table> 折成 grid ——
   後者要靠 nth-child 定位，欄位順序一改就靜悄悄地錯位。 */

import type { Etf } from '../types';
import { moneydjUrl, returnTone, TONE_CLASS, yieldClass } from '../lib/format';
import { NUMERIC_COLUMNS } from './columns';
import { FreqPill } from './FreqPill';
import { FavButton } from './FavButton';

interface Props {
  rows: Etf[];
  isFav: (code: string) => boolean;
  onToggleFav: (code: string) => void;
  /** 點名稱：跳出前十大持股。沒給就是純文字 */
  onPickName?: (etf: Etf) => void;
}

export function EtfCards({ rows, isFav, onToggleFav, onPickName }: Props) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map(e => (
        <li key={e.code} className="rounded-xl border border-line bg-surface p-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <a href={moneydjUrl(e.code)} target="_blank" rel="noopener noreferrer"
               className="font-mono text-base font-bold text-accent">
              {e.code}
            </a>
            <div className="flex items-center gap-1.5">
              <FreqPill freq={e.freq} />
              <FavButton code={e.code} active={isFav(e.code)} onToggle={onToggleFav} />
            </div>
          </div>

          <p className="mt-0.5 text-[15px] font-semibold text-ink">
            {onPickName
              ? <button type="button" onClick={() => onPickName(e)}
                        className="text-left hover:text-accent hover:underline">
                  {e.name} <span className="text-[11px] font-normal text-accent">前十大 ›</span>
                </button>
              : e.name}
          </p>

          <p className="mt-0.5 truncate text-xs text-muted">
            <span aria-hidden="true">🏦 </span>{e.cust}
          </p>

          <dl className="mt-2.5 grid grid-cols-3 gap-x-2 gap-y-2 border-t border-line pt-2">
            {NUMERIC_COLUMNS.map(c => {
              const value = e[c.key];
              const cls = c.key === 'yield' ? yieldClass(value) : TONE_CLASS[returnTone(value)];
              return (
                <div key={c.key}>
                  <dt className="text-[10px] font-semibold whitespace-nowrap text-faint">{c.label}</dt>
                  <dd className={`tabular font-mono text-sm ${cls}`}>{value}</dd>
                </div>
              );
            })}
          </dl>

          <a href={moneydjUrl(e.code)} target="_blank" rel="noopener noreferrer"
             className="mt-2.5 block rounded-md border border-line py-2 text-center text-[13px]
                        font-semibold text-accent hover:border-accent hover:bg-accent-soft">
            MoneyDJ 詳情
          </a>
        </li>
      ))}
    </ul>
  );
}
