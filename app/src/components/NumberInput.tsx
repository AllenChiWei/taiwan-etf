/* 數字輸入框：可以被清空，而且不會留下刪不掉的 0。
 *
 * 原本的寫法是 value={數字} + onChange={Number(輸入) || 0}：欄位一被清空，state
 * 立刻變回 0，React 又把 0 寫回畫面，於是那個 0 怎麼刪都在，接著打字就變成
 * 「040」「01000」。使用者實際回報的就是這個。
 *
 * 改成記住使用者**打的字串**，數值另外從字串推出來 —— 空字串就讓它是空的，
 * 呼叫端收到 0（0 股本來就不是有效的持股，送出按鈕本來就是灰的）。
 */

import { useEffect, useState } from 'react';

interface Props {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  /** 框內右側的單位字，例如「股」「元」 */
  suffix?: string;
  className?: string;
  'aria-label'?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  /** 整數欄位（股數）用 numeric，允許小數的（金額、%）用 decimal */
  decimal?: boolean;
}

export function NumberInput({
  value, onChange, step = 1, min = 0, suffix, className = '',
  onKeyDown, autoFocus, decimal = false, ...rest
}: Props) {
  const [text, setText] = useState(() => (Number.isFinite(value) ? String(value) : ''));

  // 外面改了值（例如按「修改」帶入目前股數）才同步。用 updater 形式讀 text，
  // 才不必把 text 放進 deps —— 放進去會在每次打字後又把自己重設一次。
  useEffect(() => {
    setText(prev => (Number(prev) === value ? prev
      : Number.isFinite(value) ? String(value) : ''));
  }, [value]);

  return (
    <span className="relative block">
      <input
        type="number"
        inputMode={decimal ? 'decimal' : 'numeric'}
        value={text}
        min={min}
        step={step}
        onChange={e => {
          // 前導 0 直接去掉：手機上要把 1000 改成 40，刪到剩 0 再打 4 就會是「04」
          const cleaned = e.target.value.replace(/^0+(?=\d)/, '');
          setText(cleaned);
          onChange(cleaned === '' ? 0 : Number(cleaned));
        }}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        className={`${className} ${suffix ? 'pr-8' : ''}`}
        {...rest}
      />
      {suffix && (
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2
                         text-[13px] text-faint">{suffix}</span>
      )}
    </span>
  );
}
