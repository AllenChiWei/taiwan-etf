/* 收藏頁：收藏 ETF 的持股重疊（公會月報前十大，見 lib/overlap.ts） */

import { useEffect, useMemo, useState } from 'react';
import { fetchTop10 } from '../api/extras';
import { overlapPairs } from '../lib/overlap';
import type { Top10Data } from '../lib/top10';

export function OverlapSection({ codes }: { codes: string[] }) {
  const [data, setData] = useState<Top10Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchTop10(ac.signal).then(d => { if (!ac.signal.aborted) setData(d); }).catch(() => {});
    return () => ac.abort();
  }, []);

  const res = useMemo(() => (data ? overlapPairs(data, codes) : null), [data, codes]);
  if (!res || res.covered.length < 2) return null;
  const name = (c: string) => data?.etfs[c]?.name.replace(/\(.*$|（.*$/, '').slice(0, 14) ?? c;

  return (
    <section className="mt-6" aria-label="持股重疊">
      <h2 className="mb-1 text-base font-bold text-ink">持股重疊</h2>
      <p className="mb-2 text-[12.5px] text-muted">
        收藏中兩兩比較前十大持股：重疊度 = 共同持股取兩檔裡較小的佔比相加（佔淨值 %）。只看前十大，
        實際重疊只會更多。資料：投信投顧公會月報（{data?.meta.ym.slice(0, 4)}/{data?.meta.ym.slice(4)}）。點一列看共同持股。
      </p>
      <ul className="flex flex-col gap-1.5">
        {res.pairs.map(p => {
          const key = `${p.a}-${p.b}`;
          const lvl = p.overlap >= 30 ? 'text-up font-semibold' : p.overlap >= 15 ? 'text-ink font-semibold' : 'text-muted';
          return (
            <li key={key} className="rounded-lg border border-line bg-surface">
              <button type="button" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left">
                <span className="font-mono text-[13px] font-bold text-accent">{p.a}</span>
                <span className="text-faint">×</span>
                <span className="font-mono text-[13px] font-bold text-accent">{p.b}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{name(p.a)}・{name(p.b)}</span>
                <span className={`font-mono text-[13px] tabular-nums ${lvl}`}>{p.overlap.toFixed(1)}%</span>
                <span className="text-[11px] text-faint">{p.common.length} 檔共同</span>
              </button>
              {open === key && (
                <div className="border-t border-line/60 px-3 py-2">
                  {p.common.length === 0 ? <p className="text-[12px] text-muted">前十大沒有共同持股。</p> : (
                    <table className="w-full text-[12px]">
                      <thead><tr className="text-[11px] text-faint">
                        <th className="text-left font-normal">共同持股</th>
                        <th className="text-right font-normal">{p.a}</th><th className="text-right font-normal">{p.b}</th>
                      </tr></thead>
                      <tbody>{p.common.map(c => (
                        <tr key={c.code} className="border-t border-line/40">
                          <td className="py-0.5"><span className="font-mono">{c.code}</span> <span className="text-muted">{c.name}</span></td>
                          <td className="text-right font-mono">{c.a.toFixed(2)}%</td>
                          <td className="text-right font-mono">{c.b.toFixed(2)}%</td>
                        </tr>))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {codes.length > res.covered.length && (
        <p className="mt-1.5 text-[11.5px] text-faint">
          沒有前十大資料、不列入比較：{codes.filter(c => !res.covered.includes(c)).join('、')}（美股、債券期貨型等公會沒有月報）
        </p>
      )}
    </section>
  );
}
