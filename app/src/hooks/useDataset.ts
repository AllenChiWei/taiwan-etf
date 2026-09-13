/* 載入 etfs.json。資料一次載入後就常駐，所以不需要 react-query 之類的快取層；
   Phase 2 換成會變動的 API 時再考慮。 */

import { useEffect, useState } from 'react';
import { fetchDataset } from '../api/etfs';
import type { EtfDataset } from '../types';

export type DatasetState =
  | { status: 'loading' }
  | { status: 'ready'; data: EtfDataset }
  | { status: 'error'; error: Error };

export function useDataset(): DatasetState {
  const [state, setState] = useState<DatasetState>({ status: 'loading' });

  useEffect(() => {
    const ac = new AbortController();
    fetchDataset(ac.signal)
      .then(data => setState({ status: 'ready', data }))
      .catch((error: unknown) => {
        if (ac.signal.aborted) return;       // 元件已卸載，不要更新狀態
        setState({ status: 'error', error: error as Error });
      });
    return () => ac.abort();
  }, []);

  return state;
}
