/* 桌機版表格（≥768px）。排序狀態來自網址，不在元件內部。 */

import type { Etf, NumericKey } from '../types';
import type { SortSpec } from '../lib/filters';
import { moneydjUrl, returnTone, TONE_CLASS, yieldClass, YIELD_EST_HINT } from '../lib/format';
import { NUMERIC_COLUMNS } from './columns';
import { FreqPill } from './FreqPill';
import { FavButton } from './FavButton';

interface Props {
  rows: Etf[];
  sort: SortSpec | null;
  onSort: (key: NumericKey) => void;
  isFav: (code: string) => boolean;
  onToggleFav: (code: string) => void;
}

export function EtfTable({ rows, sort, onSort, isFav, onToggleFav }: Props) {
  const th = 'sticky top-0 z-10 whitespace-nowrap border-b border-line bg-sunken '
           + 'px-2.5 py-2.5 text-left text-xs font-bold text-muted';
  const td = 'border-b border-line px-2.5 py-2.5 align-middle';

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={`${th} w-10`} />
            <th className={th}>代號</th>
            <th className={th}>名稱</th>
            <th className={th}>保管銀行</th>
            <th className={th}>配息</th>
            {NUMERIC_COLUMNS.map(c => {
              const active = sort?.key === c.key;
              const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={`${th} cursor-pointer text-right select-none hover:text-accent
                              ${active ? 'text-accent' : ''}`}
                  tabIndex={0}
                  onClick={() => onSort(c.key)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(c.key); }
                  }}
                  title="點擊排序，再點一次反向，第三次還原"
                >
                  {c.label}
                  <span aria-hidden="true" className={active ? 'ml-1' : 'ml-1 opacity-35'}>
                    {active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </th>
              );
            })}
            <th className={th}>詳情</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(e => (
            <tr key={e.code} className="last:[&>td]:border-b-0 hover:bg-hover">
              <td className={td}>
                <FavButton code={e.code} active={isFav(e.code)} onToggle={onToggleFav} />
              </td>
              <td className={td}>
                <a href={moneydjUrl(e.code)} target="_blank" rel="noopener noreferrer"
                   className="font-mono font-bold text-accent hover:underline">
                  {e.code}
                </a>
              </td>
              <td className={`${td} font-medium`}>{e.name}</td>
              <td className={`${td} text-muted`}>{e.cust}</td>
              <td className={td}><FreqPill freq={e.freq} /></td>

              {/* 直接迭代欄位定義，表頭與內容就不可能對不上 */}
              {NUMERIC_COLUMNS.map(c => (
                <td
                  key={c.key}
                  className={`${td} tabular text-right font-mono ${
                    c.key === 'yield' ? yieldClass(e[c.key]) : TONE_CLASS[returnTone(e[c.key])]}`}
                >
                  {e[c.key]}
                  {c.key === 'yield' && e.yest && (
                    <sup className="ml-px text-faint" title={YIELD_EST_HINT}>*</sup>
                  )}
                </td>
              ))}

              <td className={td}>
                <a href={moneydjUrl(e.code)} target="_blank" rel="noopener noreferrer"
                   className="inline-block rounded-md border border-line px-2.5 py-1 text-xs font-semibold
                              whitespace-nowrap text-accent hover:border-accent hover:bg-accent-soft">
                  MoneyDJ
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
