/* 勝率計算機：選自己的牌、（可選）對手的牌、公牌，算出權益。
 *
 * 計算本身在 lib/equity.ts。這裡只管選牌與呈現。
 *
 * 為什麼要有「計算中」狀態：翻牌前雙方已知時會窮舉 C(48,5) = 1,712,304 種公牌，
 * 在手機上大約一秒多。同步跑會讓畫面凍住，看起來像當掉，所以先渲染出
 * 計算中的狀態、讓瀏覽器畫一幀，再開始算。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  RANK_CHARS, SUIT_LABELS, makeCard, cardRank, cardSuit,
  computeEquity, standardError, type EquityResult,
} from '../lib/equity';

type Slot = 'hero' | 'villain' | 'board';

const SLOT_MAX: Record<Slot, number> = { hero: 2, villain: 2, board: 5 };
const SLOT_LABEL: Record<Slot, string> = {
  hero: '你的手牌', villain: '對手手牌', board: '公牌',
};

/** 紅心與方塊用紅色，符合實體牌。 */
const SUIT_COLOR = ['var(--color-ink)', '#c0392b', '#c0392b', 'var(--color-ink)'];

function CardChip({ card, onRemove }: { card: number; onRemove?: () => void }) {
  const s = cardSuit(card);
  return (
    <button
      type="button"
      onClick={onRemove}
      disabled={!onRemove}
      title={onRemove ? '點一下移除' : undefined}
      className="flex h-11 w-9 shrink-0 flex-col items-center justify-center rounded-md
                 border border-line bg-bg font-mono leading-none disabled:opacity-100"
      style={{ color: SUIT_COLOR[s] }}
    >
      <span className="text-[15px] font-bold">{RANK_CHARS[cardRank(card)]}</span>
      <span className="text-[13px]">{SUIT_LABELS[s]}</span>
    </button>
  );
}

function EmptySlot() {
  return (
    <span className="flex h-11 w-9 shrink-0 items-center justify-center rounded-md
                     border border-dashed border-line text-faint">?</span>
  );
}

export function EquityCalculator() {
  const [hero, setHero] = useState<number[]>([]);
  const [villain, setVillain] = useState<number[]>([]);
  const [board, setBoard] = useState<number[]>([]);
  const [slot, setSlot] = useState<Slot>('hero');
  const [result, setResult] = useState<EquityResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const get = (s: Slot) => (s === 'hero' ? hero : s === 'villain' ? villain : board);
  const set = (s: Slot, v: number[]) =>
    (s === 'hero' ? setHero : s === 'villain' ? setVillain : setBoard)(v);

  const used = useMemo(
    () => new Set([...hero, ...villain, ...board]), [hero, villain, board]);

  const pick = (card: number) => {
    if (used.has(card)) return;
    const cur = get(slot);
    if (cur.length >= SLOT_MAX[slot]) return;
    const next = [...cur, card];
    set(slot, next);
    // 填滿就自動跳到下一格，少一次點擊
    if (next.length === SLOT_MAX[slot]) {
      if (slot === 'hero') setSlot('villain');
      else if (slot === 'villain') setSlot('board');
    }
  };

  const remove = (s: Slot, card: number) => {
    set(s, get(s).filter(c => c !== card));
    setSlot(s);
  };

  const boardOk = [0, 3, 4, 5].includes(board.length);
  const ready = hero.length === 2 && (villain.length === 0 || villain.length === 2) && boardOk;

  // 先讓「計算中」畫出來，再開始算 —— 否則主執行緒會被佔住，畫面停在舊結果
  const runId = useRef(0);
  useEffect(() => {
    if (!ready) { setResult(null); setError(null); setBusy(false); return; }
    const id = ++runId.current;
    setBusy(true);
    setError(null);
    const t = setTimeout(() => {
      if (id !== runId.current) return;
      try {
        setResult(computeEquity({
          hero, villain: villain.length === 2 ? villain : null, board,
        }));
      } catch (e) {
        setResult(null);
        setError((e as Error).message);
      } finally {
        if (id === runId.current) setBusy(false);
      }
    }, 30);
    return () => clearTimeout(t);
  }, [hero, villain, board, ready]);

  const se = result ? standardError(result) : 0;
  const street = board.length === 0 ? '翻牌前'
    : board.length === 3 ? '翻牌圈'
      : board.length === 4 ? '轉牌圈' : '河牌圈';

  return (
    <>
      {/* 三個牌格 */}
      <div className="mt-3 space-y-2">
        {(['hero', 'villain', 'board'] as Slot[]).map(s => {
          const cards = get(s);
          const on = slot === s;
          return (
            <div
              key={s}
              className={`rounded-xl border p-2.5 transition-colors
                ${on ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
            >
              <div className="flex items-baseline justify-between">
                <button
                  type="button"
                  onClick={() => setSlot(s)}
                  className="text-[12.5px] font-bold text-ink"
                >
                  {SLOT_LABEL[s]}
                  {s === 'villain' && cards.length === 0 && (
                    <span className="ml-1.5 font-normal text-muted">（不選就是隨機手牌）</span>
                  )}
                  {s === 'board' && (
                    <span className="ml-1.5 font-normal text-muted">
                      {cards.length === 0 ? '（不選就是翻牌前）' : `（${street}）`}
                    </span>
                  )}
                </button>
                {cards.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { set(s, []); setSlot(s); }}
                    className="text-[11.5px] font-semibold text-accent"
                  >
                    清除
                  </button>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {cards.map(c => (
                  <CardChip key={c} card={c} onRemove={() => remove(s, c)} />
                ))}
                {Array.from({ length: Math.max(0, (s === 'board' ? 5 : 2) - cards.length) })
                  .map((_, i) => <EmptySlot key={`e${i}`} />)}
              </div>
            </div>
          );
        })}
      </div>

      {!boardOk && (
        <p className="mt-2 rounded-lg bg-sunken px-3 py-2 text-[12px] text-up">
          公牌只能是 0、3、4 或 5 張。現在有 {board.length} 張，再選 {board.length < 3 ? 3 - board.length : 1} 張才算得出來。
        </p>
      )}

      {/* 選牌盤 */}
      <div className="mt-3 rounded-xl border border-line bg-surface p-2.5">
        <p className="text-[11.5px] font-semibold text-muted">
          點牌加到「{SLOT_LABEL[slot]}」
        </p>
        <div className="mt-1.5 space-y-1">
          {[0, 1, 2, 3].map(suit => (
            <div key={suit} className="grid gap-1" style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}>
              {RANK_CHARS.split('').map((_, i) => {
                // 由大到小排，跟矩陣的方向一致
                const rank = 12 - i;
                const card = makeCard(rank, suit);
                const taken = used.has(card);
                return (
                  <button
                    key={card}
                    type="button"
                    onClick={() => pick(card)}
                    disabled={taken}
                    aria-label={`${RANK_CHARS[rank]}${SUIT_LABELS[suit]}`}
                    className={`flex aspect-[3/4] items-center justify-center rounded
                                border font-mono text-[11px] font-bold leading-none
                                ${taken
                                  ? 'border-line bg-sunken text-faint opacity-40'
                                  : 'border-line bg-bg hover:border-accent'}`}
                    style={{ color: taken ? undefined : SUIT_COLOR[suit] }}
                  >
                    {RANK_CHARS[rank]}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <p className="mt-1 text-[10.5px] text-faint">
          每一列是一個花色：{SUIT_LABELS.map((s, i) => `${s}${['黑桃', '紅心', '方塊', '梅花'][i]}`).join('　')}
        </p>
      </div>

      {/* 結果 */}
      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        {!ready && (
          <p className="py-6 text-center text-[13px] text-muted">
            先選你的兩張手牌，就會開始算。
          </p>
        )}
        {ready && busy && (
          <p className="py-6 text-center text-[13px] text-muted">計算中…</p>
        )}
        {error && <p className="py-6 text-center text-[13px] font-semibold text-up">{error}</p>}

        {ready && !busy && result && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-sm font-bold text-ink">
                {street}　·　{villain.length === 2 ? '對手牌已知' : '對手隨機'}
              </h3>
              <span className="text-[11.5px] text-faint">
                {result.exact
                  ? `窮舉 ${result.iterations.toLocaleString('en-US')} 種情況，結果精確`
                  : `抽樣 ${result.iterations.toLocaleString('en-US')} 次`}
              </span>
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-[34px] leading-none font-bold tabular-nums text-up">
                {result.equity.toFixed(2)}%
              </span>
              {!result.exact && (
                <span className="font-mono text-[13px] tabular-nums text-muted">
                  ± {se.toFixed(2)}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11.5px] text-faint">
              勝率（平手算半勝）
            </p>

            {/* 勝／平／負的長條 */}
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-sunken">
              <div style={{ width: `${(result.win / result.iterations) * 100}%`, background: '#c0392b' }} />
              <div style={{ width: `${(result.tie / result.iterations) * 100}%`, background: '#9aa0a6' }} />
              <div style={{ width: `${(result.lose / result.iterations) * 100}%`, background: '#1f6feb' }} />
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
              {([['勝', result.win, '#c0392b'], ['平', result.tie, '#9aa0a6'],
                 ['負', result.lose, '#1f6feb']] as const).map(([label, n, color]) => (
                <div key={label} className="rounded-lg bg-sunken px-2 py-1.5">
                  <dt className="text-[11px] text-muted">{label}</dt>
                  <dd className="font-mono text-[15px] font-bold tabular-nums" style={{ color }}>
                    {((n / result.iterations) * 100).toFixed(1)}%
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>

      <p className="mt-3 rounded-lg bg-sunken px-3 py-2.5 text-[12px] leading-relaxed text-muted">
        算的是<strong className="text-ink">攤牌時的勝率</strong>：假設牌一路發到河牌、雙方都不棄牌。
        實戰還有下注、棄牌權益、對手範圍 —— 那些不在這個數字裡。
        對手不指定時當成完全隨機的兩張牌，那會低估真實對手的強度
        （會跟你打到底的人通常不是隨機牌）。
      </p>
    </>
  );
}
