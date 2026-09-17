/* 路由定義（程式碼式，非檔案式 —— 三個頁面還不值得引入產生器）。
 *
 * 用 hash history：GitHub Pages 是純靜態，沒有 SPA fallback，
 * /taiwan-etf/favorites 這種深連結會直接 404。改用 #/favorites 就沒這問題。
 * Phase 2 搬到有伺服器的主機後可以換成 browser history。
 *
 * 篩選條件放在網址的 search 參數，所以重新整理、分享連結、上一頁都會保留檢視。 */

import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

import { lazy } from 'react';

import { AppShell } from './components/AppShell';
import { ListPage } from './routes/ListPage';

// 台股清單是首頁，跟著主程式一起載。其餘分頁按需求載入 ——
// 美股頁帶著虛擬捲動、收藏頁帶著圖表與 WebCrypto 解密，
// 只看台股的訪客沒有理由為那些付下載成本。
// React.lazy 需要 default export，這些是具名匯出，所以在這裡轉一層。
const UsPage = lazy(() => import('./routes/UsPage').then(m => ({ default: m.UsPage })));
const FavoritesPage = lazy(() =>
  import('./routes/FavoritesPage').then(m => ({ default: m.FavoritesPage })));
const AboutPage = lazy(() => import('./routes/AboutPage').then(m => ({ default: m.AboutPage })));
const CalculatorPage = lazy(() =>
  import('./routes/CalculatorPage').then(m => ({ default: m.CalculatorPage })));

export interface ListSearch {
  q: string;
  cust: string;
  freq: string;
  sec: string;
  /** 'yield-desc' 之類；空字串代表預設的代號排序 */
  sort: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 未知或型別不對的參數一律當成空值，網址被亂改也不會讓頁面爆掉。 */
function validateListSearch(search: Record<string, unknown>): ListSearch {
  return {
    q: str(search.q),
    cust: str(search.cust),
    freq: str(search.freq),
    sec: str(search.sec),
    sort: str(search.sort),
  };
}

const rootRoute = createRootRoute({ component: AppShell });

const listRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: validateListSearch,
  component: ListPage,
});

const favoritesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/favorites',
  validateSearch: validateListSearch,
  component: FavoritesPage,
});

const usRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/us',
  component: UsPage,
});

const calcRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calc',
  component: CalculatorPage,
});

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: AboutPage,
});

const routeTree = rootRoute.addChildren(
  [listRoute, favoritesRoute, usRoute, calcRoute, aboutRoute]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: 'intent',
  // 空字串的參數不要寫進網址，否則每次都會多出 ?q=&cust=&freq=
  stringifySearch: (search) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(search)) {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    }
    const s = sp.toString();
    return s ? `?${s}` : '';
  },
  parseSearch: (searchStr) => Object.fromEntries(new URLSearchParams(searchStr)),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
