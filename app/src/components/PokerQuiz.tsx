/* 翻前範圍測驗：隨機出情境與手牌，選動作，立刻對答案。
 *
 * 出題在 lib/pokerTools.ts 的 makeQuestion，支援依位置與動作分類練習，
 * 也可切換「只重做錯題」針對本機錯題紀錄加強。成績存在 localStorage（只在這台裝置），
 * 讀寫失敗（無痕模式之類）就只在這一輪有效。 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  makeQuestion, hasQuizSpots, filterMisses, recordMiss, removeMiss,
  pickMissQuestion, parseMissMeta,
  QUIZ_LABEL, QUIZ_POSITIONS, QUIZ_SPOT_LABEL,
  type QuizAction, type QuizFilter, type QuizMiss, type QuizPosition,
  type QuizQuestion, type QuizSpotType,
} from '../lib/pokerTools';

const KEY = 'twetf.pokerQuiz';

interface Stats { right: number; total: number; streak: number; best: number; misses: QuizMiss[] }
const EMPTY: Stats = { right: 0, total: 0, streak: 0, best: 0, misses: [] };

function load(): Stats {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const misses = Array.isArray(raw?.misses) ? raw.misses : [];
    return { ...EMPTY, ...raw, misses };
  } catch {
    return EMPTY;
  }
}
function save(s: Stats) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 存不進去就算了 */ }
}

type Q = QuizQuestion & { why: string };
type QuizMode = 'normal' | 'misses';

function drawQuestion(
  mode: QuizMode,
  filter: QuizFilter,
  misses: readonly QuizMiss[],
  exclude?: Pick<QuizMiss, 'spot' | 'hand'>,
): Q | null {
  if (mode === 'misses') {
    return pickMissQuestion(filterMisses(misses, filter), Math.random, exclude);
  }
  return makeQuestion(Math.random, filter);
}

export function PokerQuiz() {
  const [stats, setStats] = useState<Stats>(load);
  const [mode, setMode] = useState<QuizMode>('normal');
  const [posFilter, setPosFilter] = useState<QuizPosition | 'all'>('all');
  const [spotFilter, setSpotFilter] = useState<QuizSpotType | 'all'>('all');
  const [q, setQ] = useState<Q | null>(() => makeQuestion());
  const [picked, setPicked] = useState<QuizAction | null>(null);
  const [showMisses, setShowMisses] = useState(false);

  useEffect(() => { save(stats); }, [stats]);

  const filter = useMemo<QuizFilter>(
    () => ({ position: posFilter, spotType: spotFilter }),
    [posFilter, spotFilter],
  );
  const filteredMisses = useMemo(
    () => filterMisses(stats.misses, filter),
    [stats.misses, filter],
  );

  const missSummary = useMemo(() => {
    const byPos = new Map<QuizPosition, number>();
    const byAction = new Map<QuizAction, number>();
    for (const m of stats.misses) {
      const meta = parseMissMeta(m);
      if (meta.position) byPos.set(meta.position, (byPos.get(meta.position) ?? 0) + 1);
      byAction.set(m.answer, (byAction.get(m.answer) ?? 0) + 1);
    }
    return {
      positions: [...byPos.entries()].sort((a, b) => b[1] - a[1]),
      actions: [...byAction.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [stats.misses]);

  const switchMode = (nextMode: QuizMode) => {
    if (nextMode === 'misses' && stats.misses.length === 0) return;
    setMode(nextMode);
    setPicked(null);
    setQ(drawQuestion(nextMode, filter, stats.misses));
  };

  const selectPos = (nextPos: QuizPosition | 'all') => {
    const nextSpot = hasQuizSpots({ position: nextPos, spotType: spotFilter }) ? spotFilter : 'all';
    setPosFilter(nextPos);
    if (nextSpot !== spotFilter) setSpotFilter(nextSpot);
    setPicked(null);
    setQ(drawQuestion(mode, { position: nextPos, spotType: nextSpot }, stats.misses));
  };

  const selectSpot = (nextSpot: QuizSpotType | 'all') => {
    const nextPos = hasQuizSpots({ position: posFilter, spotType: nextSpot }) ? posFilter : 'all';
    setSpotFilter(nextSpot);
    if (nextPos !== posFilter) setPosFilter(nextPos);
    setPicked(null);
    setQ(drawQuestion(mode, { position: nextPos, spotType: nextSpot }, stats.misses));
  };

  const answer = useCallback((a: QuizAction) => {
    if (picked || !q) return;
    setPicked(a);
    const ok = a === q.answer;
    setStats(s => ({
      right: s.right + (ok ? 1 : 0),
      total: s.total + 1,
      streak: ok ? s.streak + 1 : 0,
      best: Math.max(s.best, ok ? s.streak + 1 : 0),
      misses: ok
        ? (mode === 'misses' ? removeMiss(s.misses, q) : s.misses)
        : recordMiss(s.misses, { spot: q.spot, hand: q.hand, answer: q.answer, picked: a }),
    }));
  }, [picked, q, mode]);

  const next = () => {
    if (mode === 'misses') {
      if (filteredMisses.length === 0) {
        if (stats.misses.length === 0) {
          setMode('normal');
          setPicked(null);
          setQ(makeQuestion(Math.random, filter));
        } else {
          setPosFilter('all');
          setSpotFilter('all');
          setPicked(null);
          setQ(pickMissQuestion(stats.misses));
        }
        return;
      }
      setPicked(null);
      setQ(pickMissQuestion(filteredMisses, Math.random, q ?? undefined));
      return;
    }
    setPicked(null);
    setQ(makeQuestion(Math.random, filter));
  };

  const resetStats = () => {
    setStats(EMPTY);
    if (mode === 'misses') {
      setMode('normal');
      setPicked(null);
      setQ(makeQuestion(Math.random, filter));
    }
  };

  const ok = picked !== null && q !== null && picked === q.answer;
  const kind = q ? (q.hand.length === 2 ? '口袋對子' : q.hand.endsWith('s') ? '同花' : '不同花') : '';
  const hasMisses = stats.misses.length > 0;
  const nextLabel = mode === 'misses' && filteredMisses.length === 0
    ? (hasMisses ? '這組錯題已訂正，重做其他錯題' : '錯題已全部訂正，回到隨機練習')
    : '下一題';

  return (
    <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start">
      <div className="min-w-0">
      <div className="grid grid-cols-3 gap-2 text-center">
        {([['答對率', stats.total ? `${Math.round((stats.right / stats.total) * 100)}%` : '—'],
           ['連續答對', String(stats.streak)], ['最佳紀錄', String(stats.best)]] as const).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-surface px-2 py-1.5">
            <div className="text-[11px] text-muted">{k}</div>
            <div className="font-mono text-[16px] font-bold tabular-nums text-ink">{v}</div>
          </div>
        ))}
      </div>

      {/* 練習模式與分類篩選 */}
      <section className="mt-3 rounded-xl border border-line bg-surface p-3">
        <div className="flex gap-1.5 rounded-lg bg-sunken p-1" role="group" aria-label="練習模式">
          <button
            type="button"
            aria-pressed={mode === 'normal'}
            onClick={() => switchMode('normal')}
            className={`h-8 flex-1 rounded-md px-2 text-[12.5px] font-semibold transition-colors ${
              mode === 'normal' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
          >
            隨機練習
          </button>
          <button
            type="button"
            aria-pressed={mode === 'misses'}
            disabled={!hasMisses}
            onClick={() => switchMode('misses')}
            className={`h-8 flex-1 rounded-md px-2 text-[12.5px] font-semibold transition-colors
              disabled:cursor-not-allowed disabled:opacity-45 ${
              mode === 'misses' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
          >
            只重做錯題{hasMisses ? `（${stats.misses.length}）` : ''}
          </button>
        </div>
        {!hasMisses ? (
          <p className="mt-1.5 text-[11.5px] text-faint">
            目前沒有錯題紀錄，答錯的題目會存在本機並自動啟用「只重做錯題」。
          </p>
        ) : mode === 'misses' ? (
          <p className="mt-1.5 text-[11.5px] text-muted">
            錯題訂正中（答對即從錯題本移出；符合目前篩選 {filteredMisses.length} / {stats.misses.length} 題）。
          </p>
        ) : null}

        <div className="mt-2.5 space-y-2">
          <div>
            <span className="text-[11px] font-semibold text-muted">位置</span>
            <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="篩選位置">
              {(['all', ...QUIZ_POSITIONS] as const).map(p => {
                const on = posFilter === p;
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={on}
                    onClick={() => selectPos(p)}
                    className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                      on ? 'border-accent bg-accent-soft text-ink'
                        : 'border-line bg-bg text-muted hover:border-accent'}`}
                  >
                    {p === 'all' ? '全部' : p}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="text-[11px] font-semibold text-muted">動作分類</span>
            <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="篩選動作分類">
              {(['all', 'rfi', 'vs'] as const).map(st => {
                const on = spotFilter === st;
                return (
                  <button
                    key={st}
                    type="button"
                    aria-pressed={on}
                    onClick={() => selectSpot(st)}
                    className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                      on ? 'border-accent bg-accent-soft text-ink'
                        : 'border-line bg-bg text-muted hover:border-accent'}`}
                  >
                    {st === 'all' ? '全部' : QUIZ_SPOT_LABEL[st]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {q ? (
        <section className="mt-3 rounded-xl border border-line bg-surface p-4 text-center">
          <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
            {mode === 'misses' && (
              <span className="rounded bg-accent-soft px-2 py-0.5 font-semibold text-accent">
                錯題重做
              </span>
            )}
            <span className="rounded bg-sunken px-2 py-0.5 font-medium text-muted">
              {q.position} · {QUIZ_SPOT_LABEL[q.spotType]}
            </span>
          </div>
          <p className="mt-2 text-[13px] text-muted">{q.spot}</p>
          <p className="mt-2 font-mono text-[44px] font-bold leading-none tracking-wide text-ink">{q.hand}</p>
          <p className="mt-1 text-[11.5px] text-faint">{kind} · 100bb 現金局</p>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {q.choices.map(c => {
              const isAns = picked !== null && c === q.answer;
              const isWrong = picked === c && c !== q.answer;
              return (
                <button key={c} type="button" onClick={() => answer(c)} disabled={picked !== null}
                        className={`h-11 min-w-[5.5em] rounded-lg border px-4 text-[14px] font-bold transition-colors ${
                          isAns ? 'border-up bg-up text-white'
                            : isWrong ? 'border-line bg-sunken text-faint line-through'
                              : 'border-line bg-bg text-ink hover:border-accent'}`}>
                  {QUIZ_LABEL[c]}
                </button>
              );
            })}
          </div>

          {picked && (
            <div className="mt-4">
              <p className={`text-[15px] font-bold ${ok ? 'text-up' : 'text-down'}`}>
                {ok ? '答對了' : `答錯了，應該${QUIZ_LABEL[q.answer]}`}
              </p>
              <p className="mt-1 text-[12.5px] text-muted">{q.why}</p>
              <button type="button" onClick={next}
                      className="mt-3 h-10 rounded-lg bg-accent px-6 text-[14px] font-bold text-accent-ink">
                {nextLabel}
              </button>
            </div>
          )}
        </section>
      ) : (
        <section className="mt-3 rounded-xl border border-line bg-surface p-5 text-center">
          <p className="text-[14px] font-bold text-ink">這個篩選條件下沒有錯題</p>
          <p className="mt-1 text-[12.5px] text-muted">
            目前共有 {stats.misses.length} 題錯題，可以重做全部錯題或切回隨機練習。
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPosFilter('all');
                setSpotFilter('all');
                setPicked(null);
                setQ(pickMissQuestion(stats.misses));
              }}
              className="h-9 rounded-lg bg-accent px-4 text-[13px] font-bold text-accent-ink"
            >
              重做全部錯題
            </button>
            <button
              type="button"
              onClick={() => switchMode('normal')}
              className="h-9 rounded-lg border border-line bg-bg px-4 text-[13px] font-semibold text-ink hover:border-accent"
            >
              切回隨機練習
            </button>
          </div>
        </section>
      )}
      </div>

      <div className="min-w-0 space-y-3">
      {hasMisses && (
        <section className="rounded-xl border border-line bg-surface p-3.5">
          <button type="button" onClick={() => setShowMisses(v => !v)} aria-expanded={showMisses}
                  className="flex w-full items-baseline justify-between text-left">
            <span className="text-sm font-bold text-ink">錯題回顧（最近 {stats.misses.length} 題）</span>
            <span className="text-[12px] text-accent">{showMisses ? '收起' : '展開'}</span>
          </button>
          {(missSummary.positions.length > 0 || missSummary.actions.length > 0) && (
            <div className="mt-2 space-y-1 text-[11.5px] text-muted">
              {missSummary.positions.length > 0 && (
                <p>
                  依位置：{missSummary.positions.map(([p, n]) => `${p} ${n} 題`).join('、')}
                </p>
              )}
              {missSummary.actions.length > 0 && (
                <p>
                  依正解動作：{missSummary.actions.map(([a, n]) => `${QUIZ_LABEL[a]} ${n} 題`).join('、')}
                </p>
              )}
            </div>
          )}
          {showMisses && (
            <ul className="mt-2">
              {stats.misses.map((m, i) => (
                <li key={`${m.spot}-${m.hand}-${i}`} className="border-b border-line/60 py-1.5 text-[12.5px] last:border-0">
                  <span className="font-mono font-bold text-ink">{m.hand}</span>
                  <span className="ml-2 text-muted">{m.spot}</span>
                  <span className="block text-[11.5px]">
                    <span className="text-down">你選{QUIZ_LABEL[m.picked]}</span>
                    <span className="text-faint"> → </span>
                    <span className="text-up">應該{QUIZ_LABEL[m.answer]}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            {mode !== 'misses' && (
              <button
                type="button"
                onClick={() => {
                  setMode('misses');
                  setPosFilter('all');
                  setSpotFilter('all');
                  setPicked(null);
                  setQ(pickMissQuestion(stats.misses));
                }}
                className="text-[12px] font-semibold text-accent hover:underline"
              >
                開始重做這些錯題 →
              </button>
            )}
            <button type="button" onClick={resetStats}
                    className="text-[11.5px] text-faint hover:text-ink">清除成績</button>
          </div>
        </section>
      )}

      <p className="rounded-lg bg-sunken px-3 py-2.5 text-[12px] leading-relaxed text-muted">
        答案以這一頁的範圍表為準（6 人桌、100bb、與 solver 方向一致的公開近似範圍）。
        題目刻意讓答案平均分布：開牌題一半在範圍內、一半在範圍外，應對題 3-bet、跟注、蓋牌各三分之一，
        所以練到的都是需要想一下的牌，而不是一眼就蓋的垃圾牌。可依位置或動作分類加強練習，
        答錯的題目會留在這台裝置的錯題本供反覆訂正（清除瀏覽器資料會遺失，無跨裝置同步）。
      </p>
      </div>
    </div>
  );
}
