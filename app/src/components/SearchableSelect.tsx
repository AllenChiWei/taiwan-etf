/* 可打字搜尋的下拉選單。
 *
 * 原生 <select> 在兩百多個選項時很難用：桌機只能靠「從頭開始比對」跳選項，
 * 手機則是系統的滾輪選擇器，完全沒得搜尋。這裡用輸入框 + 過濾清單取代。
 *
 * 刻意不引入 combobox 套件 —— 需要的行為就是過濾、鍵盤上下、Enter 選取、
 * 點外面關閉，加起來一百多行，換不到值得多背的 bundle。
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

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

/** 清單最高幾 px；放不下時會被實際可用空間再壓低。 */
const MAX_LIST_PX = 264;
/** 往下只剩不到這麼高就改成往上開。 */
const MIN_LIST_PX = 168;

export function SearchableSelect({
  options, value, onChange, placeholder = '輸入代號或名稱搜尋…',
  id, className = '',
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /** 清單往上還是往下開、最多多高 —— 手機叫出鍵盤後往下常常只剩幾十 px */
  const [drop, setDrop] = useState({ up: false, max: MAX_LIST_PX });
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const autoId = useId().replace(/:/g, '');
  const optionId = (i: number) => `${autoId}-opt-${i}`;

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

  // 量往下還剩多少空間。手機叫出虛擬鍵盤後可視高度少掉一半，清單若還是固定
  // 往下開就整塊落在鍵盤底下 —— 看起來就是「下拉打不開、拉不動」。
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = boxRef.current?.getBoundingClientRect();
      if (!r) return;
      // 只有 visualViewport 知道鍵盤佔掉多少；沒有就退回 innerHeight
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const below = vh - r.bottom - 8;
      const above = r.top - 8;
      const up = below < MIN_LIST_PX && above > below;
      setDrop({
        up,
        max: Math.max(MIN_LIST_PX, Math.min(MAX_LIST_PX, up ? above : below)),
      });
    };
    measure();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      vv?.removeEventListener('resize', measure);
      vv?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  // 鍵盤移動時把選取項捲進視野。滑鼠滑過或手指捲動造成的 active 變化不要插手，
  // 否則手指才剛把清單拉開就被捲回去。
  const keyboardMove = useRef(false);
  useEffect(() => {
    if (!open || !keyboardMove.current) return;
    keyboardMove.current = false;
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (o: SelectOption) => {
    onChange(o.value);
    // 不必另外處理「選完要不要清空」：display 是從 value 推的，
    // 呼叫端把 value 留成空字串（例如退休頁的「選一檔帶入」）就自然是空的。
    setQuery('');
    setOpen(false);
  };

  // 只在「從關到開」時清空查詢字串。每次點輸入框都清的話，使用者在手機上
  // 點一下想移動游標，打好的字就整串不見 —— 那正是輸入卡卡的來源。
  const openList = useCallback(() => {
    setOpen(prev => {
      if (!prev) setQuery('');
      return true;
    });
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openList(); return; }
      keyboardMove.current = true;
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
  const selectedText = selected ? `${selected.label}　${selected.hint ?? ''}`.trim() : '';
  const display = open ? query : (selectedText || query);

  let lastGroup: string | undefined;

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={`${autoId}-list`}
        aria-activedescendant={open && shown[active] ? optionId(active) : undefined}
        autoComplete="off"
        value={display}
        // 展開後輸入框是空的，用 placeholder 留住「原本選的是哪一檔」，
        // 否則點一下會像是把選擇弄丟了
        placeholder={open && selectedText ? selectedText : placeholder}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        // focus 與 pointerdown 都會展開。只掛 focus 不夠 —— 已經有焦點時再點
        // 一次不會再觸發 focus，使用者按了會覺得沒反應；而且部分手機瀏覽器
        // 在虛擬鍵盤收合後的 focus 行為並不一致。
        onFocus={openList}
        onPointerDown={openList}
        onKeyDown={onKeyDown}
        className={inputCls}
      />

      {open && (
        <ul
          ref={listRef}
          id={`${autoId}-list`}
          role="listbox"
          style={{ maxHeight: drop.max }}
          className={'absolute z-20 w-full overflow-y-auto overscroll-contain rounded-lg '
            + 'border border-line bg-surface shadow-lg '
            + (drop.up ? 'bottom-full mb-1' : 'top-full mt-1')}
        >
          {shown.length === 0 && (
            <li className="px-3 py-3 text-[13px] text-muted">找不到「{query}」</li>
          )}
          {shown.map((o, i) => {
            const head = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <li key={o.value} role="presentation">
                {head && (
                  <div className="sticky top-0 bg-sunken px-3 py-1 text-[11px]
                                  font-semibold text-muted">{head}</div>
                )}
                {/* 刻意不用 <button>：按鈕一被按到就搶走焦點，手機鍵盤跟著收合、
                    版面在 pointerdown 與 click 之間位移，點擊就落到別的項目上。
                    選取改走 onClick —— 觸控時拉動捲軸瀏覽器本來就不產生 click，
                    所以「拉得動」跟「點得到」不必自己分辨。 */}
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={o.value === value}
                  onClick={() => choose(o)}
                  // 只有滑鼠按下才擋預設行為（避免輸入框失焦）。觸控不能擋：
                  // 擋掉的同時也取消了捲動手勢，清單就拉不動了。
                  onPointerDown={e => { if (e.pointerType === 'mouse') e.preventDefault(); }}
                  onMouseEnter={() => setActive(i)}
                  className={'flex w-full cursor-pointer items-baseline gap-2 px-3 py-2.5 '
                    + 'text-left ' + (i === active ? 'bg-accent-soft' : '')}
                >
                  <span className="font-mono text-[13.5px] font-bold text-ink">{o.label}</span>
                  <span className="truncate text-[13px] text-muted">{o.hint}</span>
                </div>
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
