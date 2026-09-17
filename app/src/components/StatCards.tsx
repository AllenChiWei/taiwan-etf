/* 頁首的統計卡，同時也是快速篩選鈕。
 *
 * 卡片分成兩種維度，刻意不互斥：
 *
 *   分區（台股／海外／債券／槓桿）—— 一檔 ETF 只屬於其中一個
 *   類型（主動）              —— 跨分區的屬性
 *
 * 所以「台股 ETF」與「主動 ETF」可以同時按下去，得到主動的台股 ETF。
 * 一檔主動海外 ETF 同時算在「海外 ETF」與「主動 ETF」兩張卡的數字裡 ——
 * 這些數字相加不等於總計，那是對的，不是 bug。
 */

import type { Etf, Section, SectionId } from '../types';

/** 槓桿卡代表三個分區的總和，點它就篩到主要的那一個。 */
const LEVERAGED_GROUP: SectionId[] = ['cat-leveraged', 'cat-futures', 'cat-leveraged-futures'];

interface Props {
  sections: Section[];
  etfs: readonly Etf[];
  total: number;
  activeSec: string;
  activeAct: string;
  onPickSec: (sec: string) => void;
  onPickAct: (act: string) => void;
  /** 一次清掉兩個維度。分開呼叫 onPickSec('') 與 onPickAct('') 會送出兩次
      導航，第二次可能讀到還沒更新的網址參數而把第一次的結果蓋回去。 */
  onClearAll: () => void;
}

type Card =
  | { label: string; value: number; kind: 'all' }
  | { label: string; value: number; kind: 'sec'; value2: SectionId }
  | { label: string; value: number; kind: 'act' };

export function StatCards({
  sections, etfs, total, activeSec, activeAct, onPickSec, onPickAct, onClearAll,
}: Props) {
  const count = (id: SectionId) => sections.find(s => s.id === id)?.count ?? 0;
  const leveraged = LEVERAGED_GROUP.reduce((n, id) => n + count(id), 0);
  const activeCount = etfs.reduce((n, e) => n + (e.act ? 1 : 0), 0);

  const cards: Card[] = [
    { label: '全部 ETF', value: total, kind: 'all' },
    { label: '台股 ETF', value: count('cat-domestic'), kind: 'sec', value2: 'cat-domestic' },
    { label: '海外 ETF', value: count('cat-foreign'), kind: 'sec', value2: 'cat-foreign' },
    { label: '債券 ETF', value: count('cat-bond'), kind: 'sec', value2: 'cat-bond' },
    { label: '槓桿/期貨', value: leveraged, kind: 'sec', value2: 'cat-leveraged' },
    { label: '主動 ETF', value: activeCount, kind: 'act' },
  ];

  const common = 'rounded-xl border px-3 py-3 text-center text-xs leading-tight transition-colors';

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map(c => {
        const body = (
          <>
            <strong className="tabular block font-mono text-2xl font-bold tracking-tight text-ink">
              {c.value}
            </strong>
            {c.label}
          </>
        );

        // 「全部」不是第三個維度，而是把兩個維度都清掉。它原本是不能點的
        // 純顯示卡，但使用者按了沒反應會以為壞掉 —— 想回到完整清單時，
        // 最直覺的動作就是按那顆最大的數字。
        if (c.kind === 'all') {
          const on = !activeSec && !activeAct;
          return (
            <button
              key={c.label}
              type="button"
              aria-pressed={on}
              onClick={onClearAll}
              className={`${common} col-span-2 cursor-pointer sm:col-span-1
                ${on
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-line bg-surface text-muted hover:border-accent'}`}
            >
              {body}
            </button>
          );
        }

        const isSec = c.kind === 'sec';
        const on = isSec ? c.value2 === activeSec : activeAct === 'active';

        return (
          <button
            key={c.label}
            type="button"
            aria-pressed={on}
            // 再按一次就取消，兩個維度各自獨立 —— 按下「主動」不會清掉「債券」
            onClick={() => (isSec
              ? onPickSec(on ? '' : c.value2)
              : onPickAct(on ? '' : 'active'))}
            className={`${common} cursor-pointer
              ${on
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-line bg-surface text-muted hover:border-accent'}`}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
