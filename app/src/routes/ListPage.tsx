import { useMemo } from 'react';
import { useEtfData, useFavoritesApi } from '../context/AppContext';
import { useFilterState } from '../hooks/useFilterState';
import { filterEtfs, sortEtfs } from '../lib/filters';
import { NUMERIC_LABEL } from '../lib/format';
import { StatCards } from '../components/StatCards';
import { FilterBar } from '../components/FilterBar';
import { EtfListing } from '../components/EtfListing';
import { EmptyState } from '../components/EmptyState';

export function ListPage() {
  const data = useEtfData();
  const favorites = useFavoritesApi();
  const { filters, sort, setFilters, setSort, cycleSort, reset } = useFilterState('/');

  const rows = useMemo(
    () => sortEtfs(filterEtfs(data.etfs, filters), sort),
    [data.etfs, filters, sort],
  );

  return (
    <>
      <div className="pt-4">
        <StatCards
          sections={data.sections}
          total={data.meta.total}
          activeSec={filters.sec}
          onPick={sec => setFilters({ sec })}
        />
      </div>

      <FilterBar
        data={data}
        filters={filters}
        sort={sort}
        onChange={setFilters}
        onSortChange={setSort}
        onReset={reset}
      />

      <div className="pt-4">
        {rows.length === 0 ? (
          <EmptyState
            title="找不到符合的 ETF"
            hint="試試換個關鍵字，或按「清除全部」重設篩選條件。"
          />
        ) : (
          <>
            <p className="mb-3.5 text-[13px] text-muted">
              顯示 <strong className="tabular font-mono text-ink">{rows.length}</strong> / {data.meta.total} 檔
              {sort && `　·　依 ${NUMERIC_LABEL[sort.key]} ${sort.dir === 'asc' ? '低→高' : '高→低'} 排序`}
            </p>

            {/* 排序中就不分區 —— 否則使用者會以為只在單一分類內排序 */}
            <EtfListing
              rows={rows}
              sections={data.sections}
              sort={sort}
              onSort={cycleSort}
              isFav={favorites.has}
              onToggleFav={favorites.toggle}
              flat={Boolean(sort)}
            />
          </>
        )}
      </div>
    </>
  );
}
