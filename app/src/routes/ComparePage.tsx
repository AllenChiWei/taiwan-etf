/* ETF 持股比對（#/compare?a=0050&b=006208，2026-11-19 站主：任選兩檔 ETF，比共同持股與各自的比例）。
 *
 * 算法在 lib/overlap.ts（holdingsOf／compareHoldings）：主動式用投信每日公告的持股，其他用公會月報前十大，
 * 重疊度＝共同持股取兩檔裡較小的佔比相加。這頁只負責選檔與呈現；收藏頁的「持股重疊」是同一個概念的兩兩版。
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEtfData } from '../context/AppContext';
import { useEtfExtras } from '../components/EtfExtras';
import { SearchableSelect, type SelectOption } from '../components/SearchableSelect';
import { EmptyState } from '../components/EmptyState';
import { compareHoldings, holdingsOf, type HoldingSet, type OnlyRow } from '../lib/overlap';
import { missingReason } from '../lib/top10';

const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 常見的比較組合（兩檔都有資料才顯示） */
const QUICK: [string, string][] = [['0050', '006208'], ['0056', '00878'], ['00878', '00919'], ['0050', '00981A'], ['00981A', '00980A']];

function sourceLabel(s: HoldingSet): string {
  return s.kind === 'daily' ? `每日持股 ${s.asof}（投信公告，${s.w.size} 檔）` : `前十大 ${s.asof} 月底（投信投顧公會月報）`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="mt-0.5 font-mono text-[17px] font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

function Bar({ pct, max, tone }: { pct: number; max: number; tone: 'a' | 'b' }) {
  return (
    <div className="mt-0.5 h-1.5 w-full rounded-full bg-sunken" aria-hidden="true">
      <div className={`h-1.5 rounded-full ${tone === 'a' ? 'bg-accent' : 'bg-yield'}`} style={{ width: `${Math.min(100, (pct / max) * 100)}%` }} />
    </div>
  );
}

/** 對方只有前十大（月報）時，「只有這檔有」不成立 —— 對方第 11 名以後可能也有，標題改成「不在對方前十大」 */
function OnlyList({ code, other, rows }: { code: string; other: HoldingSet; rows: OnlyRow[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2">
      <div className="mb-1 text-[12.5px] font-semibold text-ink">
        {other.kind === 'monthly'
          ? <><span className="font-mono text-accent">{code}</span> 有、不在 <span className="font-mono">{other.code}</span> 前十大（{rows.length} 檔）</>
          : <><span className="font-mono text-accent">{code}</span> 有、<span className="font-mono">{other.code}</span> 公告持股沒有（{rows.length} 檔）</>}
      </div>
      {rows.length === 0 ? <p className="text-[12px] text-muted">沒有。</p> : (
        <ul className="text-[12px]">
          {shown.map(r => (
            <li key={r.code} className="flex items-baseline gap-2 border-t border-line/40 py-0.5 first:border-t-0">
              <span className="font-mono text-muted">{r.code}</span>
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="font-mono tabular-nums">{nf2.format(r.pct)}%</span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 10 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1 text-[12px] text-accent">
          {all ? '收起' : `看全部 ${rows.length} 檔`}
        </button>
      )}
    </div>
  );
}

export function ComparePage() {
  const { a, b } = useSearch({ from: '/compare' });
  const navigate = useNavigate();
  const data = useEtfData();
  const extras = useEtfExtras();
  const top10 = extras?.[0] ?? null;
  const active = extras?.[1] ?? null;

  const has = useMemo(() => {
    const s = new Set<string>();
    if (!extras) return s;
    for (const e of data.etfs) if (holdingsOf(e.code, top10, active)) s.add(e.code);
    return s;
  }, [data.etfs, extras, top10, active]);

  // 有持股資料的放前面；載入前先全部列出
  const options = useMemo<SelectOption[]>(() => {
    const list = data.etfs.map(e => ({ value: e.code, label: e.code, hint: e.name, group: !extras || has.has(e.code) ? undefined : '沒有持股資料' }));
    return [...list.filter(o => !o.group), ...list.filter(o => o.group)];
  }, [data.etfs, extras, has]);

  const set = (next: { a?: string; b?: string }) =>
    void navigate({ to: '/compare', search: { a: next.a ?? a, b: next.b ?? b }, replace: true, resetScroll: false });

  const etfA = data.etfs.find(e => e.code === a) ?? null;
  const etfB = data.etfs.find(e => e.code === b) ?? null;
  const sa = a && extras ? holdingsOf(a, top10, active) : null;
  const sb = b && extras ? holdingsOf(b, top10, active) : null;
  const cmp = useMemo(() => (sa && sb ? compareHoldings(sa, sb) : null), [sa, sb]);
  const max = cmp ? Math.max(1, ...cmp.common.flatMap(c => [c.a, c.b])) : 1;
  const quick = QUICK.filter(([x, y]) => !extras || (has.has(x) && has.has(y)));
  const sectionOf = (code: string) => data.etfs.find(e => e.code === code)?.sec ?? '';

  return (
    <>
      <h1 className="mt-4 text-lg font-bold text-ink">ETF 持股比對</h1>
      <p className="mt-1 max-w-[75ch] text-[12.5px] text-muted">
        選兩檔 ETF，看它們有哪些共同持股、各佔多少比例。主動式 ETF 用投信每日公告的持股，其他用投信投顧公會的月報前十大。
      </p>

      <div className="mt-3 grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <SearchableSelect options={options} value={a} placeholder="第一檔：代號或名稱…" onChange={c => set({ a: c })} />
        <button type="button" onClick={() => set({ a: b, b: a })} disabled={!a && !b}
                className="justify-self-center rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] text-muted hover:bg-hover disabled:opacity-40"
                aria-label="交換兩檔" title="交換兩檔">⇄ 交換</button>
        <SearchableSelect options={options} value={b} placeholder="第二檔：代號或名稱…" onChange={c => set({ b: c })} />
      </div>

      {quick.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-faint">常見比較：</span>
          {quick.map(([x, y]) => (
            <button key={`${x}-${y}`} type="button" onClick={() => set({ a: x, b: y })}
                    className="rounded-full border border-line bg-surface px-2.5 py-0.5 font-mono text-muted hover:bg-hover">
              {x} × {y}
            </button>
          ))}
        </div>
      )}

      {!a || !b ? (
        <EmptyState icon="⚖️" title="選兩檔 ETF" hint="輸入代號或名稱，或點上面的常見比較。網址會記住這兩檔，可以直接分享。" />
      ) : !extras ? (
        <p className="mt-6 text-center text-[13px] text-muted">持股資料載入中…</p>
      ) : a === b ? (
        <EmptyState icon="🔁" title="兩檔是同一檔" hint="換一檔再比。" />
      ) : !sa || !sb ? (
        <EmptyState icon="🔎" title={`${!sa ? a : b} 沒有持股資料`}
                    hint={(!sa ? etfA : etfB) ? missingReason(sectionOf(!sa ? a : b)) : '找不到這個代號。'} />
      ) : cmp && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[{ s: sa, e: etfA, tone: 'a' as const }, { s: sb, e: etfB, tone: 'b' as const }].map(({ s, e, tone }) => (
              <div key={s.code} className="rounded-lg border border-line bg-surface px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${tone === 'a' ? 'bg-accent' : 'bg-yield'}`} aria-hidden="true" />
                  <Link to="/etf" search={{ code: s.code }} className="font-mono text-[15px] font-bold text-accent hover:underline">{s.code}</Link>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{e?.name ?? ''}</span>
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted">{sourceLabel(s)}・涵蓋淨值 {nf1.format(s.covered)}%</div>
              </div>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="重疊度" value={`${nf1.format(cmp.overlap)}%`} sub="共同持股取較小佔比相加" />
            <Stat label="共同持股" value={`${cmp.common.length} 檔`} />
            <Stat label={`佔 ${a} 淨值`} value={`${nf1.format(cmp.sumA)}%`} sub="共同持股合計" />
            <Stat label={`佔 ${b} 淨值`} value={`${nf1.format(cmp.sumB)}%`} sub="共同持股合計" />
          </div>

          <section className="mt-4" aria-label="共同持股">
            <h2 className="mb-1 text-base font-bold text-ink">共同持股</h2>
            {cmp.common.length === 0 ? (
              <p className="text-[13px] text-muted">看得到的持股裡沒有共同持股。</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-line bg-surface">
                <table className="w-full table-fixed text-[12.5px]">
                  <thead>
                    <tr className="bg-sunken text-[11.5px] text-muted">
                      <th className="px-2 py-1.5 text-left font-normal">持股</th>
                      <th className="w-[26%] px-2 py-1.5 text-right font-normal"><span className="font-mono text-accent">{a}</span></th>
                      <th className="w-[26%] px-2 py-1.5 text-right font-normal"><span className="font-mono text-yield">{b}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cmp.common.map(c => (
                      <tr key={c.code} className="border-t border-line/50">
                        <td className="px-2 py-1">
                          {/^\d{4,6}[A-Z]?$/.test(c.code)
                            ? <Link to="/stock" search={{ code: c.code }} className="font-mono text-muted hover:underline">{c.code}</Link>
                            : <span className="font-mono text-muted">{c.code}</span>}
                          <div className="truncate text-ink">{c.name}</div>
                        </td>
                        <td className="px-2 py-1 text-right">
                          <span className={`font-mono tabular-nums ${c.a >= c.b ? 'font-semibold text-ink' : 'text-muted'}`}>{nf2.format(c.a)}%</span>
                          <Bar pct={c.a} max={max} tone="a" />
                        </td>
                        <td className="px-2 py-1 text-right">
                          <span className={`font-mono tabular-nums ${c.b >= c.a ? 'font-semibold text-ink' : 'text-muted'}`}>{nf2.format(c.b)}%</span>
                          <Bar pct={c.b} max={max} tone="b" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="不是共同的持股">
            <OnlyList code={a} other={sb} rows={cmp.onlyA} />
            <OnlyList code={b} other={sa} rows={cmp.onlyB} />
          </section>

          <p className="mt-3 max-w-[75ch] text-[11.5px] leading-relaxed text-faint">
            重疊度只算看得到的持股：月報只有前十大，前十大以外的共同持股算不到，所以實際重疊只會更多。
            {sa.kind !== sb.kind && ' 兩檔資料來源不同（每日 vs 月報），日期也不同，比例僅供參考。'}
            期貨部位不算持股。
          </p>
        </>
      )}
    </>
  );
}
