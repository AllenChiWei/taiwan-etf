/* v18 策略的保險箱（獨立密碼）與資料型別。v18 頁與收藏頁的績效比較共用同一個工作階段：
 * 在 v18 頁解鎖後，收藏頁才會出現「加入 v18」；沒解鎖時收藏頁完全不提到它。 */

import { Vault } from './vault';

export interface Holding {
  id: string; name: string; entry: string; entryPrice: number; price: number;
  ret: number; status: string; nextWeight: number;
}
export interface Trade { id: string; name: string; entry: string; exit: string | null; ret: number }
export interface V18Data {
  asof: string;
  generated: string;
  regime: { bull: boolean; signal: number | null; signalChg: number | null; m1b: number | null };
  holdings: Holding[];
  actions: Array<{ id: string; name: string; action: string }>;
  selection: { date: string; list: Array<{ id: string; name: string; yoy: number | null }>; pending?: boolean };
  stats: { since: string; cagr: number; mdd: number; sharpe: number; ytd: number; ytdMdd: number; m1: number; m3: number };
  equity: { d: string[]; v: number[] };
  monthly: Record<string, number>;
  trades: Trade[];
}


export const v18Vault = new Vault(`${import.meta.env.BASE_URL}data/v18/`, 'twetf.v18.unlock');

/** 已解鎖（或可從本機工作階段還原）就回傳資料；沒有資料、沒解鎖或失敗都回 null，不丟錯。 */
export async function loadV18IfUnlocked(): Promise<V18Data | null> {
  try {
    const m = await v18Vault.loadManifest();
    if (!m) return null;
    if (!v18Vault.unlocked && !(await v18Vault.restore(m))) return null;
    return await v18Vault.fetchJson<V18Data>('v18.enc');
  } catch {
    return null;
  }
}
