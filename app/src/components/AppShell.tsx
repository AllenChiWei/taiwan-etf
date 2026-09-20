/* 根路由元件：載入資料、畫頁首／頁尾，把 <Outlet /> 交給各分頁。
   資料在這一層載入，分頁切換才不會重抓。 */

import { Suspense } from 'react';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useDataset } from '../hooks/useDataset';
import { useFavorites } from '../hooks/useFavorites';
import { useTheme } from '../hooks/useTheme';
import { AppProvider } from '../context/AppContext';
import { metaLine } from '../lib/format';
import { EmptyState } from './EmptyState';
import { ScrollTopButton } from './ScrollTopButton';

const TABS = [
  { to: '/', label: '台股' },
  { to: '/us', label: '美股' },
  { to: '/favorites', label: '收藏' },
  { to: '/calc', label: '試算' },
  { to: '/dividend', label: '配息' },
  { to: '/futures', label: '對帳單' },
  { to: '/chips', label: '籌碼' },
  { to: '/news', label: '新聞' },
  { to: '/stock', label: '個股' },
  { to: '/poker', label: '撲克' },
  { to: '/about', label: '說明' },
] as const;

export function AppShell() {
  const state = useDataset();
  const favorites = useFavorites();
  const theme = useTheme();
  const pathname = useRouterState({ select: s => s.location.pathname });

  const meta = state.status === 'ready' ? state.data.meta : null;

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50
                                 focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink">
        跳至主要內容
      </a>

      <header className="border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex w-full max-w-6xl items-start justify-between gap-3 px-3 pt-4 pb-3 sm:px-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">職業賭徒日誌</h1>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {meta ? metaLine(meta.source, meta.updated, meta.snapshot, meta.yieldAsof) : '載入中…'}
            </p>
          </div>
          <button
            type="button"
            onClick={theme.toggle}
            aria-label={theme.isDark ? '切換成淺色主題' : '切換成深色主題'}
            title={theme.isDark ? '切換成淺色主題' : '切換成深色主題'}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line
                       text-lg text-muted hover:bg-hover hover:text-ink"
          >
            {theme.isDark ? '☀' : '☾'}
          </button>
        </div>

        <nav aria-label="主要導覽" className="mx-auto flex w-full max-w-6xl flex-wrap gap-0.5 px-3 sm:flex-nowrap sm:gap-1 sm:px-4">
          {TABS.map(t => {
            const active = pathname === t.to;
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2 py-2.5 text-sm font-semibold sm:px-3.5
                  ${active ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'}`}
                aria-current={active ? 'page' : undefined}
              >
                {t.label}
                {t.to === '/favorites' && favorites.count > 0 && (
                  <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent
                                   px-1.5 font-mono text-[11px] font-bold text-accent-ink">
                    {favorites.count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-3 pb-10 sm:px-4">
        {state.status === 'loading' && (
          <p className="py-16 text-center text-muted">載入資料中…</p>
        )}

        {state.status === 'error' && (
          <EmptyState
            icon="⚠️"
            title="資料載入失敗"
            hint={`${state.error.message}　請檢查網路連線後重新整理。`}
          />
        )}

        {state.status === 'ready' && (
          <AppProvider value={{ data: state.data, favorites }}>
            {/* 分頁是動態載入的，切換時會有一瞬間的空白。
                錯誤處理交給 router 的 defaultErrorComponent（見 router.tsx）—— 
                自訂的 React 錯誤邊界清不掉路由自己的比對狀態。 */}
            <Suspense fallback={<p className="py-16 text-center text-muted">載入中…</p>}>
              <Outlet />
            </Suspense>
          </AppProvider>
        )}
      </main>

      {/* 頁尾講的是 ETF 資料來源，撲克頁跟那些資料無關 ——
          掛在那裡會讓人以為那張開牌表也是從 TWSE 來的。 */}
      <footer className="mx-auto w-full max-w-6xl border-t border-line px-3 py-6 text-center
                         text-[12.5px] text-faint sm:px-4">
        {pathname === '/poker' ? (
          <p>開牌範圍為公開的近似範圍，僅供參考。</p>
        ) : (
          <>
            <p>資料來源：TWSE／TPEx 公開資料、FinLab、MoneyDJ。本頁僅供參考，不構成投資建議。</p>
            {meta && <p className="mt-1">共 {meta.total} 檔　·　更新於 {meta.updated}</p>}
          </>
        )}
      </footer>

      <ScrollTopButton />
    </div>
  );
}
