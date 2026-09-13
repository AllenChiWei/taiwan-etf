import { useMemo } from 'react';
import { useEtfData, useFavoritesApi } from '../context/AppContext';
import { useFilterState } from '../hooks/useFilterState';
import { filterEtfs, sortEtfs } from '../lib/filters';
import { FilterBar } from '../components/FilterBar';
import { EtfListing } from '../components/EtfListing';
import { EmptyState } from '../components/EmptyState';

export function FavoritesPage() {
  const data = useEtfData();
  const favorites = useFavoritesApi();
  const { filters, sort, setFilters, setSort, cycleSort, reset } = useFilterState('/favorites');

  const rows = useMemo(
    () => sortEtfs(filterEtfs(data.etfs, filters, favorites.codes), sort),
    [data.etfs, filters, sort, favorites.codes],
  );

  if (favorites.count === 0) {
    return (
      <div className="pt-4">
        <EmptyState
          icon="☆"
          title="還沒有收藏"
          hint="在清單中點任一列的 ☆ 就會加入這裡。收藏只存在這台裝置的瀏覽器，不會上傳。"
        />
      </div>
    );
  }

  return (
    <>
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
            title="收藏中沒有符合的 ETF"
            hint="目前的篩選條件把收藏全部濾掉了。"
          />
        ) : (
          <>
            <p className="mb-3.5 text-[13px] text-muted">
              顯示 <strong className="tabular font-mono text-ink">{rows.length}</strong> / {favorites.count} 檔收藏
            </p>
            <EtfListing
              rows={rows}
              sections={data.sections}
              sort={sort}
              onSort={cycleSort}
              isFav={favorites.has}
              onToggleFav={favorites.toggle}
              flat
              flatTitle="我的收藏"
            />
          </>
        )}
      </div>
    </>
  );
}
