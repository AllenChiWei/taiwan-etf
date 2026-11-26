/* 收藏頁：收藏 ETF 的持股重疊（主動式用投信每日完整持股，其餘用公會月報前十大；算法見 lib/overlap.ts） */

import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useEtfExtras } from './EtfExtras';
import { overlapPairs, type HoldingSet } from '../lib/overlap';
import { lookupMonthly } from '../lib/top10';

const COMMON_PREVIEW = 15;

function shortSource(s: HoldingSet): string {
  return s.kind === 'daily' ? `每日 ${s.asof.slice(5).replace('-', '/')}` : `前十大 ${s.asof}`;
}

export function OverlapSection({ codes, names }: { codes: string[]; names?: ReadonlyMap<string, string> }) {
  const extras = useEtfExtras();
  const top10 = extras?.[0] ?? null;
  const active = extras?.[1] ?? null;
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});

  const res = useMemo(() => (extras ? overlapPairs(top10, codes, active) : null), [extras, top10, active, codes]);
  if (!res || res.covered.length < 2) return null;

  const name = (c: string) => {
    const raw = names?.get(c)
      ?? active?.etfs[c]?.name
      ?? (top10 ? lookupMonthly(top10, c)?.name : undefined);
    return raw ? raw.replace(/\(.*$|（.*$/, '').slice(0, 14) : c;
  };

  const dailySets = res.covered.map(c => res.sets[c]).filter(s => s.kind === 'daily');
  const monthlySets = res.covered.map(c => res.sets[c]).filter(s => s.kind === 'monthly');
  const dailyDate = dailySets.map(s => s.asof).sort().pop() ?? '';
  const monthlyYm = monthlySets[0]?.asof ?? '';

  return (
    <section className="mt-6" aria-label="持股重疊">
      <h2 className="mb-1 text-base font-bold text-ink">持股重疊</h2>
      <p className="mb-2 max-w-[78ch] text-[12.5px] text-muted">
        收藏中兩兩比較持股：重疊度＝共同持股取兩檔裡較小的佔比相加（佔淨值 %，期貨不計）。
        {dailySets.length > 0 && monthlySets.length > 0
          ? `主動式 ETF 用投信每日完整持股（截至 ${dailyDate}），其餘用投信投顧公會月報前十大（${monthlyYm}，前十大以外算不到，實際重疊只會更多）；不同來源日期不同，比例僅供參考。`
          : dailySets.length > 0
            ? `皆使用投信每日公告的完整持股（截至 ${dailyDate}）。`
            : `只看投信投顧公會月報前十大（${monthlyYm}），前十大以外算不到，實際重疊只會更多。`}
        點一列看共同持股。
      </p>
      <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2 lg:items-start">
        {res.pairs.map(p => {
          const key = `${p.a}-${p.b}`;
          const isOpen = open === key;
          const expandedAll = Boolean(showAll[key]);
          const visible = expandedAll ? p.common : p.common.slice(0, COMMON_PREVIEW);
          const sa = res.sets[p.a];
          const sb = res.sets[p.b];
          // 非漲跌數字不使用紅綠（text-up／text-down），高重疊改用琥珀色（text-yield）提示
          const lvl = p.overlap >= 30 ? 'text-yield font-semibold' : p.overlap >= 15 ? 'text-ink font-semibold' : 'text-muted';
          return (
            <li key={key} className="rounded-lg border border-line bg-surface">
              <button type="button" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover/60">
                <span className="shrink-0 font-mono text-[13px] font-bold text-accent">{p.a}</span>
                <span className="text-faint">×</span>
                <span className="shrink-0 font-mono text-[13px] font-bold text-accent">{p.b}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{name(p.a)}・{name(p.b)}</span>
                <span className={`shrink-0 font-mono text-[13px] tabular-nums ${lvl}`}>{p.overlap.toFixed(1)}%</span>
                <span className="shrink-0 text-[11px] text-faint">{p.common.length} 檔</span>
                <span aria-hidden="true" className="shrink-0 text-[10px] text-faint">{isOpen ? '▴' : '▾'}</span>
              </button>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line/40 px-3 py-1.5 text-[11.5px]">
                <span className="text-faint">
                  {p.a} {shortSource(sa)} · {p.b} {shortSource(sb)}
                </span>
                <Link to="/compare" search={{ a: p.a, b: p.b }}
                      className="shrink-0 font-semibold text-accent hover:underline">
                  到比對頁看完整差異 →
                </Link>
              </div>
              {isOpen && (
                <div className="border-t border-line/60 px-3 py-2">
                  {p.common.length === 0 ? (
                    <p className="text-[12px] text-muted">
                      {sa.kind === 'daily' && sb.kind === 'daily'
                        ? '目前公告持股沒有共同持股。'
                        : '看得到的持股裡沒有共同持股。'}
                    </p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="text-[11px] text-faint">
                              <th className="text-left font-normal">共同持股</th>
                              <th className="w-[4.5em] text-right font-normal">{p.a}</th>
                              <th className="w-[4.5em] text-right font-normal">{p.b}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visible.map(c => (
                              <tr key={c.code} className="border-t border-line/40">
                                <td className="py-0.5 pr-2">
                                  <span className="font-mono">{c.code}</span>{' '}
                                  <span className="text-muted">{c.name}</span>
                                </td>
                                <td className="text-right font-mono tabular-nums">{c.a.toFixed(2)}%</td>
                                <td className="text-right font-mono tabular-nums">{c.b.toFixed(2)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {p.common.length > COMMON_PREVIEW && (
                        <button type="button"
                                onClick={() => setShowAll(prev => ({ ...prev, [key]: !prev[key] }))}
                                className="mt-1.5 text-[12px] font-semibold text-accent hover:underline">
                          {expandedAll ? '收起' : `展開全部 ${p.common.length} 檔共同持股`}
                        </button>
                      )}
                    </>
                  )}
                  {sa.kind !== sb.kind && (
                    <p className="mt-1.5 text-[11px] text-faint">
                      兩檔資料來源與日期不同（每日持股 vs 月報前十大），比例僅供參考。
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {codes.length > res.covered.length && (
        <p className="mt-1.5 text-[11.5px] text-faint">
          沒有持股資料、不列入比較：{codes.filter(c => !res.covered.includes(c)).join('、')}（槓桿／反向、期貨或尚未有月報的新上市 ETF）
        </p>
      )}
    </section>
  );
}
