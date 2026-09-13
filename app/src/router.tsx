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

import { AppShell } from './components/AppShell';
import { ListPage } from './routes/ListPage';
import { FavoritesPage } from './routes/FavoritesPage';
import { AboutPage } from './routes/AboutPage';
import { UsPage } from './routes/UsPage';
import { PasswordGate } from './components/PasswordGate';

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
  // 美股資料來自 FinLab 付費訂閱，加密存放，要密碼才解得開
  component: () => (
    <PasswordGate what="美股 ETF 清單">
      <UsPage />
    </PasswordGate>
  ),
});

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: AboutPage,
});

const routeTree = rootRoute.addChildren([listRoute, favoritesRoute, usRoute, aboutRoute]);

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
