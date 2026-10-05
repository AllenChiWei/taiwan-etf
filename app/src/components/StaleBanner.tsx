/* 資料過期提示（lib/freshness.ts）：最新資料日之後已經過了 ≥ 2 個交易日還沒更新就顯示 */

import { STALE_AFTER, missedTradingDays } from '../lib/freshness';

export function StaleBanner({ updated }: { updated: string | null | undefined }) {
  if (!updated) return null;
  const n = missedTradingDays(updated);
  if (n < STALE_AFTER) return null;
  return (
    <div role="status" className="mx-auto mt-2 w-full max-w-6xl px-3 sm:px-4">
      <p className="rounded-lg border border-up/50 bg-surface px-3 py-2 text-[12.5px] text-ink">
        <span className="font-semibold text-up">資料可能沒有更新：</span>
        最新資料是 {updated}，之後已經過了 {n} 個交易日。遇到連假可以忽略；否則多半是資料來源出問題，
        畫面上的數字可能是舊的。
      </p>
    </div>
  );
}
