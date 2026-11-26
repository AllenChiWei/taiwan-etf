import { useEffect, useState } from 'react';
import type { FillSummaryData } from '../lib/fill';

/** 填息摘要與試算資料一起部署，但舊版或抓取失敗時可獨立缺席。 */
export function useFillSummary(): FillSummaryData | null {
  const [data, setData] = useState<FillSummaryData | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/calc/fill.json`, { signal: ac.signal })
      .then(r => (r.ok ? r.json() as Promise<FillSummaryData> : null))
      .then(d => { if (!ac.signal.aborted && d?.codes) setData(d); })
      .catch(() => { /* 部署資料可缺席；隱藏摘要不影響其他頁面。 */ });
    return () => ac.abort();
  }, []);

  return data;
}
