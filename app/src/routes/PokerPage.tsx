/* 德州撲克 6 人桌範圍表：開牌（RFI）與面對開牌的應對。
 *
 * 面對 3-bet 的應對是下一步，HandMatrix 吃的是「手牌 -> 動作」的對應，
 * 多一種動作只要多給一個顏色。
 *
 * 範圍的來源與可信度見 lib/ranges.ts 的開頭 —— 一句話：這是與 solver 方向
 * 一致的公開近似範圍，不是任何付費求解器的解算輸出。 */

import { useMemo, useState } from 'react';
import { HandMatrix, type MatrixAction } from '../components/HandMatrix';
import { EquityCalculator } from '../components/EquityCalculator';
import { PokerQuiz } from '../components/PokerQuiz';
import {
  POSITIONS, VS_OPEN, HERO_SPOT_LABEL, resolve, resolveDefense,
} from '../lib/ranges';

/** 開牌用紅色 —— 台股頁的紅代表漲，這裡代表主動出擊，語意不衝突。 */
const OPEN: MatrixAction = { id: 'open', label: '開牌（加注）', color: '#c0392b' };

/* 應對用三色。3-bet 沿用紅色（一樣是主動出擊），跟注用藍色，
   蓋牌不上色 —— 留白的部分就是蓋牌，不必再畫一遍。 */
const THREE_BET: MatrixAction = { id: '3bet', label: '3-bet（再加注）', color: '#c0392b' };
const CALL: MatrixAction = { id: 'call', label: '跟注', color: '#1f6feb' };
const DEFEND_ACTIONS = [THREE_BET, CALL];

type Mode = 'rfi' | 'vs' | 'equity' | 'quiz';

export function PokerPage() {
  const [mode, setMode] = useState<Mode>('rfi');
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
      <h1 className="mt-4 text-lg font-bold text-ink">6 人桌範圍表</h1>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">100bb 現金局。</p>

      <div className="mt-3 flex gap-1.5 rounded-lg bg-sunken p-1">
        {([['rfi', '開牌範圍'], ['vs', '面對開牌'], ['equity', '勝率試算'], ['quiz', '範圍測驗']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            aria-pressed={mode === id}
            className={`h-9 flex-1 rounded-md text-[13px] font-semibold transition-colors ${
              mode === id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'vs' && <VsOpenView />}
      {mode === 'equity' && <EquityCalculator />}
      {mode === 'quiz' && <PokerQuiz />}
      {mode === 'rfi' && <>

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
                面對某個位置的開牌，該跟注還是 3-bet。切到上面的
                「面對開牌」就是那張表。
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

      </>}

      {mode !== 'equity' && (
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
      )}
    </>
  );
}

/* ── 面對開牌 ─────────────────────────────────────────────── */

function VsOpenView() {
  const [vsId, setVsId] = useState('utg');
  const entry = VS_OPEN.find(v => v.vs === vsId) ?? VS_OPEN[0];
  const opener = POSITIONS.find(p => p.id === entry.vs)!;
  const [spot, setSpot] = useState<string>('bb');

  // 換開牌者時，原本選的位置類型可能不存在（BTN 開牌就沒有 ip 那一組）
  const defense = entry.defenses.find(d => d.hero === spot) ?? entry.defenses[0];
  const resolved = useMemo(() => resolveDefense(defense), [defense]);

  const assign = useMemo(() => {
    const m = new Map<string, string>();
    for (const key of resolved.call.hands) m.set(key, 'call');
    for (const key of resolved.threeBet.hands) m.set(key, '3bet');
    return m;
  }, [resolved]);

  const openerRange = opener.rfi ? resolve(opener.rfi) : null;

  return (
    <>
      <div className="mt-3">
        <span className="text-[11.5px] font-semibold text-muted">誰開的牌</span>
        <div className="mt-1 flex gap-1.5 overflow-x-auto pb-1">
          {VS_OPEN.map(v => {
            const on = v.vs === vsId;
            const p = POSITIONS.find(x => x.id === v.vs)!;
            return (
              <button
                key={v.vs}
                type="button"
                onClick={() => {
                  setVsId(v.vs);
                  // 新的開牌者不一定有目前選的位置類型，沒有就退回 BB
                  const next = VS_OPEN.find(x => x.vs === v.vs)!;
                  if (!next.defenses.some(d => d.hero === spot)) setSpot('bb');
                }}
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
      </div>

      <div className="mt-2">
        <span className="text-[11.5px] font-semibold text-muted">你在哪</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {entry.defenses.map(d => {
            const on = d.hero === defense.hero;
            const extra = d.hero === 'ip' && entry.ipPositions.length
              ? `（${entry.ipPositions.join(' / ')}）` : '';
            return (
              <button
                key={d.hero}
                type="button"
                onClick={() => setSpot(d.hero)}
                aria-pressed={on}
                className={`rounded-lg border px-3 py-2 text-[12.5px] font-semibold transition-colors
                  ${on ? 'border-accent bg-accent-soft text-ink'
                       : 'border-line bg-surface text-muted hover:border-accent'}`}
              >
                {HERO_SPOT_LABEL[d.hero]}{extra}
              </button>
            );
          })}
        </div>
      </div>

      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-base font-bold text-ink">
            {opener.label} 開牌
            <span className="mx-1.5 text-muted">→</span>
            {HERO_SPOT_LABEL[defense.hero]}
          </h2>
          <span className="font-mono text-[13px] font-semibold tabular-nums text-accent">
            防守 {resolved.defendPercent.toFixed(1)}%
          </span>
        </div>
        <p className="mt-0.5 text-[11.5px] text-faint">
          {opener.label} 的開牌範圍是 {openerRange ? `${openerRange.percent.toFixed(1)}%` : '—'}
          　·　沒上色的就是蓋牌
        </p>

        <div className="mt-3">
          <HandMatrix actions={DEFEND_ACTIONS} assign={assign} />
        </div>

        <details className="mt-3 border-t border-line pt-2">
          <summary className="cursor-pointer list-none py-1 text-[12.5px] font-semibold text-accent">
            看範圍的文字寫法　▾
          </summary>
          <dl className="mt-1 space-y-1.5">
            <div>
              <dt className="text-[11.5px] font-semibold text-muted">3-bet</dt>
              <dd className="rounded-lg bg-sunken px-2.5 py-1.5 font-mono text-[11.5px]
                             leading-relaxed break-words text-muted">
                {defense.threeBet}
              </dd>
            </div>
            <div>
              <dt className="text-[11.5px] font-semibold text-muted">
                跟注（重疊的部分算 3-bet）
              </dt>
              <dd className="rounded-lg bg-sunken px-2.5 py-1.5 font-mono text-[11.5px]
                             leading-relaxed break-words text-muted">
                {defense.call}
              </dd>
            </div>
          </dl>
        </details>
      </section>
    </>
  );
}
