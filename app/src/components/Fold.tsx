/* 長說明預設收起來（2026-11-18 站主：內容更流暢簡潔）：一句結論永遠看得到，點「▸」才展開全文。
 * 用原生 <details>：不用 JS 狀態、鍵盤與螢幕報讀器都能用，頁內搜尋（Ctrl＋F）在 Chrome／Edge 會自動展開。 */
import type { ReactNode } from 'react';

export function Fold({ summary, children, className = 'mt-2' }: {
  /** 收起來時看得到的那一句（結論） */
  summary: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`group text-[11px] leading-relaxed text-faint ${className}`}>
      <summary className="cursor-pointer list-none text-[11.5px] text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="mr-1 inline-block text-faint transition-transform group-open:rotate-90">▸</span>
        {summary}
        <span className="ml-1 text-faint group-open:hidden">（說明）</span>
      </summary>
      <div className="mt-1 max-w-[78ch] pl-3.5">{children}</div>
    </details>
  );
}

/** 區塊裡次要的內容（2026-11-21 站主：籌碼頁太雜）：預設收起，標題是一行「▸ 更多：…」按鈕。內容不刪，只是先藏起來 */
export function MoreFold({ summary, children, className = 'mt-3' }: { summary: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={`group rounded-lg border border-line bg-bg ${className}`}>
      <summary className="cursor-pointer list-none px-3 py-2 text-[12.5px] font-semibold text-accent hover:bg-sunken/50 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
        {summary}
      </summary>
      <div className="px-2.5 pb-2.5">{children}</div>
    </details>
  );
}
