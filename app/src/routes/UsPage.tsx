import { useEffect, useMemo, useRef, useState } from 'react';
import { useFavoritesApi } from '../context/AppContext';
import { useUsDataset } from '../hooks/useUsDataset';
import { useIsMobile } from '../hooks/useMediaQuery';
import { toNumber } from '../lib/filters';
import { EmptyState } from '../components/EmptyState';
import { UsEtfTable, UsEtfCards, UsSortChips, US_COLUMNS, formatAdv } from '../components/UsEtfViews';
import type { UsEtf, UsNumericKey } from '../types';

type Dir = 'asc' | 'desc';

/** N/A 永遠沉底，與台股那邊的規則一致。 */
function sortUs(rows: UsEtf[], key: UsNumericKey | null, dir: Dir): UsEtf[] {
  const out = [...rows];
  if (!key) return out.sort((a, b) => b.adv - a.adv);   // 預設依成交金額
  const sign = dir === 'asc' ? 1 : -1;
  const val = (e: UsEtf) => (key === 'adv' ? e.adv : toNumber(e[key] as string));
  return out.sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x === null && y === null) return a.code.localeCompare(b.code);
    if (x === null) return 1;
    if (y === null) return -1;
    if (x !== y) return (x - y) * sign;
    return a.code.localeCompare(b.code);
  });
}

export function UsPage() {
  const state = useUsDataset();
  const favorites = useFavoritesApi();
  const isMobile = useIsMobile();

  const [q, setQ] = useState('');
  const [draft, setDraft] = useState('');
  const [liquidOnly, setLiquidOnly] = useState(true);
  const [sortKey, setSortKey] = useState<UsNumericKey | null>(null);
  const [sortDir, setSortDir] = useState<Dir>('desc');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(draft), 150);
    return () => clearTimeout(t);
  }, [draft]);

  const all = state.status === 'ready' ? state.data.etfs : [];
  const meta = state.status === 'ready' ? state.data.meta : null;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = all.filter(e =>
      (!liquidOnly || e.liquid) &&
      (!needle || e.code.toLowerCase().includes(needle) || e.name.toLowerCase().includes(needle)));
    return sortUs(filtered, sortKey, sortDir);
  }, [all, q, liquidOnly, sortKey, sortDir]);

  function cycleSort(key: UsNumericKey) {
    if (sortKey !== key) { setSortKey(key); setSortDir('desc'); return; }
    if (sortDir === 'desc') { setSortDir('asc'); return; }
    setSortKey(null); setSortDir('desc');
  }

  if (state.status === 'loading') {
    return <p className="py-16 text-center text-muted">載入美股 ETF 資料中…（約 550 KB，只在這個分頁載入）</p>;
  }
  if (state.status === 'error') {
    return <EmptyState icon="⚠️" title="美股資料載入失敗"
                       hint={`${state.error.message}　請檢查網路連線後重新整理。`} />;
  }

  const selectCls = 'h-10 w-full cursor-pointer rounded-lg border border-line bg-surface '
                  + 'px-2.5 text-[15px] text-ink focus:border-accent focus:outline-none';
  const labelCls = 'text-[11.5px] font-semibold text-muted';

  return (
    <>
      <div className="pt-4">
        <div className="rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-muted">
          <p>
            共 <strong className="tabular font-mono text-ink">{meta!.total}</strong> 檔美股 ETF，
            其中 <strong className="tabular font-mono text-ink">{meta!.liquid}</strong> 檔日均成交額達
            <span className="tabular font-mono"> {formatAdv(meta!.liquidMinAdv)}</span> 以上。
            價格資料截至 {meta!.asof}。
          </p>
          <p className="mt-1">
            報酬率為<strong className="text-up">價格報酬，不含配息</strong>、累積非年化。
            我們能合法取得的來源沒有提供含息的總報酬，所以這裡照實標示。
          </p>
          <p className="mt-1">
            這對高配息的標的影響很大：QYLD 近5年的<em>價格</em>跌 12.66%，
            但把每年約 12% 的配息計入後，總報酬其實是正的（MoneyDJ 記為 +47.61%）。
            看這類 ETF 時請務必另外查總報酬。指數型 ETF 配息少，兩者差距有限。
          </p>
        </div>
      </div>

      <div className="-mx-3 mt-4 border-b border-line bg-bg px-3 py-2.5 sm:-mx-4 sm:px-4 md:sticky md:top-0 md:z-20">
        <div className="relative">
          <span aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm opacity-60">🔍</span>
          <input
            ref={searchRef}
            type="search"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="搜尋代號或名稱…"
            aria-label="搜尋美股 ETF"
            autoComplete="off"
            className="h-11 w-full rounded-lg border border-line bg-surface pr-9 pl-9 text-base
                       text-ink focus:border-accent focus:ring-3 focus:ring-accent-soft focus:outline-none
                       [&::-webkit-search-cancel-button]:hidden"
          />
          {draft && (
            <button type="button" aria-label="清除搜尋"
                    onClick={() => { setDraft(''); searchRef.current?.focus(); }}
                    className="absolute top-1/2 right-1.5 grid h-7 w-7 -translate-y-1/2 place-items-center
                               rounded-full text-xs text-muted hover:bg-hover hover:text-ink">✕</button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2.5 pt-2.5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="us-liquid">顯示範圍</label>
            <select id="us-liquid" className={selectCls} value={liquidOnly ? 'liquid' : 'all'}
                    onChange={e => setLiquidOnly(e.target.value === 'liquid')}>
              <option value="liquid">有流動性（{meta!.liquid} 檔）</option>
              <option value="all">全部（{meta!.total} 檔）</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="us-sort">排序</label>
            <select id="us-sort" className={selectCls}
                    value={sortKey ? `${sortKey}-${sortDir}` : ''}
                    onChange={e => {
                      const v = e.target.value;
                      if (!v) { setSortKey(null); setSortDir('desc'); return; }
                      const [k, d] = v.split('-') as [UsNumericKey, Dir];
                      setSortKey(k); setSortDir(d);
                    }}>
              <option value="">預設（依成交金額）</option>
              {US_COLUMNS.filter(c => c.key !== 'adv').map(c => (
                <option key={c.key} value={`${c.key}-desc`}>{c.label} 高→低</option>
              ))}
              <option value="r12-asc">近1年 低→高</option>
            </select>
          </div>

          <button type="button"
                  onClick={() => { setDraft(''); setLiquidOnly(true); setSortKey(null); setSortDir('desc'); }}
                  disabled={!draft && liquidOnly && !sortKey}
                  className="h-10 rounded-lg border border-line px-4 text-sm font-semibold text-muted
                             transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-40
                             disabled:hover:bg-transparent sm:col-span-2 lg:col-span-1">
            清除
          </button>
        </div>
      </div>

      <div className="pt-4">
        {rows.length === 0 ? (
          <EmptyState title="找不到符合的 ETF"
                      hint="試試換個關鍵字，或把「顯示範圍」切成全部。" />
        ) : (
          <>
            <p className="mb-3.5 text-[13px] text-muted">
              顯示 <strong className="tabular font-mono text-ink">{rows.length}</strong> 檔
            </p>
            {isMobile && <UsSortChips sortKey={sortKey} sortDir={sortDir} onSort={cycleSort} />}
            {isMobile
              ? <UsEtfCards rows={rows} isFav={favorites.has} onToggleFav={favorites.toggle} />
              : <UsEtfTable rows={rows} sortKey={sortKey} sortDir={sortDir} onSort={cycleSort}
                            isFav={favorites.has} onToggleFav={favorites.toggle} />}
          </>
        )}
      </div>
    </>
  );
}
