/* 監聽 media query。
   手機版是渲染不同的元件（卡片）而不是用 CSS 變形表格 —— 兩份 markup 都畫出來
   再隱藏一份，359 列會變成雙倍 DOM，捲動會變鈍。 */

import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,                     // SSR／預渲染時當作桌機
  );
}

/** 與 Tailwind 的 md 斷點一致（768px）。 */
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
