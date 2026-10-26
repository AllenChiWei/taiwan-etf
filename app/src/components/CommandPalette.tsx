/* 全站快速搜尋（Ctrl＋K、⌘K 或 /；手機點右上角放大鏡）。計算在 lib/search.ts。
 *
 * ETF 清單用 AppShell 已經載入的那份；個股索引第一次打開才去抓（不拖慢首頁）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { fetchStockIndex } from '../api/stocks';
import { PAGES, searchAll, type SearchItem } from '../lib/search';

const KIND_LABEL = { page: '頁面', etf: 'ETF', stock: '個股' } as const;

export function CommandPalette({ open, onClose, etfs }: {
  open: boolean; onClose: () => void; etfs: { code: string; name: string; freq?: string }[];
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [stocks, setStocks] = useState<SearchItem[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setSel(0);
    setTimeout(() => input.current?.focus(), 0);
    if (stocks.length) return;
    const ac = new AbortController();
    fetchStockIndex(ac.signal).then(d => {
      if (d && !ac.signal.aborted) {
        setStocks(d.stocks.map(s => ({ kind: 'stock' as const, code: s.c, name: s.n, keywords: s.i, to: '/stock', search: { code: s.c } })));
      }
    }).catch(() => {});
    return () => ac.abort();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo<SearchItem[]>(() => [
    ...PAGES,
    ...etfs.map(e => ({ kind: 'etf' as const, code: e.code, name: e.name, keywords: e.freq, to: '/', search: { q: e.code } })),
    ...stocks,
  ], [etfs, stocks]);
  const hits = useMemo(() => searchAll(items, q), [items, q]);

  if (!open) return null;

  const go = (it: SearchItem) => {
    onClose();
    void navigate({ to: it.to, search: (it.search ?? {}) as never });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter' && hits[sel]) { e.preventDefault(); go(hits[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 pt-[12vh] backdrop-blur-[2px]"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="快速搜尋"
           className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-3.5">
          <span aria-hidden className="text-muted">⌕</span>
          <input ref={input} value={q} onChange={e => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey}
                 placeholder="搜尋 ETF、個股、頁面…（例：0056、台積電、配息）"
                 aria-label="搜尋" role="combobox" aria-expanded="true" aria-controls="cmdk-list"
                 className="h-12 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-faint" />
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[10.5px] text-faint sm:block">Esc</kbd>
        </div>
        <ul id="cmdk-list" role="listbox" className="max-h-[55vh] overflow-y-auto py-1.5">
          {hits.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-muted">找不到「{q}」</li>}
          {hits.map((it, i) => (
            <li key={`${it.kind}-${it.code ?? it.name}-${it.search?.view ?? ''}`} role="option" aria-selected={i === sel}
                onMouseEnter={() => setSel(i)} onMouseDown={e => { e.preventDefault(); go(it); }}
                className={`mx-1.5 flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 ${i === sel ? 'bg-accent text-accent-ink' : 'text-ink'}`}>
              <span className={`w-9 shrink-0 rounded px-1 py-px text-center text-[10.5px] font-semibold ${i === sel ? 'bg-white/20' : 'bg-sunken text-muted'}`}>
                {KIND_LABEL[it.kind]}
              </span>
              {it.code && <span className={`font-mono text-[12.5px] ${i === sel ? '' : 'text-muted'}`}>{it.code}</span>}
              <span className="min-w-0 truncate text-[13.5px]">{it.name}</span>
            </li>
          ))}
        </ul>
        <div className="flex gap-3 border-t border-line px-3.5 py-2 text-[10.5px] text-faint">
          <span>↑↓ 選擇</span><span>Enter 開啟</span><span>Esc 關閉</span>
          <span className="ml-auto">Ctrl＋K 或 / 隨時叫出</span>
        </div>
      </div>
    </div>
  );
}
