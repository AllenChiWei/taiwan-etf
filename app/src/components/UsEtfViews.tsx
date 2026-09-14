/* 美股 ETF 的表格（桌機）與卡片（手機）。
   刻意不跟台股那組共用：欄位不同（沒有保管銀行／配息／殖利率，多了成交金額），
   硬要抽象成同一個元件只會讓兩邊都變難讀。 */

import { useLayoutEffect, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';

import type { UsEtf, UsNumericKey } from '../types';
import { returnTone, TONE_CLASS } from '../lib/format';
import { FavButton } from './FavButton';

/** 交易所代碼 -> 人看得懂的名字。來自 Nasdaq Trader 的 Listing Exchange 欄位。 */
const EXCHANGE: Record<string, string> = {
  A: 'NYSE American',
  N: 'NYSE',
  P: 'NYSE Arca',
  Q: 'Nasdaq',
  Z: 'Cboe BZX',
  V: 'IEX',
};

export const exchangeName = (code: string) => EXCHANGE[code] ?? code;

/** Nasdaq 自己的 ETF 頁面 —— 我們的名單本來就來自他們的官方檔案。 */
export const nasdaqUrl = (code: string) =>
  `https://www.nasdaq.com/market-activity/etf/${code.toLowerCase()}`;

/** 成交金額縮寫：$34.4B / $512M / $15.0M */
export function formatAdv(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export const US_COLUMNS: Array<{ key: UsNumericKey; label: string }> = [
  { key: 'adv', label: '日均成交額' },
  { key: 'r3', label: '近3月' },
  { key: 'r6', label: '近6月' },
  { key: 'r12', label: '近1年' },
  { key: 'r36', label: '近3年' },
  { key: 'r60', label: '近5年' },
];

const RETURN_KEYS: UsNumericKey[] = ['r3', 'r6', 'r12', 'r36', 'r60'];

/**
 * 清單距離文件頂端的距離，給 useWindowVirtualizer 當 scrollMargin。
 *
 * 不能在 render 階段讀 ref.current.offsetTop —— 第一次 render 時 ref 還是 null，
 * 值會永遠停在 0，於是虛擬捲動以為第一列在 y=0，捲到底時看不到最後幾十列。
 * 必須在 layout effect 量測，並在版面變動時重新量（上方的說明區塊會換行）。
 */
function useScrollMargin(ref: React.RefObject<HTMLElement | null>): number {
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMargin(el.getBoundingClientRect().top + window.scrollY);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, [ref]);
  return margin;
}

/** 手機沒有表頭可點，用一排按鈕代替 —— 與台股清單同樣的操作方式。 */
export function UsSortChips({ sortKey, sortDir, onSort }: {
  sortKey: UsNumericKey | null;
  sortDir: 'asc' | 'desc';
  onSort: (k: UsNumericKey) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">排序</span>
      {US_COLUMNS.map(c => {
        const active = sortKey === c.key;
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            onClick={() => onSort(c.key)}
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors
              ${active
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-line bg-surface text-accent'}`}
          >
            {c.key === 'adv' ? '成交額' : c.label}
            <span aria-hidden="true" className="ml-0.5">
              {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface ViewProps {
  rows: UsEtf[];
  sortKey: UsNumericKey | null;
  sortDir: 'asc' | 'desc';
  onSort: (key: UsNumericKey) => void;
  isFav: (code: string) => boolean;
  onToggleFav: (code: string) => void;
}

export function UsEtfTable({ rows, sortKey, sortDir, onSort, isFav, onToggleFav }: ViewProps) {
  const th = 'sticky top-0 z-10 whitespace-nowrap border-b border-line bg-sunken '
           + 'px-2.5 py-2.5 text-left text-xs font-bold text-muted';
  const td = 'border-b border-line px-2.5 py-2.5 align-middle';

  // 只渲染看得到的列。全部 3,690 檔一次進 DOM 是 92,318 個節點，
  // 手機上光是切換顯示範圍就要 1.6 秒。
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin(containerRef);
  const virt = useWindowVirtualizer({
    count: rows.length,
    // 實測中位數 53px（padding 10 + 內容）。估太低會讓總高度隨捲動變高，
    // 一次跳到底就會落在末端之前。
    estimateSize: () => 53,
    overscan: 10,
    scrollMargin,
  });
  const items = virt.getVirtualItems();
  // 用上下兩個佔位列撐開捲軸，這樣 <table> 的語意與黏頂表頭都不受影響
  const padTop = items.length ? items[0].start - scrollMargin : 0;
  const padBottom = items.length
    ? virt.getTotalSize() - (items[items.length - 1].end - scrollMargin)
    : 0;

  return (
    <div ref={containerRef} className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={`${th} w-10`} />
            <th className={th}>代號</th>
            <th className={th}>名稱</th>
            <th className={th}>交易所</th>
            {US_COLUMNS.map(c => {
              const active = sortKey === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  tabIndex={0}
                  onClick={() => onSort(c.key)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(c.key); }
                  }}
                  className={`${th} cursor-pointer text-right select-none hover:text-accent
                              ${active ? 'text-accent' : ''}`}
                  title="點擊排序，再點一次反向"
                >
                  {c.label}
                  <span aria-hidden="true" className={active ? 'ml-1' : 'ml-1 opacity-35'}>
                    {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </th>
              );
            })}
            <th className={th}>詳情</th>
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && <tr style={{ height: padTop }} aria-hidden="true" />}
          {items.map(vi => {
            const e = rows[vi.index];
            return (
            <tr key={e.code} data-index={vi.index} ref={virt.measureElement}
                className="last:[&>td]:border-b-0 hover:bg-hover">
              <td className={td}>
                <FavButton code={e.code} active={isFav(e.code)} onToggle={onToggleFav} />
              </td>
              <td className={td}>
                <a href={nasdaqUrl(e.code)} target="_blank" rel="noopener noreferrer"
                   className="font-mono font-bold text-accent hover:underline">{e.code}</a>
              </td>
              <td className={`${td} font-medium`}>{e.name}</td>
              <td className={`${td} text-xs text-muted`}>{exchangeName(e.exch)}</td>

              <td className={`${td} tabular text-right font-mono text-muted`}>{formatAdv(e.adv)}</td>
              {RETURN_KEYS.map(k => (
                <td key={k}
                    className={`${td} tabular text-right font-mono ${TONE_CLASS[returnTone(e[k] as string)]}`}>
                  {e[k] as string}
                </td>
              ))}

              <td className={td}>
                <a href={nasdaqUrl(e.code)} target="_blank" rel="noopener noreferrer"
                   className="inline-block rounded-md border border-line px-2.5 py-1 text-xs font-semibold
                              whitespace-nowrap text-accent hover:border-accent hover:bg-accent-soft">
                  Nasdaq
                </a>
              </td>
            </tr>
            );
          })}
          {padBottom > 0 && <tr style={{ height: padBottom }} aria-hidden="true" />}
        </tbody>
      </table>
    </div>
  );
}

export function UsEtfCards({ rows, isFav, onToggleFav }: Omit<ViewProps, 'sortKey' | 'sortDir' | 'onSort'>) {
  // 手機上更需要虛擬捲動：卡片比表格列高，3,690 張的記憶體壓力最大。
  // 高度用 measureElement 實測，因為名稱換行與否會讓卡片差一行的高度。
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin(containerRef);
  const virt = useWindowVirtualizer({
    count: rows.length,
    // 實測中位數 255px；名稱換行的卡片會到 277px，交給 measureElement 修正。
    estimateSize: () => 255,
    overscan: 6,
    scrollMargin,
  });
  const items = virt.getVirtualItems();

  return (
    <div ref={containerRef}>
      <ul className="relative" style={{ height: virt.getTotalSize() }}>
        {items.map(vi => {
          const e = rows[vi.index];
          return (
        <li
          key={e.code}
          data-index={vi.index}
          ref={virt.measureElement}
          className="absolute top-0 left-0 w-full pb-2"
          style={{ transform: `translateY(${vi.start - scrollMargin}px)` }}
        >
          <div className="rounded-xl border border-line bg-surface p-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <a href={nasdaqUrl(e.code)} target="_blank" rel="noopener noreferrer"
               className="font-mono text-base font-bold text-accent">{e.code}</a>
            <div className="flex items-center gap-2">
              <span className="tabular font-mono text-xs text-muted">{formatAdv(e.adv)}</span>
              <FavButton code={e.code} active={isFav(e.code)} onToggle={onToggleFav} />
            </div>
          </div>

          <p className="mt-0.5 text-[15px] font-semibold text-ink">{e.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted">{exchangeName(e.exch)}</p>

          <dl className="mt-2.5 grid grid-cols-3 gap-x-2 gap-y-2 border-t border-line pt-2">
            {RETURN_KEYS.map(k => {
              const label = US_COLUMNS.find(c => c.key === k)!.label;
              const value = e[k] as string;
              return (
                <div key={k}>
                  <dt className="text-[10.5px] font-semibold whitespace-nowrap text-faint">{label}</dt>
                  <dd className={`tabular font-mono text-sm ${TONE_CLASS[returnTone(value)]}`}>{value}</dd>
                </div>
              );
            })}
          </dl>

          <a href={nasdaqUrl(e.code)} target="_blank" rel="noopener noreferrer"
             className="mt-2.5 block rounded-md border border-line py-2 text-center text-[13px]
                        font-semibold text-accent hover:border-accent hover:bg-accent-soft">
            Nasdaq 詳情
          </a>
          </div>
        </li>
          );
        })}
      </ul>
    </div>
  );
}
