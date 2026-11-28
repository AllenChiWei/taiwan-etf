/* 配息試算、持股健檢與市值走勢：獨立的分頁。
 *
 * 「配息試算」計算現有持股每月與全年可領股息（資料存在 localStorage 的 twetf.holdings）；
 * 「持股健檢」（?view=xray）讀同一份持股，按市值權重穿透展開 ETF 成分股，檢視單一個股集中度
 * 以及低融資維持率、可轉債轉換賣壓、未來 14 天行事曆與近期重大訊息；
 * 「市值走勢」（?view=value）讀持股變動紀錄（twetf.holdingsLog），僅在切入此分頁時才抓歷史日價，
 * 顯示每日總市值與扣掉加減碼的累計損益。後兩者均不依賴 calc/index.json（FinLab）。
 */

import { lazy, Suspense, useCallback } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { DividendPlanner } from '../components/DividendPlanner';
import { EmptyState } from '../components/EmptyState';
import { useCalcIndex } from '../hooks/useCalcIndex';

const PortfolioXray = lazy(() => import('../components/PortfolioXray')
  .then(m => ({ default: m.PortfolioXray })));
const PortfolioValue = lazy(() => import('../components/PortfolioValue')
  .then(m => ({ default: m.PortfolioValue })));

type DividendView = '' | 'xray' | 'value';

const VIEWS = [
  { id: '', label: '配息試算' },
  { id: 'xray', label: '持股健檢' },
  { id: 'value', label: '市值走勢' },
] as const;

function DividendPlanTab() {
  const { index, error, loading } = useCalcIndex();

  return (
    <>
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
        <p className="mt-4 mb-2 max-w-[78ch] text-[11.5px] leading-relaxed text-faint">
          配息金額優先採用交易所公告的原始數字，標示「約略值」的是從還原股價回推的。
          年配息以最近一次配息乘上一年配息次數推估，實際金額每次都會變，
          ETF 與公司也可能調整配息政策。數字是稅前的，沒有扣二代健保補充保費與所得稅。
        </p>
      )}
    </>
  );
}

export function DividendPage() {
  const { view } = useSearch({ from: '/dividend' });
  const navigate = useNavigate();
  const activeView: DividendView = view === 'xray' ? 'xray' : view === 'value' ? 'value' : '';

  const setView = useCallback((next: DividendView) => {
    void navigate({
      to: '/dividend',
      search: next ? { view: next } : {},
      replace: true,
      resetScroll: false,
    });
  }, [navigate]);

  const heading = activeView === 'xray' ? '持股健檢' : activeView === 'value' ? '市值走勢' : '配息試算';

  return (
    <>
      <h1 className="sr-only">{heading}</h1>

      <div role="tablist" aria-label="配息頁分頁" className="flex flex-wrap gap-1.5 pt-4">
        {VIEWS.map(v => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={activeView === v.id}
            onClick={() => setView(v.id)}
            className={`h-9 rounded-lg px-3.5 text-[13px] font-semibold transition-colors ${
              activeView === v.id ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {activeView === 'xray' ? (
        <Suspense fallback={<p className="py-16 text-center text-[13px] text-muted">載入持股健檢中…</p>}>
          <PortfolioXray onGoPlan={() => setView('')} />
        </Suspense>
      ) : activeView === 'value' ? (
        <Suspense fallback={<p className="py-16 text-center text-[13px] text-muted">載入市值走勢中…</p>}>
          <PortfolioValue onGoPlan={() => setView('')} />
        </Suspense>
      ) : (
        <DividendPlanTab />
      )}
    </>
  );
}
