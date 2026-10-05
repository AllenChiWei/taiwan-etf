/* 私人頁開著的時候也要在 6 小時後踢出去（lib/vault.ts 的 SESSION_HOURS）：
 * 每 30 秒、以及切回這個分頁時檢查一次；過期就上鎖並呼叫 onExpire（頁面回到輸入密碼畫面）。 */

import { useEffect } from 'react';
import type { Vault } from '../lib/vault';

export function useVaultExpiry(vault: Vault, active: boolean, onExpire: () => void): void {
  useEffect(() => {
    if (!active) return;
    const check = () => { if (vault.expired()) onExpire(); };
    const id = window.setInterval(check, 30_000);
    document.addEventListener('visibilitychange', check);
    check();
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, [vault, active, onExpire]);
}
