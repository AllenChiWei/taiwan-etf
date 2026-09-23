/* 依裝置寬度選擇表格或卡片，並負責分區標題與手機版的排序按鈕。
   兩種版面共用同一批已排序的資料，所以順序永遠一致。 */

import type { Etf, NumericKey, Section } from '../types';
import type { SortSpec } from '../lib/filters';
import { groupBySection } from '../lib/filters';
import { useIsMobile } from '../hooks/useMediaQuery';
import { NUMERIC_COLUMNS } from './columns';
import { EtfTable } from './EtfTable';
import { EtfCards } from './EtfCards';

interface Props {
  rows: Etf[];
  sections: Section[];
  sort: SortSpec | null;
  onSort: (key: NumericKey) => void;
  isFav: (code: string) => boolean;
  onToggleFav: (code: string) => void;
  /** true 時不分區，整批當成一組顯示（排序中或收藏頁） */
  flat?: boolean;
  flatTitle?: string;
  /** 點名稱：跳出前十大持股 */
  onPickName?: (etf: Etf) => void;
}

/** 手機上沒有表頭可點，用一排按鈕代替。 */
function SortChips({ sort, onSort }: { sort: SortSpec | null; onSort: (k: NumericKey) => void }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">排序</span>
      {NUMERIC_COLUMNS.map(c => {
        const active = sort?.key === c.key;
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            onClick={() => onSort(c.key)}
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors
              ${active
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-line bg-surface text-accent'}`}
          >
            {c.label}
            <span aria-hidden="true" className="ml-0.5">
              {active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function EtfListing(props: Props) {
  const { rows, sections, sort, onSort, isFav, onToggleFav, flat, flatTitle, onPickName } = props;
  const isMobile = useIsMobile();

  const groups = flat
    ? [{ id: 'all', title: flatTitle ?? '全部結果', count: rows.length, rows }]
    : groupBySection(rows, sections);

  return (
    <>
      {isMobile && <SortChips sort={sort} onSort={onSort} />}

      {groups.map(g => (
        <section key={g.id} id={g.id} className="mb-7 scroll-mt-28">
          <h2 className="mb-2 flex items-baseline gap-2 text-base font-bold text-ink">
            {g.title}
            <span className="tabular font-mono text-[13px] font-semibold text-muted">
              {g.rows.length} 檔
            </span>
          </h2>

          {isMobile
            ? <EtfCards rows={g.rows} isFav={isFav} onToggleFav={onToggleFav} onPickName={onPickName} />
            : <EtfTable rows={g.rows} sort={sort} onSort={onSort} isFav={isFav} onToggleFav={onToggleFav}
                        onPickName={onPickName} />}
        </section>
      ))}
    </>
  );
}
