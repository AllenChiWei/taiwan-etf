import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEtfData, useFavoritesApi } from '../context/AppContext';
import { useFilterState } from '../hooks/useFilterState';
import { filterEtfs, sortEtfs } from '../lib/filters';
import { NUMERIC_LABEL } from '../lib/format';
import { StatCards } from '../components/StatCards';
import { FilterBar } from '../components/FilterBar';
import { EtfListing } from '../components/EtfListing';
import { EmptyState } from '../components/EmptyState';
import type { Etf } from '../types';

// 兩個附加分頁各自抓自己的資料，沒點進去的人不必下載那段程式
const ActiveHoldings = lazy(() => import('../components/ActiveHoldings')
  .then(m => ({ default: m.ActiveHoldings })));
const Top10Modal = lazy(() => import('../components/Top10Modal')
  .then(m => ({ default: m.Top10Modal })));
const UpcomingEtfs = lazy(() => import('../components/UpcomingEtfs')
  .then(m => ({ default: m.UpcomingEtfs })));

const VIEWS = [
  { id: '', label: 'ETF 清單' },
  { id: 'active', label: '主動式換股' },
  { id: 'upcoming', label: '即將上市' },
] as const;

/** 台股頁的分頁切換。狀態放在網址（?view=），跟其他篩選一樣可以分享、上一頁回得去。 */
function ViewTabs({ view }: { view: string }) {
  const navigate = useNavigate({ from: '/' });
  return (
    <div role="tablist" aria-label="台股頁分頁" className="flex flex-wrap gap-1.5 pt-4">
      {VIEWS.map(v => (
        <button key={v.id} type="button" role="tab" aria-selected={view === v.id}
                onClick={() => void navigate({ search: prev => ({ ...prev, view: v.id }), replace: true, resetScroll: false })}
                className={`h-9 rounded-lg px-3.5 text-[13px] font-semibold transition-colors ${
                  view === v.id ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}>
          {v.label}
        </button>
      ))}
    </div>
  );
}

export function ListPage() {
  const { view } = useSearch({ from: '/' });
  if (view === 'active' || view === 'upcoming') {
    return (
      <>
        <ViewTabs view={view} />
        <Suspense fallback={<p className="py-10 text-center text-[13px] text-muted">載入中…</p>}>
          {view === 'active' ? <ActiveHoldings /> : <UpcomingEtfs />}
        </Suspense>
      </>
    );
  }
  return <EtfList />;
}

function EtfList() {
  const data = useEtfData();
  // 點名稱跳出前十大持股
  const [picked, setPicked] = useState<Etf | null>(null);
  const closePicked = useCallback(() => setPicked(null), []);
  const favorites = useFavoritesApi();
  const { filters, sort, setFilters, setSort, cycleSort, reset } = useFilterState('/');

  const rows = useMemo(
    () => sortEtfs(filterEtfs(data.etfs, filters), sort),
    [data.etfs, filters, sort],
  );

  return (
    <>
      <ViewTabs view="" />
      <div className="pt-4">
        <StatCards
          sections={data.sections}
          etfs={data.etfs}
          total={data.meta.total}
          activeSec={filters.sec}
          activeAct={filters.act}
          onPickSec={sec => setFilters({ sec })}
          onPickAct={act => setFilters({ act })}
          onClearAll={() => setFilters({ sec: '', act: '' })}
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
              onPickName={setPicked}
            />
          </>
        )}
      </div>

      {picked && (
        <Suspense fallback={null}>
          <Top10Modal etf={picked} onClose={closePicked} />
        </Suspense>
      )}
    </>
  );
}
