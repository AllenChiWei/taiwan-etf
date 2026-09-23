/* 翻前範圍測驗：隨機出情境與手牌，選動作，立刻對答案。
 *
 * 出題在 lib/pokerTools.ts 的 makeQuestion。成績存在 localStorage（只在這台裝置），
 * 讀寫失敗（無痕模式之類）就只在這一輪有效。 */

import { useCallback, useEffect, useState } from 'react';
import { makeQuestion, QUIZ_LABEL, type QuizAction, type QuizQuestion } from '../lib/pokerTools';

const KEY = 'twetf.pokerQuiz';

interface Miss { spot: string; hand: string; answer: QuizAction; picked: QuizAction }
interface Stats { right: number; total: number; streak: number; best: number; misses: Miss[] }
const EMPTY: Stats = { right: 0, total: 0, streak: 0, best: 0, misses: [] };

function load(): Stats {
  try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return EMPTY; }
}
function save(s: Stats) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 存不進去就算了 */ }
}

type Q = QuizQuestion & { why: string };

export function PokerQuiz() {
  const [q, setQ] = useState<Q>(() => makeQuestion());
  const [picked, setPicked] = useState<QuizAction | null>(null);
  const [stats, setStats] = useState<Stats>(load);
  const [showMisses, setShowMisses] = useState(false);

  useEffect(() => { save(stats); }, [stats]);

  const answer = useCallback((a: QuizAction) => {
    if (picked) return;
    setPicked(a);
    const ok = a === q.answer;
    setStats(s => ({
      right: s.right + (ok ? 1 : 0),
      total: s.total + 1,
      streak: ok ? s.streak + 1 : 0,
      best: Math.max(s.best, ok ? s.streak + 1 : 0),
      misses: ok ? s.misses
        : [{ spot: q.spot, hand: q.hand, answer: q.answer, picked: a }, ...s.misses].slice(0, 20),
    }));
  }, [picked, q]);

  const next = () => { setQ(makeQuestion()); setPicked(null); };
  const ok = picked !== null && picked === q.answer;
  const kind = q.hand.length === 2 ? '口袋對子' : q.hand.endsWith('s') ? '同花' : '不同花';

  return (
    <div className="mt-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        {([['答對率', stats.total ? `${Math.round((stats.right / stats.total) * 100)}%` : '—'],
           ['連續答對', String(stats.streak)], ['最佳紀錄', String(stats.best)]] as const).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-surface px-2 py-1.5">
            <div className="text-[11px] text-muted">{k}</div>
            <div className="font-mono text-[16px] font-bold tabular-nums text-ink">{v}</div>
          </div>
        ))}
      </div>

      <section className="mt-3 rounded-xl border border-line bg-surface p-4 text-center">
        <p className="text-[13px] text-muted">{q.spot}</p>
        <p className="mt-2 font-mono text-[44px] font-bold leading-none tracking-wide text-ink">{q.hand}</p>
        <p className="mt-1 text-[11.5px] text-faint">{kind} · 100bb 現金局</p>

        <div className="mt-4 flex justify-center gap-2">
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
              下一題
            </button>
          </div>
        )}
      </section>

      {stats.misses.length > 0 && (
        <section className="mt-3 rounded-xl border border-line bg-surface p-3.5">
          <button type="button" onClick={() => setShowMisses(v => !v)} aria-expanded={showMisses}
                  className="flex w-full items-baseline justify-between text-left">
            <span className="text-sm font-bold text-ink">錯題回顧（最近 {stats.misses.length} 題）</span>
            <span className="text-[12px] text-accent">{showMisses ? '收起' : '展開'}</span>
          </button>
          {showMisses && (
            <ul className="mt-2">
              {stats.misses.map((m, i) => (
                <li key={i} className="border-b border-line/60 py-1.5 text-[12.5px] last:border-0">
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
          <button type="button" onClick={() => setStats(EMPTY)}
                  className="mt-2 text-[11.5px] text-faint hover:text-ink">清除成績</button>
        </section>
      )}

      <p className="mt-3 rounded-lg bg-sunken px-3 py-2.5 text-[12px] leading-relaxed text-muted">
        答案以這一頁的範圍表為準（6 人桌、100bb、與 solver 方向一致的公開近似範圍）。
        題目刻意讓答案平均分布：開牌題一半在範圍內、一半在範圍外，應對題 3-bet、跟注、蓋牌各三分之一，
        所以練到的都是需要想一下的牌，而不是一眼就蓋的垃圾牌。成績只存在這台裝置。
      </p>
    </div>
  );
}
