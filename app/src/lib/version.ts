/* 部署後自動更新的判斷。純函式，沒有 React。
 *
 * 開著的分頁會一直跑舊版程式。useAutoUpdate 定期拿自己的建置代號跟 version.json 比，
 * 這裡決定發現新版時要怎麼做 —— 重點是不要在使用者做事做到一半時把畫面刷掉。
 */

export type UpdateAction = 'none' | 'reload' | 'countdown' | 'prompt';

/**
 * - 使用者剛切回這個分頁：直接重新整理。他剛回來，手上沒有做到一半的事。
 * - 正在看：跳提示倒數，可以按「稍後」。
 * - 對帳單頁：只提示不倒數 —— 上傳的檔案只在記憶體裡，重新整理就沒了。
 */
export function decideUpdate(current: string, remote: string | null,
                             opts: { returning: boolean; pathname: string }): UpdateAction {
  if (!remote || remote === current) return 'none';
  if (opts.pathname === '/futures') return 'prompt';
  return opts.returning ? 'reload' : 'countdown';
}
