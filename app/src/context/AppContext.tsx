/* 全站共用狀態：資料集與收藏清單。
   兩者都在 AppShell 建立一次 —— 收藏若讓頁首與分頁各自 useState，
   兩份狀態會不同步（在清單頁按星號，頁首的數字不會動）。 */

import { createContext, useContext } from 'react';
import type { EtfDataset } from '../types';

export interface FavoritesApi {
  codes: string[];
  has: (code: string) => boolean;
  toggle: (code: string) => void;
  count: number;
}

export interface AppValue {
  data: EtfDataset;
  favorites: FavoritesApi;
}

const AppContext = createContext<AppValue | null>(null);

export const AppProvider = AppContext.Provider;

function useApp(): AppValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('必須在 AppProvider 之內使用');
  return v;
}

export const useEtfData = () => useApp().data;
export const useFavoritesApi = () => useApp().favorites;
