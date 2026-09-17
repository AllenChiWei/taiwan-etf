import { useEffect, useRef, useState, useMemo } from 'react';
import type { EtfDataset, Filters, NumericKey } from '../types';
import type { SortSpec } from '../lib/filters';

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
  { value: 'r60-desc', label: '近5年 高→低' },
];

export function FilterBar({ data, filters, sort, onChange, onSortChange, onReset }: Props) {
  const [draft, setDraft] = useState(filters.q);
  const searchRef = useRef<HTMLInputElement>(null);

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

  const sortValue = sort ? `${sort.key}-${sort.dir}` : '';
  const activeCount = useMemo(
    () => data.etfs.reduce((n, e) => n + (e.act ? 1 : 0), 0), [data.etfs]);

  const hasAny = Boolean(
    filters.q || filters.cust || filters.freq || filters.sec || filters.act || sort);

  const selectCls = 'h-10 w-full cursor-pointer rounded-lg border border-line bg-surface '
                  + 'px-2.5 text-[15px] text-ink focus:border-accent focus:outline-none';
  const labelCls = 'text-[11.5px] font-semibold text-muted';

  return (
    // 所有控制項一律顯示（不藏在按鈕後面）。
    // 手機上不黏頂：搜尋 + 四個選單疊起來有五排，黏著會吃掉半個螢幕，
    // 需要時用右下角的「回到頂部」回來就好。桌機只佔兩排，黏頂很有用。
    <div className="-mx-3 mt-4 border-b border-line bg-bg px-3 py-2.5
                    sm:-mx-4 sm:px-4 md:sticky md:top-0 md:z-20">
      <div className="relative">
        <span aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm opacity-60">
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

      <div className="grid grid-cols-1 gap-2.5 pt-2.5 sm:grid-cols-2 lg:grid-cols-[repeat(5,1fr)_auto] lg:items-end">
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
          <label className={labelCls} htmlFor="f-act">類型</label>
          <select id="f-act" className={selectCls} value={filters.act}
                  onChange={e => onChange({ act: e.target.value })}>
            <option value="">全部</option>
            <option value="active">主動式（{activeCount}）</option>
            <option value="passive">被動式（{data.etfs.length - activeCount}）</option>
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
              const [key, dir] = v.split('-') as [NumericKey, 'asc' | 'desc'];
              onSortChange({ key, dir });
            }}
          >
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <button
          type="button"
          onClick={() => { setDraft(''); onReset(); }}
          disabled={!hasAny}
          className="h-10 rounded-lg border border-line px-4 text-sm font-semibold text-muted
                     transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-40
                     disabled:hover:bg-transparent sm:col-span-2 lg:col-span-1"
        >
          清除
        </button>
      </div>
    </div>
  );
}
