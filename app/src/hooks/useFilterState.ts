/* 篩選狀態存在網址上。這個 hook 把讀寫都包起來，
   分頁元件只看到 filters / sort 與兩個更新函式。 */

import { useCallback, useMemo } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { Filters, NumericKey } from '../types';
import type { SortSpec } from '../lib/filters';

const SORTABLE: NumericKey[] = ['yield', 'r3', 'r6', 'r12', 'r36', 'r60'];

function parseSort(raw: string): SortSpec | null {
  const [key, dir] = raw.split('-');
  if (!SORTABLE.includes(key as NumericKey)) return null;
  return { key: key as NumericKey, dir: dir === 'asc' ? 'asc' : 'desc' };
}

export function useFilterState(from: '/' | '/favorites') {
  const search = useSearch({ from });
  const navigate = useNavigate({ from });

  const filters: Filters = useMemo(
    () => ({ q: search.q, cust: search.cust, freq: search.freq,
             sec: search.sec, act: search.act }),
    [search.q, search.cust, search.freq, search.sec, search.act],
  );

  const sort = useMemo(() => parseSort(search.sort), [search.sort]);

  const patch = useCallback(
    (next: Partial<Filters & { sort: string }>) => {
      // replace: 打字時每個字都推一筆歷史紀錄會讓「上一頁」變得沒用
      void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
    },
    [navigate],
  );

  const setFilters = useCallback((p: Partial<Filters>) => patch(p), [patch]);

  const setSort = useCallback(
    (s: SortSpec | null) => patch({ sort: s ? `${s.key}-${s.dir}` : '' }),
    [patch],
  );

  /** 點同一欄：高→低 → 低→高 → 還原代號順序。 */
  const cycleSort = useCallback(
    (key: NumericKey) => {
      if (sort?.key !== key) return setSort({ key, dir: 'desc' });
      if (sort.dir === 'desc') return setSort({ key, dir: 'asc' });
      return setSort(null);
    },
    [sort, setSort],
  );

  const reset = useCallback(
    () => patch({ q: '', cust: '', freq: '', sec: '', act: '', sort: '' }),
    [patch],
  );

  return { filters, sort, setFilters, setSort, cycleSort, reset };
}
