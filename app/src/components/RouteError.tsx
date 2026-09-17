/* 分頁載入或渲染失敗時的畫面。
 *
 * 這是交給 TanStack Router 的 defaultErrorComponent，不是自己寫的 React
 * 錯誤邊界。差別很實際：自訂邊界只能清掉自己的 state，路由的比對狀態清不掉。
 * 實測用自訂邊界時，從壞掉的收藏頁切回台股，Outlet 仍然會再渲染一次收藏頁
 * 而再次拋出同一個錯誤 —— 連用 key 強制重新掛載都沒用，因為問題不在邊界。
 * router 給的 reset 會一併重設它自己的比對狀態。
 *
 * 最常見的來源是延遲載入的分塊載不到（部署換版把舊檔名刪了）。
 * lib/lazyRoute.tsx 會先自動重新整理一次，這裡接的是「重整過還是失敗」，
 * 通常代表真的斷網。
 */

import type { ErrorComponentProps } from '@tanstack/react-router';

export function RouteError({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error);
  // 動態載入失敗的訊息各家瀏覽器不同，共通點是提到 module / chunk / import
  const isChunk = /chunk|module|dynamically imported|Importing a module/i.test(message);

  return (
    <div className="mt-6 rounded-xl border border-line bg-surface px-4 py-8 text-center">
      <p className="text-sm font-semibold text-ink">
        {isChunk ? '這個分頁載入失敗' : '這個分頁出了點問題'}
      </p>
      <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-muted">
        {isChunk
          ? '通常是網站剛更新，而這個分頁還記著舊版的檔案。重新整理就會拿到新版。'
          : '重新整理通常就好了。如果一直出現，請把下面那行訊息告訴我。'}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="h-11 rounded-lg bg-accent px-6 text-sm font-semibold text-accent-ink"
        >
          重新整理
        </button>
        <button
          type="button"
          onClick={reset}
          className="h-11 rounded-lg border border-line px-4 text-sm font-semibold text-muted"
        >
          重試
        </button>
      </div>
      <p className="mt-3 font-mono text-[11px] break-words text-faint">{message}</p>
    </div>
  );
}
