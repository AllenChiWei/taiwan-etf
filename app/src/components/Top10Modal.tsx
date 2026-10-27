/* 點台股清單的 ETF 名稱跳出來的前十大持股＋受益人數；底下連到完整的 ETF 頁。
 *
 * 內容元件與資料載入在 EtfExtras.tsx（ETF 頁共用）。
 */

import { useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { HoldersBox, Top10List, top10Asof, useEtfExtras } from './EtfExtras';
import type { Etf } from '../types';

export function Top10Modal({ etf, onClose }: { etf: Etf; onClose: () => void }) {
  const data = useEtfExtras();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Esc 關閉、打開時把焦點放到關閉鈕、背景不捲動
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const asof = top10Asof(etf, data);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
         onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="top10-title"
           onClick={e => e.stopPropagation()}
           className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-surface
                      p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="top10-title" className="text-[16px] font-bold text-ink">
              <span className="font-mono text-accent">{etf.code}</span> {etf.name}
            </h2>
            <p className="mt-0.5 text-[12px] text-muted">
              前十大持股{asof && ` · ${asof}`}
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="關閉"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-lg text-muted hover:bg-hover hover:text-ink">
            ×
          </button>
        </div>

        <HoldersBox code={etf.code} data={data} />
        <Top10List etf={etf} data={data} />

        <Link to="/etf" search={{ code: etf.code }} onClick={onClose}
              className="mt-3 flex h-10 items-center justify-center rounded-lg bg-accent text-[13px] font-semibold text-accent-ink">
          看 {etf.code} 完整頁面（報酬、配息、成長圖）→
        </Link>
      </div>
    </div>
  );
}
