import type { Section, SectionId } from '../types';

/** 槓桿卡代表三個分區的總和，點它就篩到主要的那一個。 */
const LEVERAGED_GROUP: SectionId[] = ['cat-leveraged', 'cat-futures', 'cat-leveraged-futures'];

interface Props {
  sections: Section[];
  total: number;
  activeSec: string;
  onPick: (sec: string) => void;
}

export function StatCards({ sections, total, activeSec, onPick }: Props) {
  const count = (id: SectionId) => sections.find(s => s.id === id)?.count ?? 0;
  const leveraged = LEVERAGED_GROUP.reduce((n, id) => n + count(id), 0);

  const cards: Array<{ label: string; value: number; sec?: SectionId }> = [
    { label: '總計 ETF', value: total },
    { label: '台股 ETF', value: count('cat-domestic'), sec: 'cat-domestic' },
    { label: '海外 ETF', value: count('cat-foreign'), sec: 'cat-foreign' },
    { label: '債券 ETF', value: count('cat-bond'), sec: 'cat-bond' },
    { label: '主動 ETF', value: count('cat-active'), sec: 'cat-active' },
    { label: '槓桿/期貨', value: leveraged, sec: 'cat-leveraged' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map(c => {
        const active = c.sec !== undefined && c.sec === activeSec;
        const common = 'rounded-xl border px-3 py-3 text-center text-xs leading-tight transition-colors';
        const body = (
          <>
            <strong className="tabular block font-mono text-2xl font-bold tracking-tight text-ink">
              {c.value}
            </strong>
            {c.label}
          </>
        );

        // 總計卡沒有對應的篩選，維持非互動
        if (!c.sec) {
          return (
            <div key={c.label} className={`${common} col-span-2 border-line bg-surface text-muted sm:col-span-1`}>
              {body}
            </div>
          );
        }
        return (
          <button
            key={c.label}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(active ? '' : c.sec!)}
            className={`${common} cursor-pointer
              ${active ? 'border-accent bg-accent-soft text-ink' : 'border-line bg-surface text-muted hover:border-accent'}`}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
