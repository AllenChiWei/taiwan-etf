/* 會自我修復的延遲載入。
 *
 * ## 要解決什麼
 *
 * 分頁是按需求載入的，檔名帶內容雜湊（FavoritesPage-DUShV5yx.js）。每次部署
 * 都會產生新的雜湊、刪掉舊的。所以有一個很容易踩到的情況：
 *
 *   使用者開著分頁 → 我們部署了新版 → 使用者點「收藏」
 *   → 他記憶體裡的舊主程式去要舊檔名 → 那個檔案已經不在了 → 404
 *
 * 台股清單不受影響，因為它跟主程式一起載入；只有延遲載入的分頁會中。
 * 症狀就是「首頁好好的，點其他分頁就壞掉」。
 *
 * ## 怎麼修
 *
 * 載入失敗就重新整理一次。重新整理會拿到新的 index.html，裡面是新的檔名。
 * 使用者只會看到畫面閃一下。
 *
 * 用時間戳而不是單純的旗標來防迴圈：如果重新整理之後還是失敗（例如真的斷網），
 * 一分鐘內不會再重試，錯誤會往上拋給錯誤邊界顯示。但一分鐘後遇到下一次部署
 * 仍然救得回來 —— 用一次性的旗標就會讓後續的換版永遠修不好。
 */

import { lazy, type ComponentType } from 'react';

const KEY = 'twetf.chunkReload';
const COOLDOWN_MS = 60_000;

function recentlyReloaded(): boolean {
  try {
    const at = Number(sessionStorage.getItem(KEY));
    return Number.isFinite(at) && Date.now() - at < COOLDOWN_MS;
  } catch {
    // 無痕模式或封鎖儲存空間時讀不到。當成「沒重試過」，最差就是多重整一次
    return false;
  }
}

function markReloaded(): void {
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* 存不進去也沒關係，下面的 reload 照樣執行 */
  }
}

/**
 * 包一層 React.lazy：模組是具名匯出，而且載入失敗時會自動重新整理一次。
 *
 * @param load 動態 import
 * @param pick 從模組取出元件（這些檔案都是具名匯出，沒有 default）
 */
export function lazyRoute<M>(
  load: () => Promise<M>,
  pick: (m: M) => ComponentType,
) {
  return lazy(async () => {
    try {
      return { default: pick(await load()) };
    } catch (err) {
      if (recentlyReloaded()) throw err;
      markReloaded();
      window.location.reload();
      // 回傳一個永不解析的 promise，讓畫面停在 Suspense 的載入狀態直到
      // 重新整理生效。解析或拋出都會讓使用者先看到一瞬間的錯誤畫面。
      return new Promise<{ default: ComponentType }>(() => {});
    }
  });
}
