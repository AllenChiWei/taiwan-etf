/* 13×13 起手牌矩陣。
 *
 * 不只畫「在不在範圍內」，而是畫「這手牌要做什麼動作」——
 * 開牌表只有兩種狀態，但面對 3-bet 的表有 4-bet／跟注／蓋牌三種。
 * 同一個元件吃一份 handKey -> actionId 的對應，所以兩種表共用。
 *
 * 版面：手機 390px 扣掉邊距約 360px，13 欄每格約 26px。字級刻意壓到 9px 並
 * 關掉字距，AKs 三個字元才塞得下；再大就會換行，整張表會垮掉。
 */

import { useMemo } from 'react';
import { RANKS, allHands, combosOfKey } from '../lib/poker';

export interface MatrixAction {
  id: string;
  label: string;
  /** 格子的底色，直接給 CSS 顏色值 —— 這些是撲克語意的顏色，不是主題色 */
  color: string;
  /** 底色上的文字顏色 */
  ink?: string;
}

interface Props {
  actions: MatrixAction[];
  /** handKey（'AA' / 'AKs' / 'AKo'）-> actionId；沒有對應的就是不在範圍內 */
  assign: ReadonlyMap<string, string>;
  /** 顯示每個動作的手數、組合數與百分比 */
  showLegend?: boolean;
}

const OUT_COLOR = 'transparent';

export function HandMatrix({ actions, assign, showLegend = true }: Props) {
  const grid = useMemo(() => allHands(), []);
  const byId = useMemo(
    () => new Map(actions.map(a => [a.id, a])), [actions]);

  /** 每個動作有幾手、幾種組合、佔 1326 的百分比 */
  const stats = useMemo(() => {
    const acc = new Map<string, { hands: number; combos: number }>();
    for (const a of actions) acc.set(a.id, { hands: 0, combos: 0 });
    for (const [key, id] of assign) {
      const s = acc.get(id);
      if (!s) continue;
      s.hands += 1;
      s.combos += combosOfKey(key);
    }
    return acc;
  }, [actions, assign]);

  return (
    <div>
      <div
        className="grid gap-px overflow-hidden rounded-lg border border-line bg-line"
        style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}
        role="table"
        aria-label="起手牌矩陣"
      >
        {grid.map((row, r) =>
          row.map((hand, c) => {
            const id = assign.get(hand.key);
            const action = id ? byId.get(id) : undefined;
            const inRange = Boolean(action);
            return (
              <div
                key={hand.key}
                title={`${hand.key}　${hand.combos} 組合${action ? `　${action.label}` : '　不在範圍'}`}
                className="flex aspect-square items-center justify-center text-center
                           font-mono leading-none tracking-tighter select-none"
                style={{
                  background: action ? action.color : OUT_COLOR,
                  color: action ? (action.ink ?? '#fff') : 'var(--color-faint)',
                  // 對角線（對子）描邊，一眼找得到中軸
                  boxShadow: r === c ? 'inset 0 0 0 1px var(--color-ink)' : undefined,
                  fontSize: 'clamp(7px, 2.1vw, 11px)',
                  fontWeight: inRange ? 700 : 400,
                }}
              >
                {hand.key}
              </div>
            );
          }),
        )}
      </div>

      <p className="mt-1 text-[10.5px] leading-snug text-faint">
        橫豎皆為 {RANKS.join(' ')}　·　對角線是對子，右上同花，左下不同花
      </p>

      {showLegend && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
          {actions.map(a => {
            const s = stats.get(a.id) ?? { hands: 0, combos: 0 };
            return (
              <li key={a.id} className="flex items-center gap-1.5 text-[12px]">
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-sm border border-line"
                  style={{ background: a.color }}
                />
                <span className="font-semibold text-ink">{a.label}</span>
                <span className="font-mono tabular-nums text-muted">
                  {s.hands} 手 · {s.combos} 組合 · {((s.combos / 1326) * 100).toFixed(1)}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
