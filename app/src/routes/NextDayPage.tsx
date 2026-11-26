/* 隔日漲跌幅獨立頁（#/nextday，市場 → 隔日漲跌；2026-11-21 使用者：跟結算價一樣獨立一頁、加通道推移圖）。
 * 2026-11-26：最上方加入「盤前作戰卡」（PremarketCard），共用同一份 nextday.json 不重複抓取。 */

import { useEffect, useState } from 'react';
import type { NextdayData } from '../lib/nextday';
import { PremarketCard } from '../components/PremarketCard';
import { NextDaySection } from '../components/NextDaySection';

export function NextDayPage() {
  const [data, setData] = useState<NextdayData | null | undefined>(undefined);
  useEffect(() => {
    const ac = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/nextday.json`, { signal: ac.signal, cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!ac.signal.aborted) setData(j?.bands ? (j as NextdayData) : null); })
      .catch(() => { if (!ac.signal.aborted) setData(null); });
    return () => ac.abort();
  }, []);

  if (data === undefined) return <p className="mt-6 text-center text-sm text-muted">載入中…</p>;
  if (!data) return <p className="mt-6 text-center text-sm text-muted">隔日漲跌資料暫時讀不到，請稍後再試。</p>;

  return (
    <div>
      <PremarketCard data={data} />
      <NextDaySection data={data} />
    </div>
  );
}
