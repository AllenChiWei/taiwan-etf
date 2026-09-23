/* 勝率計算機：選自己的牌、對手（指定手牌／隨機／範圍）、公牌，算出權益；
 * 下面接「跟注值不值」與「聽牌出路」。
 *
 * 計算本身在 lib/equity.ts 與 lib/pokerTools.ts。這裡只管選牌與呈現。
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
import {
  requiredEquity, callEv, countOuts, hitChance, ruleOfTwoFour, rangeEquity,
  type RangeEquity,
} from '../lib/pokerTools';
import { parseRange } from '../lib/poker';
import { POSITIONS, VS_OPEN, HERO_SPOT_LABEL, resolve, resolveDefense } from '../lib/ranges';

type VillainMode = 'cards' | 'random' | 'range';

/** 範圍的選項：各位置的開牌範圍，以及面對開牌時的 3-bet／跟注範圍。 */
const RANGE_PRESETS: { group: string; items: { id: string; label: string; hands: Set<string> }[] }[] = [
  {
    group: '開牌範圍',
    items: POSITIONS.filter(p => p.rfi).map(p => {
      const r = resolve(p.rfi!);
      return { id: `rfi-${p.id}`, label: `${p.label} 開牌（${r.percent.toFixed(1)}%）`, hands: r.hands };
    }),
  },
  ...VS_OPEN.map(v => ({
    group: `面對 ${POSITIONS.find(p => p.id === v.vs)?.label} 開牌`,
    items: v.defenses.flatMap(d => {
      const r = resolveDefense(d);
      const who = HERO_SPOT_LABEL[d.hero].replace(/（.*）/, '');
      return [
        { id: `${v.vs}-${d.hero}-3bet`, label: `${who} 的 3-bet（${r.threeBet.percent.toFixed(1)}%）`, hands: r.threeBet.hands },
        { id: `${v.vs}-${d.hero}-call`, label: `${who} 的跟注（${r.call.percent.toFixed(1)}%）`, hands: r.call.hands },
      ];
    }),
  })),
];
const PRESET_BY_ID = new Map(RANGE_PRESETS.flatMap(g => g.items).map(i => [i.id, i]));

/** 牌的文字，給出路清單用：A♥ */
function cardText(c: number): string {
  return `${RANK_CHARS[cardRank(c)]}${SUIT_LABELS[cardSuit(c)]}`;
}

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
  const [villainMode, setVillainMode] = useState<VillainMode>('random');
  const [presetId, setPresetId] = useState('rfi-utg');
  const [custom, setCustom] = useState('');
  const [rangeRes, setRangeRes] = useState<RangeEquity | null>(null);
  const [pot, setPot] = useState('100');
  const [toCall, setToCall] = useState('50');
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
      if (slot === 'hero') setSlot(villainMode === 'cards' ? 'villain' : 'board');
      else if (slot === 'villain') setSlot('board');
    }
  };

  const remove = (s: Slot, card: number) => {
    set(s, get(s).filter(c => c !== card));
    setSlot(s);
  };

  const boardOk = [0, 3, 4, 5].includes(board.length);

  // 對手的範圍：自訂優先，寫錯就提示、不算
  const rangeHands = useMemo<{ hands: Set<string> | null; error: string | null }>(() => {
    if (villainMode !== 'range') return { hands: null, error: null };
    if (custom.trim()) {
      try { return { hands: parseRange(custom), error: null }; }
      catch (e) { return { hands: null, error: (e as Error).message }; }
    }
    return { hands: PRESET_BY_ID.get(presetId)?.hands ?? null, error: null };
  }, [villainMode, custom, presetId]);

  const villainOk = villainMode === 'cards' ? villain.length === 2
    : villainMode === 'range' ? Boolean(rangeHands.hands?.size) : true;
  const ready = hero.length === 2 && villainOk && boardOk;

  // 先讓「計算中」畫出來，再開始算 —— 否則主執行緒會被佔住，畫面停在舊結果
  const runId = useRef(0);
  useEffect(() => {
    if (!ready) { setResult(null); setRangeRes(null); setError(null); setBusy(false); return; }
    const id = ++runId.current;
    setBusy(true);
    setError(null);
    const t = setTimeout(() => {
      if (id !== runId.current) return;
      try {
        if (villainMode === 'range') {
          const r = rangeEquity(hero, rangeHands.hands!, board);
          if (!r) throw new Error('範圍裡的牌全被你的牌或公牌擋掉了');
          setRangeRes(r);
          setResult(null);
        } else {
          setResult(computeEquity({
            hero, villain: villainMode === 'cards' ? villain : null, board,
          }));
          setRangeRes(null);
        }
      } catch (e) {
        setResult(null);
        setRangeRes(null);
        setError((e as Error).message);
      } finally {
        if (id === runId.current) setBusy(false);
      }
    }, 30);
    return () => clearTimeout(t);
  }, [hero, villain, board, ready, villainMode, rangeHands]);

  // 不管是對一手牌還是對範圍，後面「跟注值不值」用的都是這一個勝率
  const equity = rangeRes ? rangeRes.equity : result ? result.equity : null;
  const outs = useMemo(() => countOuts(hero, board), [hero, board]);
  const potN = Number(pot);
  const callN = Number(toCall);
  const need = requiredEquity(potN, callN);
  const ev = equity === null ? null : callEv(equity, potN, callN);

  const se = result ? standardError(result) : 0;
  const street = board.length === 0 ? '翻牌前'
    : board.length === 3 ? '翻牌圈'
      : board.length === 4 ? '轉牌圈' : '河牌圈';

  return (
    <>
      {/* 三個牌格 */}
      <div className="mt-3 flex gap-1.5 rounded-lg bg-sunken p-1" role="group" aria-label="對手">
        {([['random', '對手隨機'], ['cards', '指定手牌'], ['range', '對手範圍']] as const).map(([m, label]) => (
          <button key={m} type="button" aria-pressed={villainMode === m}
                  onClick={() => { setVillainMode(m); if (m !== 'cards') { setVillain([]); if (slot === 'villain') setSlot('board'); } }}
                  className={`h-8 flex-1 rounded-md text-[12.5px] font-semibold transition-colors ${
                    villainMode === m ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      {villainMode === 'range' && (
        <div className="mt-2 rounded-xl border border-line bg-surface p-2.5">
          <label className="block text-[12.5px] font-bold text-ink" htmlFor="range-preset">對手的範圍</label>
          <select id="range-preset" value={presetId} onChange={e => { setPresetId(e.target.value); setCustom(''); }}
                  className="mt-1 h-9 w-full rounded-lg border border-line bg-bg px-2 text-[13px] text-ink">
            {RANGE_PRESETS.map(g => (
              <optgroup key={g.group} label={g.group}>
                {g.items.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
              </optgroup>
            ))}
          </select>
          <input value={custom} onChange={e => setCustom(e.target.value)}
                 placeholder="或自己輸入，例如 QQ+, AKs, AKo"
                 className="mt-1.5 h-9 w-full rounded-lg border border-line bg-bg px-2 font-mono text-[12.5px] text-ink" />
          {rangeHands.error && <p className="mt-1 text-[11.5px] text-up">{rangeHands.error}</p>}
        </div>
      )}

      <div className="mt-2 space-y-2">
        {(['hero', 'villain', 'board'] as Slot[]).filter(s => s !== 'villain' || villainMode === 'cards').map(s => {
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

        {ready && !busy && rangeRes && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-sm font-bold text-ink">{street}　·　對手範圍</h3>
              <span className="text-[11.5px] text-faint">
                範圍 {rangeRes.combos} 個組合（已扣掉撞牌的）· 抽樣 {rangeRes.trials.toLocaleString('en-US')} 次
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-[34px] leading-none font-bold tabular-nums text-up">
                {rangeRes.equity.toFixed(1)}%
              </span>
              <span className="font-mono text-[13px] tabular-nums text-muted">± 0.5</span>
            </div>
            <p className="mt-0.5 text-[11.5px] text-faint">對這個範圍的平均勝率（平手算半勝）</p>
          </>
        )}

        {ready && !busy && result && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-sm font-bold text-ink">
                {street}　·　{villainMode === 'cards' ? '對手牌已知' : '對手隨機'}
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

      {/* 跟注值不值 */}
      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <h3 className="text-sm font-bold text-ink">跟注值不值</h3>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-[11.5px] text-muted">
            底池（含對手剛下的注）
            <input inputMode="decimal" value={pot} onChange={e => setPot(e.target.value)}
                   className="mt-0.5 h-9 w-full rounded-lg border border-line bg-bg px-2 font-mono text-[14px] text-ink" />
          </label>
          <label className="text-[11.5px] text-muted">
            你要跟的金額
            <input inputMode="decimal" value={toCall} onChange={e => setToCall(e.target.value)}
                   className="mt-0.5 h-9 w-full rounded-lg border border-line bg-bg px-2 font-mono text-[14px] text-ink" />
          </label>
        </div>
        {need === null ? (
          <p className="mt-2 text-[12.5px] text-muted">輸入底池與跟注金額。</p>
        ) : (
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-sunken px-2 py-1.5">
              <div className="text-[11px] text-muted">需要勝率</div>
              <div className="font-mono text-[15px] font-bold tabular-nums text-ink">{need.toFixed(1)}%</div>
            </div>
            <div className="rounded-lg bg-sunken px-2 py-1.5">
              <div className="text-[11px] text-muted">你的勝率</div>
              <div className="font-mono text-[15px] font-bold tabular-nums text-ink">
                {equity === null ? '—' : `${equity.toFixed(1)}%`}
              </div>
            </div>
            <div className="rounded-lg bg-sunken px-2 py-1.5">
              <div className="text-[11px] text-muted">跟注的 EV</div>
              <div className={`font-mono text-[15px] font-bold tabular-nums ${
                ev === null ? 'text-ink' : ev >= 0 ? 'text-up' : 'text-down'}`}>
                {ev === null ? '—' : `${ev >= 0 ? '+' : ''}${ev.toFixed(1)}`}
              </div>
            </div>
          </div>
        )}
        {need !== null && equity !== null && (
          <p className={`mt-2 text-[13px] font-semibold ${equity >= need ? 'text-up' : 'text-down'}`}>
            {equity >= need
              ? `划算：勝率比門檻高 ${(equity - need).toFixed(1)} 個百分點，長期每次跟注平均${ev! >= 0 ? '賺' : '賠'} ${Math.abs(ev!).toFixed(1)}。`
              : `不划算：勝率還差 ${(need - equity).toFixed(1)} 個百分點，除非之後能多贏到錢（隱含賠率）。`}
          </p>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          需要勝率 = 跟注 ÷（底池 + 跟注）。EV 只看這一條街：贏了拿走底池，輸了賠掉跟注；
          之後還會下的注（隱含賠率）與對手棄牌不在裡面。金額單位隨你（元、籌碼、大盲都可以）。
        </p>
      </section>

      {/* 聽牌出路：翻牌圈與轉牌圈才有意義 */}
      {outs && (
        <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 className="text-sm font-bold text-ink">聽牌出路</h3>
            <span className="text-[11.5px] text-faint">現在：{outs.current} · 沒看過的牌 {outs.unseen} 張</span>
          </div>
          <div className="mt-1.5 font-mono text-[28px] font-bold leading-none tabular-nums text-ink">
            {outs.cards.length} <span className="font-sans text-[13px] font-normal text-muted">張出路</span>
          </div>
          {Object.entries(outs.byCategory).map(([name, list]) => (
            <p key={name} className="mt-1 text-[12.5px] text-muted">
              中了變<strong className="text-ink">{name}</strong>（{list.length} 張）：
              <span className="font-mono">{list.map(cardText).join(' ')}</span>
            </p>
          ))}
          {outs.cards.length > 0 && (
            <table className="mt-2 w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] text-faint">
                  <th className="py-1 font-medium" />
                  <th className="py-1 text-right font-medium">精確</th>
                  <th className="py-1 text-right font-medium">2／4 法則</th>
                </tr>
              </thead>
              <tbody>
                {board.length === 3 && (
                  <tr className="border-t border-line/60">
                    <td className="py-1 text-ink">到河牌前中（看兩張）</td>
                    <td className="py-1 text-right font-mono tabular-nums text-ink">{hitChance(outs.cards.length, outs.unseen, 2).toFixed(1)}%</td>
                    <td className="py-1 text-right font-mono tabular-nums text-muted">{ruleOfTwoFour(outs.cards.length, 2)}%</td>
                  </tr>
                )}
                <tr className="border-t border-line/60">
                  <td className="py-1 text-ink">下一張就中</td>
                  <td className="py-1 text-right font-mono tabular-nums text-ink">{hitChance(outs.cards.length, outs.unseen, 1).toFixed(1)}%</td>
                  <td className="py-1 text-right font-mono tabular-nums text-muted">{ruleOfTwoFour(outs.cards.length, 1)}%</td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            出路 = 來了會讓你的牌型變大、而且是靠你的手牌變大的牌（公牌自己成對不算）。
            沒有考慮對手的牌 —— 中了也可能輸給更大的牌，實際勝率看上面的勝率計算。
            2／4 法則是牌桌上的心算：翻牌圈出路 × 4、轉牌圈出路 × 2；出路超過 8 張時會高估。
          </p>
        </section>
      )}

      <p className="mt-3 rounded-lg bg-sunken px-3 py-2.5 text-[12px] leading-relaxed text-muted">
        算的是<strong className="text-ink">攤牌時的勝率</strong>：假設牌一路發到河牌、雙方都不棄牌。
        實戰還有下注與棄牌權益 —— 那些不在這個數字裡。
        「對手隨機」當成完全隨機的兩張牌，會低估真實對手（會跟你打到底的人通常不是隨機牌），
        所以實戰建議用「對手範圍」：對方開牌就選他位置的開牌範圍、3-bet 就選 3-bet 範圍。
      </p>
    </>
  );
}
