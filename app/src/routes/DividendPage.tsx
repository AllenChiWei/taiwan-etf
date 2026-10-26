/* 配息試算：獨立的分頁。
 *
 * 原本是試算頁裡的第三個子分頁，藏在兩層之下，不點進去不會知道有這個功能 ——
 * 使用者自己回報找不到。它跟回測、退休推估的性質也不同：那兩個是「如果…會怎樣」，
 * 這個是「我現在的持股每個月能領多少」，資料還存在 localStorage、會一直用。
 */

import { DividendPlanner } from '../components/DividendPlanner';
import { EmptyState } from '../components/EmptyState';
import { useCalcIndex } from '../hooks/useCalcIndex';

export function DividendPage() {
  const { index, error, loading } = useCalcIndex();

  return (
    <>
      <h1 className="sr-only">配息試算</h1>

      {error && (
        <EmptyState
          icon="📉"
          title="這個部署版本沒有包含配息資料"
          hint="配息資料是部署時產生的，需要 GitHub Actions 有 FINLAB_API_TOKEN。"
        />
      )}
      {loading && <p className="py-16 text-center text-muted">載入配息資料中…</p>}

      {index && <DividendPlanner index={index} />}

      {index && (
        <p className="mt-4 mb-2 text-[11.5px] leading-relaxed text-faint">
          配息金額優先採用交易所公告的原始數字，標示「約略值」的是從還原股價回推的。
          年配息以最近一次配息乘上一年配息次數推估，實際金額每次都會變，
          ETF 與公司也可能調整配息政策。數字是稅前的，沒有扣二代健保補充保費與所得稅。
        </p>
      )}
    </>
  );
}
