/* 部署後自動更新：定期看 version.json，有新版就重新整理（或提示）。
 *
 * 什麼時候檢查：切回這個分頁時，以及分頁開著的時候每 5 分鐘。分頁在背景時不打，
 * 省得手機一直在背景發請求。怎麼處理在 lib/version.ts 的 decideUpdate。 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { decideUpdate } from '../lib/version';

const INTERVAL = 5 * 60_000;
const COUNTDOWN = 10;

async function remoteId(): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`,
                            { cache: 'no-store' });
    if (!res.ok) return null;
    const d = (await res.json()) as { id?: unknown };
    return typeof d.id === 'string' ? d.id : null;
  } catch {
    return null;                      // 離線或暫時連不上：當成沒有新版，下次再看
  }
}

export function useAutoUpdate(pathname: string) {
  /** null = 沒事；數字 = 倒數秒數；'prompt' = 只提示不倒數 */
  const [notice, setNotice] = useState<number | 'prompt' | null>(null);
  const snoozed = useRef(false);
  const path = useRef(pathname);
  path.current = pathname;

  const check = useCallback(async (returning: boolean) => {
    if (import.meta.env.DEV || snoozed.current) return;
    const id = await remoteId();
    const action = decideUpdate(__BUILD_ID__, id, { returning, pathname: path.current });
    if (action === 'reload') location.reload();
    else if (action === 'countdown') setNotice(n => (n === null ? COUNTDOWN : n));
    else if (action === 'prompt') setNotice('prompt');
  }, []);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void check(true); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check(false);
    }, INTERVAL);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [check]);

  // 倒數到 0 就重新整理
  useEffect(() => {
    if (typeof notice !== 'number') return;
    if (notice <= 0) { location.reload(); return; }
    const t = setTimeout(() => setNotice(n => (typeof n === 'number' ? n - 1 : n)), 1000);
    return () => clearTimeout(t);
  }, [notice]);

  return {
    notice,
    reloadNow: () => location.reload(),
    /** 「稍後」：這個分頁這次就不再催，下次開啟或切回來再說 */
    snooze: () => { snoozed.current = true; setNotice(null); },
  };
}
