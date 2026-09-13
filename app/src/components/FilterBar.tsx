import { useEffect, useId, useRef, useState } from 'react';
import type { EtfDataset, Filters } from '../types';
import type { SortSpec } from '../lib/filters';
import { activeFilterCount } from '../lib/filters';
import { NUMERIC_LABEL } from '../lib/format';

interface Props {
  data: EtfDataset;
  filters: Filters;
  sort: SortSpec | null;
  onChange: (patch: Partial<Filters>) => void;
  onSortChange: (sort: SortSpec | null) => void;
  onReset: () => void;
}

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '預設（依代號）' },
  { value: 'yield-desc', label: '殖利率 高→低' },
  { value: 'yield-asc', label: '殖利率 低→高' },
  { value: 'r3-desc', label: '近3月 高→低' },
  { value: 'r6-desc', label: '近6月 高→低' },
  { value: 'r12-desc', label: '近1年 高→低' },
  { value: 'r36-desc', label: '近3年 高→低' },
];

export function FilterBar({ data, filters, sort, onChange, onSortChange, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters.q);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  // 搜尋去抖：每個字都更新網址會讓「上一頁」變得沒用，也會讓 359 列重算太頻繁
  useEffect(() => {
    if (draft === filters.q) return;
    const t = setTimeout(() => onChange({ q: draft }), 150);
    return () => clearTimeout(t);
  }, [draft, filters.q, onChange]);

  // 外部（例如「清除全部」或從網址還原）改動時同步回輸入框
  useEffect(() => { setDraft(filters.q); }, [filters.q]);

  // 「/」聚焦搜尋、Esc 清除 —— 桌機使用者的習慣
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLSelectElement;
      if (ev.key === '/' && !typing) {
        ev.preventDefault();
        searchRef.current?.focus();
      } else if (ev.key === 'Escape' && el === searchRef.current) {
        setDraft('');
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const n = activeFilterCount(filters, sort);
  const sortValue = sort ? `${sort.key}-${sort.dir}` : '';

  const selectCls = 'h-10 w-full cursor-pointer rounded-lg border border-line bg-surface '
                  + 'px-2.5 text-[15px] text-ink focus:border-accent focus:outline-none';
  const labelCls = 'text-[11.5px] font-semibold text-muted';

  return (
    <div className="sticky top-0 z-20 -mx-3 mt-4 border-b border-line bg-bg px-3 py-2.5 sm:-mx-4 sm:px-4">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm opacity-60">
            🔍
          </span>
          <input
            ref={searchRef}
            type="search"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="搜尋代號、名稱或保管銀行…"
            aria-label="搜尋 ETF"
            autoComplete="off"
            /* 16px 是 iOS Safari 聚焦時不自動放大頁面的最低字級 */
            className="h-11 w-full rounded-lg border border-line bg-surface pr-9 pl-9 text-base
                       text-ink focus:border-accent focus:ring-3 focus:ring-accent-soft focus:outline-none
                       [&::-webkit-search-cancel-button]:hidden"
          />
          {draft && (
            <button
              type="button"
              aria-label="清除搜尋"
              onClick={() => { setDraft(''); searchRef.current?.focus(); }}
              className="absolute top-1/2 right-1.5 grid h-7 w-7 -translate-y-1/2 place-items-center
                         rounded-full text-xs text-muted hover:bg-hover hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(o => !o)}
          className={`flex h-11 items-center gap-1.5 rounded-lg border px-4 text-sm font-semibold
                      whitespace-nowrap transition-colors
                      ${open ? 'border-accent text-accent' : 'border-line text-ink hover:bg-hover'}`}
        >
          篩選
          {n > 0 && (
            <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent
                             px-1.5 font-mono text-[11px] font-bold text-accent-ink">
              {n}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div id={panelId} className="grid grid-cols-1 gap-2.5 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="f-cust">保管銀行</label>
            <select id="f-cust" className={selectCls} value={filters.cust}
                    onChange={e => onChange({ cust: e.target.value })}>
              <option value="">全部</option>
              {data.custodians.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="f-freq">配息頻率</label>
            <select id="f-freq" className={selectCls} value={filters.freq}
                    onChange={e => onChange({ freq: e.target.value })}>
              <option value="">全部</option>
              {data.frequencies.map(f => (
                <option key={f} value={f}>{f === '—' ? '— (不配息)' : f}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="f-sec">分類</label>
            <select id="f-sec" className={selectCls} value={filters.sec}
                    onChange={e => onChange({ sec: e.target.value })}>
              <option value="">全部</option>
              {data.sections.map(s => (
                <option key={s.id} value={s.id}>{s.title}（{s.count}）</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="f-sort">排序</label>
            <select
              id="f-sort"
              className={selectCls}
              value={sortValue}
              onChange={e => {
                const v = e.target.value;
                if (!v) return onSortChange(null);
                const [key, dir] = v.split('-') as [keyof typeof NUMERIC_LABEL, 'asc' | 'desc'];
                onSortChange({ key, dir });
              }}
            >
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <button
            type="button"
            onClick={() => { setDraft(''); onReset(); }}
            className="h-10 rounded-lg border border-line px-4 text-sm font-semibold
                       text-muted hover:bg-hover sm:col-span-2 lg:col-span-4 lg:justify-self-start"
          >
            清除全部
          </button>
        </div>
      )}
    </div>
  );
}
