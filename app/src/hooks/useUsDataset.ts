/* 美股資料：進到分頁才載入，載入後留在記憶體，切走再切回來不會重抓。 */

import { useEffect, useState } from 'react';
import { fetchUsDataset } from '../api/usEtfs';
import type { UsEtfDataset } from '../types';

export type UsDatasetState =
  | { status: 'loading' }
  | { status: 'ready'; data: UsEtfDataset }
  | { status: 'error'; error: Error };

// 模組層快取：同一個分頁來回切換不該重複下載 554 KB
let cached: UsEtfDataset | null = null;

export function useUsDataset(): UsDatasetState {
  const [state, setState] = useState<UsDatasetState>(
    cached ? { status: 'ready', data: cached } : { status: 'loading' },
  );

  useEffect(() => {
    if (cached) return;
    const ac = new AbortController();
    fetchUsDataset(ac.signal)
      .then(data => { cached = data; setState({ status: 'ready', data }); })
      .catch((error: unknown) => {
        if (ac.signal.aborted) return;
        setState({ status: 'error', error: error as Error });
      });
    return () => ac.abort();
  }, []);

  return state;
}
