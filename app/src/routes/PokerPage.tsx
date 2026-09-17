/* 德州撲克 6 人桌開牌範圍表。
 *
 * 目前只有 RFI（無人進池時的開牌範圍）。面對開牌的應對與面對 3-bet 的應對
 * 是下一步，HandMatrix 已經支援多種動作，加資料即可。
 *
 * 範圍的來源與可信度見 lib/ranges.ts 的開頭 —— 一句話：這是與 solver 方向
 * 一致的公開近似範圍，不是任何付費求解器的解算輸出。 */

import { useMemo, useState } from 'react';
import { HandMatrix, type MatrixAction } from '../components/HandMatrix';
import { POSITIONS, resolve } from '../lib/ranges';

/** 開牌用紅色 —— 台股頁的紅代表漲，這裡代表主動出擊，語意不衝突。 */
const OPEN: MatrixAction = { id: 'open', label: '開牌（加注）', color: '#c0392b' };

export function PokerPage() {
  const [posId, setPosId] = useState('utg');
  const position = POSITIONS.find(p => p.id === posId) ?? POSITIONS[0];

  const range = useMemo(
    () => (position.rfi ? resolve(position.rfi) : null), [position.rfi]);

  const assign = useMemo(() => {
    const m = new Map<string, string>();
    if (range) for (const key of range.hands) m.set(key, 'open');
    return m;
  }, [range]);

  return (
    <>
      <h1 className="mt-4 text-lg font-bold text-ink">6 人桌開牌範圍</h1>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        100bb 現金局，無人進池時的開牌範圍（RFI）。
      </p>

      {/* 位置選擇。用按鈕列而不是下拉 —— 六個選項，而且使用者會想來回比較 */}
      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
        {POSITIONS.map(p => {
          const on = p.id === posId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPosId(p.id)}
              aria-pressed={on}
              className={`shrink-0 rounded-lg border px-3 py-2 text-[13px] font-semibold transition-colors
                ${on ? 'border-accent bg-accent-soft text-ink'
                     : 'border-line bg-surface text-muted hover:border-accent'}`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-base font-bold text-ink">
            {position.label}　<span className="text-[13px] font-medium text-muted">{position.name}</span>
          </h2>
          {range && (
            <span className="font-mono text-[13px] font-semibold tabular-nums text-accent">
              {range.percent.toFixed(1)}%　·　{range.combos} / 1326 組合
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11.5px] text-faint">{position.hint}</p>

        <div className="mt-3">
          {range ? (
            <HandMatrix actions={[OPEN]} assign={assign} />
          ) : (
            <div className="rounded-lg bg-sunken px-3 py-6 text-center">
              <p className="text-sm font-semibold text-ink">大盲注沒有開牌範圍</p>
              <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-muted">
                輪到 BB 時如果前面全部蓋牌，你已經放了大盲注，直接免費看翻牌 ——
                沒有「開牌」這個動作，那叫 walk。
                BB 要的是<strong className="text-ink">防守範圍</strong>：
                面對某個位置的開牌，該跟注還是 3-bet。那是另一張表，還沒做。
              </p>
            </div>
          )}
        </div>

        {range && (
          <details className="mt-3 border-t border-line pt-2">
            <summary className="cursor-pointer list-none py-1 text-[12.5px] font-semibold text-accent">
              看範圍的文字寫法　▾
            </summary>
            <code className="mt-1 block rounded-lg bg-sunken px-2.5 py-2 font-mono
                             text-[11.5px] leading-relaxed break-words text-muted">
              {position.rfi}
            </code>
          </details>
        )}
      </section>

      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <h2 className="text-sm font-bold text-ink">這些範圍怎麼來的</h2>
        <div className="mt-1.5 space-y-2 text-[12px] leading-relaxed text-muted">
          <p>
            這是<strong className="text-ink">與求解器方向一致的公開近似範圍</strong>，
            不是任何付費求解器的解算輸出。
          </p>
          <p>
            真正的 solver 會給混合頻率 —— 例如「KTo 有 38% 的時候開牌、62% 蓋牌」。
            那種東西做成表格反而難用，所以這裡每手牌只有開或不開，是把混合策略
            取整成純策略的結果。<strong className="text-ink">核心範圍會一致，邊緣手牌會有出入。</strong>
          </p>
          <p>
            實際該開多寬取決於對手多鬆、後面的人多常 3-bet、桌上的動態如何。
            當成起點，不是標準答案。
          </p>
        </div>
      </section>
    </>
  );
}
