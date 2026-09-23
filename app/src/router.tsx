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
import { lazyRoute } from './lib/lazyRoute';
import { RouteError } from './components/RouteError';

// 台股清單是首頁，跟著主程式一起載。其餘分頁按需求載入 ——
// 美股頁帶著虛擬捲動、收藏頁帶著圖表與 WebCrypto 解密，
// 只看台股的訪客沒有理由為那些付下載成本。
//
// 用 lazyRoute 而不是直接用 React.lazy：分塊檔名帶內容雜湊，部署換版之後
// 開著的分頁會去要一個已經不存在的檔名。lazyRoute 會重新整理一次救回來。
// 這正是「首頁好好的，點收藏或美股就跳錯誤」的成因。
const UsPage = lazyRoute(() => import('./routes/UsPage'), m => m.UsPage);
const FavoritesPage = lazyRoute(() => import('./routes/FavoritesPage'), m => m.FavoritesPage);
const AboutPage = lazyRoute(() => import('./routes/AboutPage'), m => m.AboutPage);
const ChangelogPage = lazyRoute(() => import('./routes/ChangelogPage'), m => m.ChangelogPage);
const CalculatorPage = lazyRoute(() => import('./routes/CalculatorPage'), m => m.CalculatorPage);
const PokerPage = lazyRoute(() => import('./routes/PokerPage'), m => m.PokerPage);
const ChipsPage = lazyRoute(() => import('./routes/ChipsPage'), m => m.ChipsPage);
const NewsPage = lazyRoute(() => import('./routes/NewsPage'), m => m.NewsPage);
const StockPage = lazyRoute(() => import('./routes/StockPage'), m => m.StockPage);
const DividendPage = lazyRoute(
  () => import('./routes/DividendPage'), m => m.DividendPage);
// 對帳單頁還會在使用者選檔時動態載入 SheetJS（約 400 KB），所以更不該
// 跟主程式綁在一起 —— 沒點進來的人一個位元組都不用下載。
const FuturesPage = lazyRoute(() => import('./routes/FuturesPage'), m => m.FuturesPage);

export interface ListSearch {
  q: string;
  cust: string;
  freq: string;
  sec: string;
  /** '' 全部 / 'active' 主動 / 'passive' 被動 */
  act: string;
  /** 'yield-desc' 之類；空字串代表預設的代號排序 */
  sort: string;
  /** 台股頁的分頁：'' 清單 / 'active' 主動式換股 / 'upcoming' 即將上市 */
  view: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 未知或型別不對的參數一律當成空值，網址被亂改也不會讓頁面爆掉。 */
function validateListSearch(search: Record<string, unknown>): ListSearch {
  return {
    q: str(search.q),
    cust: str(search.cust),
    freq: str(search.freq),
    sec: str(search.sec),
    act: str(search.act),
    sort: str(search.sort),
    view: str(search.view),
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

const futuresRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/futures',
  component: FuturesPage,
});

const dividendRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dividend',
  component: DividendPage,
});

const chipsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chips',
  component: ChipsPage,
});

const newsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/news',
  component: NewsPage,
});

/** 個股頁只有一個參數：看哪一檔。型別不對就當成沒選。 */
const stockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stock',
  validateSearch: (search: Record<string, unknown>) => ({ code: str(search.code) }),
  component: StockPage,
});

const pokerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/poker',
  component: PokerPage,
});

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: AboutPage,
});

const changelogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/changelog',
  component: ChangelogPage,
});

const routeTree = rootRoute.addChildren(
  [listRoute, favoritesRoute, usRoute, calcRoute, dividendRoute, futuresRoute,
   chipsRoute, newsRoute, stockRoute, pokerRoute, changelogRoute, aboutRoute]);

export const router = createRouter({
  routeTree,
  // 任何分頁載入或渲染失敗都走這個畫面。交給 router 而不是自寫錯誤邊界，
  // 因為它的 reset 會一併重設路由的比對狀態 —— 自訂邊界做不到，
  // 從壞掉的分頁切走之後 Outlet 會再渲染一次那個分頁並再次拋錯。
  defaultErrorComponent: RouteError,
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
