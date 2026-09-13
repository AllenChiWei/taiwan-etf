/* 收藏清單。存在使用者自己的瀏覽器，不會上傳。
   Phase 2 有帳號之後，這裡換成打 API 就能跨裝置同步。 */

import { useCallback, useEffect, useState } from 'react';
import { loadFavorites, saveFavorites } from '../lib/storage';

export function useFavorites() {
  const [codes, setCodes] = useState<string[]>(loadFavorites);

  useEffect(() => { saveFavorites(codes); }, [codes]);

  const toggle = useCallback((code: string) => {
    setCodes(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  }, []);

  const has = useCallback((code: string) => codes.includes(code), [codes]);

  return { codes, has, toggle, count: codes.length };
}
