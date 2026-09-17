/* 可打字搜尋的下拉選單。
 *
 * 原生 <select> 在兩百多個選項時很難用：桌機只能靠「從頭開始比對」跳選項，
 * 手機則是系統的滾輪選擇器，完全沒得搜尋。這裡用輸入框 + 過濾清單取代。
 *
 * 刻意不引入 combobox 套件 —— 需要的行為就是過濾、鍵盤上下、Enter 選取、
 * 點外面關閉，加起來一百多行，換不到值得多背的 bundle。
 */

import { useEffect, useMemo, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  /** 顯示用的主要文字，通常是代號 */
  label: string;
  /** 次要文字，通常是名稱。搜尋時一併比對 */
  hint?: string;
  /** 分組標題，例如「個股」「ETF」 */
  group?: string;
}

interface Props {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
}

/** 一次最多畫幾筆。清單超過這個數量時捲動就好，不必全部塞進 DOM。 */
const MAX_VISIBLE = 60;

export function SearchableSelect({
  options, value, onChange, placeholder = '輸入代號或名稱搜尋…',
  id, className = '',
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(
    () => options.find(o => o.value === value), [options, value]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    // 代號開頭命中的排最前面 —— 使用者打「0056」時要的是 0056 本身，
    // 不是名稱裡剛好有那幾個字的其他標的
    const starts: SelectOption[] = [];
    const rest: SelectOption[] = [];
    for (const o of options) {
      const label = o.label.toLowerCase();
      const hint = (o.hint ?? '').toLowerCase();
      if (label.startsWith(q)) starts.push(o);
      else if (label.includes(q) || hint.includes(q)) rest.push(o);
    }
    return [...starts, ...rest];
  }, [options, query]);

  const shown = matches.slice(0, MAX_VISIBLE);

  useEffect(() => { setActive(0); }, [query]);

  // 點到元件外面就關起來。用 pointerdown 而不是 blur —— blur 在手機上
  // 點清單項目的瞬間就觸發，會在選取生效前把清單關掉。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // 鍵盤移動時把選取項捲進視野
  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (o: SelectOption) => {
    onChange(o.value);
    // 不必另外處理「選完要不要清空」：display 是從 value 推的，
    // 呼叫端把 value 留成空字串（例如退休頁的「選一檔帶入」）就自然是空的。
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive(i => {
        const n = shown.length;
        if (!n) return 0;
        return e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
      });
    } else if (e.key === 'Enter') {
      if (open && shown[active]) {
        e.preventDefault();
        choose(shown[active]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const inputCls =
    'h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-ink '
    + 'focus:border-accent focus:ring-3 focus:ring-accent-soft focus:outline-none';

  // 沒在打字時顯示已選的項目，讓輸入框同時扮演「目前選什麼」的角色
  const display = open ? query
    : (selected ? `${selected.label}　${selected.hint ?? ''}`.trim() : query);

  let lastGroup: string | undefined;

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        value={display}
        placeholder={placeholder}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        // focus 與 pointerdown 都會展開。只掛 focus 不夠 —— 已經有焦點時再點
        // 一次不會再觸發 focus，使用者按了會覺得沒反應；而且部分手機瀏覽器
        // 在虛擬鍵盤收合後的 focus 行為並不一致。
        onFocus={() => { setQuery(''); setOpen(true); }}
        onPointerDown={() => { setQuery(''); setOpen(true); }}
        onKeyDown={onKeyDown}
        className={inputCls}
      />

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto overscroll-contain
                     rounded-lg border border-line bg-surface shadow-lg"
        >
          {shown.length === 0 && (
            <li className="px-3 py-3 text-[13px] text-muted">找不到「{query}」</li>
          )}
          {shown.map((o, i) => {
            const head = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <li key={o.value}>
                {head && (
                  <div className="sticky top-0 bg-sunken px-3 py-1 text-[11px]
                                  font-semibold text-muted">{head}</div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onPointerDown={e => { e.preventDefault(); choose(o); }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-baseline gap-2 px-3 py-2.5 text-left
                    ${i === active ? 'bg-accent-soft' : ''}`}
                >
                  <span className="font-mono text-[13.5px] font-bold text-ink">{o.label}</span>
                  <span className="truncate text-[13px] text-muted">{o.hint}</span>
                </button>
              </li>
            );
          })}
          {matches.length > shown.length && (
            <li className="px-3 py-2 text-[11.5px] text-faint">
              還有 {matches.length - shown.length} 筆，再打幾個字縮小範圍
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
