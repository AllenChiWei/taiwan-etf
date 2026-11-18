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
      <div className="mt-1 pl-3.5">{children}</div>
    </details>
  );
}
