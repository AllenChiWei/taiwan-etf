/* 融資維持率空方策略（#/MAINT，私人頁，密碼同 v18）。
 * 2026-11-05 站主：維持率空方策略再加幾支、放到私人區，多一些統計與呈現；看這些空方策略的績效，以及和之前策略產生器的策略合併後的 Portfolio 效果。
 *
 * 資料由使用者電腦產生（D:\ai\_tmp\scripts_iso\maint_web_qt.py → maint_web_payload.py），DashBoard_AI\gen_export.py --set maint 加密成 data/gen/gen_maint.enc。
 * 兩組策略：maint（A～I，維持率低於門檻才放空）、gen（#/GEN 台指的多 15＋空 1）。組合在前端用 lib/genPortfolio.ts 重算：
 *   勾選框移出／放回策略、維持率空方的權重（×0～×3，只影響「合計」），所有數字跟著變。金額萬元；樣本內 ≤ isEnd。
 * 2026-11-06 站主：和策略產生器併成一頁 → 載入與解鎖都在 GenPage（上方切換「融資維持率空方」），這裡只剩畫面 MaintBoard；
 *   gen 組改成 #/GEN 台指的多 15＋空 8（D:\ai\_tmp\scripts_iso\maint_web1106_payload.py）。 */

import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { CATEGORY_COLORS } from '../lib/palette';
import { buildCombo, corr, toDaily, type ComboCalc, type Seg, type Stats, type Year } from '../lib/genPortfolio';
import { Card, GenPage, PlCode, YearBars, YearTable } from './GenPage';
import { cssVar, r2, sign, useEChart, wan } from '../lib/genChart';

type GroupId = 'maint' | 'gen';
type ComboId = GroupId | 'all';
interface TradeStats {
  n: number; avgWin: number | null; avgLoss: number | null; payoff: number | null; maxWin: number; maxLoss: number;
  lossStreak: number; exp: number; hold: number; holdMax: number;
}
interface Strat {
  id: string; key: string; group: GroupId; side: 'long' | 'short'; tf: number; entry: string; filter: string; exit: string; sess?: number;
  desc: string; note?: string; stats: Stats; years: Year[]; eq: number[];
  robust: { lines: string[]; passed: number | null; total: number | null } | null; pl: string;
  sqn?: number | null; rexp?: number | null; ulcer?: number | null;
  /** [進場日, 出場日, 損益萬]；只有維持率空方與 GS01 有 */
  trades: [string, string, number][] | null; ts: TradeStats | null;
}
export interface MaintData {
  generated: string; title: string; isEnd: string; notes: string[]; dates: string[];
  /** 當天晚上公布的維持率（%）；沒有＝null */
  maint: (number | null)[];
  /** 台指 HOT 日盤收盤 */
  txf: number[];
  /** 台指從前高跌 ≥ 12% 的期間（前高日 → 最低日） */
  stress: { a: string; b: string; dd: number }[];
  groups: { id: GroupId; label: string; desc: string }[];
  strategies: Strat[];
}

const LABEL: Record<ComboId, string> = { gen: '產生器原組合', maint: '維持率空方', all: '合計' };
/** 顏色跟著組合走（不跟排名）：原組合藍、維持率空方橘、合計紫 */
const COLOR: Record<ComboId, string> = { gen: CATEGORY_COLORS[0], maint: CATEGORY_COLORS[1], all: CATEGORY_COLORS[5] };
const WEIGHTS = [0, 0.5, 1, 1.5, 2, 3];
const W_KEY = 'twetf.maint.w';

/** 2026-11-06 站主：維持率和策略產生器併成一頁 → 舊網址 #/MAINT 直接開 #/GEN 的「融資維持率空方」 */
export function MaintPage() {
  return <GenPage initialSet="maint" />;
}

/** 權重放大一支策略（金額類 ×w；比值、交易數不變） */
function scaled(s: Strat, w: number) {
  if (w === 1) return s;
  const sg = (x: Seg): Seg => ({ ...x, net: x.net * w, mdd: x.mdd * w, gp: x.gp == null ? undefined : x.gp * w, gl: x.gl == null ? undefined : x.gl * w });
  return { eq: s.eq.map(v => v * w), stats: { all: sg(s.stats.all), is: sg(s.stats.is), os: sg(s.stats.os) }, years: s.years.map(y => ({ ...sg(y), y: y.y })) };
}

/** 回撤序列（萬，≤0）與最長水下期間（日曆天） */
function underwater(eq: number[], dates: string[]) {
  let pk = 0, pkI = 0, longest = 0, from = '', to = '';
  const dd = eq.map((v, i) => {
    if (v >= pk) {
      const days = (Date.parse(dates[i]) - Date.parse(dates[pkI])) / 864e5;
      if (days > longest && i > pkI + 1) { longest = days; from = dates[pkI]; to = dates[i]; }
      pk = v; pkI = i;
    }
    return Math.round((v - pk) * 10) / 10;
  });
  // 到最後還沒創新高：算到資料最後一天
  const tail = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[pkI])) / 864e5;
  if (tail > longest && pkI < dates.length - 1) { longest = tail; from = dates[pkI]; to = `${dates[dates.length - 1]}（還沒回到前高）`; }
  return { dd, longest: Math.round(longest), from, to };
}

const worstYear = (c: ComboCalc) => c.years.reduce((a, b) => (b.net < a.net ? b : a), c.years[0]);

function useOff(key: string) {
  const k = `twetf.maint.off|${key}`;
  const [off, setOff] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(k) ?? '[]') as string[]); } catch { return new Set(); }
  });
  const save = (s: Set<string>) => {
    setOff(s);
    try { localStorage.setItem(k, JSON.stringify([...s])); } catch { /* 存不了就算了 */ }
  };
  return [off, save] as const;
}

export function MaintBoard({ d }: { d: MaintData }) {
  const [off, setOff] = useOff(d.generated);
  const [w, setW] = useState<number>(() => {
    try { const v = Number(localStorage.getItem(W_KEY)); return WEIGHTS.includes(v) && localStorage.getItem(W_KEY) != null ? v : 1; } catch { return 1; }
  });
  const pickW = (v: number) => { setW(v); try { localStorage.setItem(W_KEY, String(v)); } catch { /* 存不了就算了 */ } };
  const [sel, setSel] = useState<string>('A');
  const detailRef = useRef<HTMLElement>(null);
  const pick = (id: string) => {
    setSel(id);
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const toggle = (ids: string[], on: boolean) => {
    const s = new Set(off);
    for (const id of ids) { if (on) s.delete(id); else s.add(id); }
    setOff(s);
  };

  const on = (g: GroupId) => d.strategies.filter(x => x.group === g && !off.has(x.id));
  const calc = useMemo(() => {
    const mk = (g: GroupId) => { const s = on(g); return s.length ? buildCombo(s, d.dates, d.isEnd) : null; };
    const gen = mk('gen'), maint = mk('maint');
    const allOf = (ww: number) => {
      const s = [...on('gen'), ...on('maint').map(x => scaled(x, ww))];
      return s.length ? buildCombo(s, d.dates, d.isEnd) : null;
    };
    const table = WEIGHTS.map(ww => ({ w: ww, c: allOf(ww) }));
    const all = table.find(x => x.w === w)?.c ?? allOf(w);
    return { gen, maint, all, table };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, off, w]);
  const combos: Record<ComboId, ComboCalc | null> = { gen: calc.gen, maint: calc.maint, all: calc.all };
  const s = d.strategies.find(x => x.id === sel) ?? d.strategies[0];
  const isYear = Number(d.isEnd.slice(0, 4));

  return (
    <div className="mt-3 min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h1 className="text-base font-bold text-ink">{d.title}</h1>
        <span className="text-[11.5px] text-faint">更新於 {d.generated}　·　<Link to="/me" className="hover:text-ink">← 我的工具</Link></span>
      </div>
      <details className="mb-3 rounded-xl border border-line bg-surface p-3 text-[12.5px] text-muted">
        <summary className="cursor-pointer font-semibold text-ink">怎麼做出來的、數字怎麼看</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 leading-relaxed">
          {d.notes.map((t, i) => <li key={i}>{t}</li>)}
          <li>下面的策略表可以用勾選框把策略移出組合；「維持率空方的份量」只改「合計」裡維持率空方的口數倍數（×1＝和回測一樣）。兩個設定都記在這台瀏覽器。</li>
        </ul>
      </details>

      <Summary d={d} combos={combos} w={w} />
      <WeightTable d={d} rows={calc.table} w={w} onPick={pickW} />

      <Section title="權益曲線" sub={`三條組合的累積淨利（萬）。淡紅底＝台指從前高跌 12% 以上的期間；虛線右邊是樣本外（${isYear + 1} 起）。`}>
        <ComboEquity d={d} combos={combos} />
        <Underwater d={d} combos={combos} />
      </Section>

      <Section title="台指大跌時的表現" sub="台指從前高跌 ≥ 12% 的每一段（前高日 → 最低日）各組合賺賠多少（萬）。維持率空方的角色就是這幾段。">
        <StressTable d={d} combos={combos} />
      </Section>

      <Section title="每年績效" sub="三組每年淨利（萬）；表格多了年內 MDD 和那年維持率低於 155 的天數。">
        <YearGroupBars d={d} combos={combos} isYear={isYear} />
        <YearGroupTable d={d} combos={combos} isYear={isYear} />
      </Section>

      <Section title="融資維持率與進場點" sub="維持率（上市＋上櫃）、155／160 門檻線、維持率低於 155 的期間（淡紅底）；點＝選取策略（維持率空方才有）的每筆進場，紅＝賺、綠＝賠。">
        <MaintChart d={d} s={s} off={off} />
      </Section>

      <Section title="每月損益" sub="每格＝那個月的淨利（萬），紅賺綠賠，顏色越深金額越大。">
        <MonthHeat d={d} combos={combos} s={s} />
      </Section>

      <Section title="相關係數" sub="每日損益的相關；維持率空方大部分時間空手，和多單組合、台指的相關接近 0 或負的，這就是它能降低組合回撤的原因。">
        <CorrMatrix d={d} off={off} gen={calc.gen} />
      </Section>

      <StratTable d={d} off={off} sel={sel} onSel={pick} onToggle={toggle} />

      <section ref={detailRef} className="mt-4 scroll-mt-16 rounded-xl border border-line bg-surface p-3">
        <Detail d={d} s={s} off={off.has(s.id)} isYear={isYear} />
      </section>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-3">
      <h2 className="text-[14px] font-bold text-ink">{title}</h2>
      {sub && <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{sub}</p>}
      {children}
    </section>
  );
}

/** 最上面：三組合並排＋加入維持率空方後的變化 */
function Summary({ d, combos, w }: { d: MaintData; combos: Record<ComboId, ComboCalc | null>; w: number }) {
  const g = combos.gen, a = combos.all;
  const delta = (x: number | null | undefined, y: number | null | undefined, k = 2, invert = false) => {
    if (x == null || y == null) return null;
    const v = y - x;
    const good = invert ? v <= 0 : v >= 0;
    return <span className={good ? 'text-up' : 'text-down'}>{v >= 0 ? '+' : ''}{k ? v.toFixed(k) : wan(v)}</span>;
  };
  const days155 = d.maint.filter(v => v != null && v < 155).length, daysAll = d.maint.filter(v => v != null).length;
  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-3">
        {(['gen', 'maint', 'all'] as ComboId[]).map(k => {
          const c = combos[k];
          const n = k === 'all' ? null : d.strategies.filter(x => x.group === k).length;
          const uw = c ? underwater(c.eq, d.dates) : null;
          const wy = c ? worstYear(c) : null;
          return (
            <div key={k} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR[k] }} />
                <span className="text-[13.5px] font-bold text-ink">{LABEL[k]}</span>
                <span className="text-[11.5px] text-faint">{k === 'all' ? `原組合＋維持率空方 ×${w}` : `${c?.n ?? 0}／${n} 支`}</span>
              </div>
              {c ? (
                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] tabular-nums text-muted">
                  <div>淨利 <b className={sign(c.stats.all.net)}>{wan(c.stats.all.net)}</b> 萬</div>
                  <div>MDD <b className="text-ink">{wan(c.stats.all.mdd)}</b> 萬</div>
                  <div>淨利÷MDD <b className="text-[15px] text-ink">{r2(c.stats.all.nd)}</b></div>
                  <div>獲利因子 <b className="text-ink">{r2(c.stats.all.pf)}</b></div>
                  <div>樣本內 <b className="text-ink">{r2(c.stats.is.nd)}</b></div>
                  <div>樣本外 <b className={sign(c.stats.os.nd)}>{r2(c.stats.os.nd)}</b></div>
                  <div>最差年 {wy?.y} <b className={sign(wy?.net ?? 0)}>{wan(wy?.net ?? 0)}</b></div>
                  <div>賺錢年 <b className="text-ink">{c.years.filter(y => y.net > 0).length}／{c.years.length}</b></div>
                  <div className="col-span-2">最長沒創新高 <b className="text-ink">{uw?.longest}</b> 天<span className="text-faint">（{uw?.from} → {uw?.to}）</span></div>
                </div>
              ) : <p className="mt-2 text-[12px] text-muted">全部移出了</p>}
            </div>
          );
        })}
      </div>
      {g && a && (
        <div className="mt-2 rounded-xl border border-accent/40 bg-surface p-2.5 text-[12.5px] leading-relaxed text-muted">
          <b className="text-ink">原組合加入維持率空方（×{w}）後：</b>
          淨利÷MDD {r2(g.stats.all.nd)} → <b className="text-ink">{r2(a.stats.all.nd)}</b>（{delta(g.stats.all.nd, a.stats.all.nd)}）、
          樣本外 {r2(g.stats.os.nd)} → <b className="text-ink">{r2(a.stats.os.nd)}</b>（{delta(g.stats.os.nd, a.stats.os.nd)}）、
          MDD {wan(g.stats.all.mdd)} → <b className="text-ink">{wan(a.stats.all.mdd)}</b> 萬（{delta(g.stats.all.mdd, a.stats.all.mdd, 0, true)}）、
          淨利 {wan(g.stats.all.net)} → {wan(a.stats.all.net)} 萬、最差年 {wan(worstYear(g).net)} → {wan(worstYear(a).net)} 萬。
          原組合和維持率空方每日損益的相關 <b className="text-ink">{combos.maint ? corr(toDaily(g.eq), toDaily(combos.maint.eq)).toFixed(2) : '—'}</b>。
          <span className="text-faint"> 2014 起維持率低於 155 的交易日 {days155} 天（{(days155 / Math.max(1, daysAll) * 100).toFixed(1)}%），其他時間維持率空方都空手。</span>
        </div>
      )}
    </div>
  );
}

/** 維持率空方放多少：×0（不放）～×3，合計的變化一次看完 */
function WeightTable({ d, rows, w, onPick }: { d: MaintData; rows: { w: number; c: ComboCalc | null }[]; w: number; onPick: (w: number) => void }) {
  return (
    <Section title="維持率空方要放多少" sub="合計＝原組合＋維持率空方 × 倍數（每支口數乘上倍數）。點一列套用到整頁的「合計」。">
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead><tr className="text-muted">
            {['倍數', '淨利（萬）', 'MDD（萬）', '淨利÷MDD', '樣本內', '樣本外', '獲利因子', '最差年（萬）', '最長沒創新高'].map((h, i) => (
              <th key={h} className={`py-1 font-semibold whitespace-nowrap ${i ? 'pl-2 text-right' : 'pr-2 text-left'}`}>{h}</th>
            ))}
          </tr></thead>
          <tbody>{rows.map(({ w: ww, c }) => {
            if (!c) return null;
            const best = Math.max(...rows.map(r => r.c?.stats.all.nd ?? -1e9));
            const wy = worstYear(c);
            return (
              <tr key={ww} onClick={() => onPick(ww)} aria-selected={ww === w}
                  className={`cursor-pointer border-t border-line tabular-nums ${ww === w ? 'bg-sunken' : 'hover:bg-hover'}`}>
                <td className="py-1.5 pr-2 font-semibold text-ink whitespace-nowrap">×{ww}{ww === 0 ? '（只有原組合）' : ww === 1 ? '（同回測）' : ''}</td>
                <td className="pl-2 text-right text-ink">{wan(c.stats.all.net)}</td>
                <td className="pl-2 text-right text-ink">{wan(c.stats.all.mdd)}</td>
                <td className={`pl-2 text-right font-semibold ${c.stats.all.nd === best ? 'text-accent' : 'text-ink'}`}>{r2(c.stats.all.nd)}</td>
                <td className="pl-2 text-right text-ink">{r2(c.stats.is.nd)}</td>
                <td className="pl-2 text-right text-ink">{r2(c.stats.os.nd)}</td>
                <td className="pl-2 text-right text-ink">{r2(c.stats.all.pf)}</td>
                <td className={`pl-2 text-right ${sign(wy.net)}`}>{wy.y}：{wan(wy.net)}</td>
                <td className="pl-2 text-right text-ink whitespace-nowrap">{underwater(c.eq, d.dates).longest} 天</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-faint">倍數越大，崩跌年賺越多，但維持率空方自己的回撤（集中在少數幾段）也跟著放大；倍數是用全期結果比出來的，有事後挑選的成分，實盤建議從 ×1 以下開始。</p>
    </Section>
  );
}

/** 台指跌 ≥12% 的期間：淡紅底 markArea（共用） */
function crashArea(d: MaintData) {
  return {
    silent: true, itemStyle: { color: 'rgba(214,69,69,0.08)' },
    data: d.stress.map(x => [{ xAxis: x.a }, { xAxis: x.b }]),
  };
}
const isLine = (d: MaintData) => {
  const cut = d.dates.find(x => x > d.isEnd);
  return cut ? { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: cssVar('--c-muted'), width: 1 }, label: { show: false }, data: [{ xAxis: cut }] } : undefined;
};
const axisBase = (d: MaintData) => {
  const ink = cssVar('--c-muted'), grid = cssVar('--c-border');
  return {
    xAxis: { type: 'category', data: d.dates, axisLabel: { fontSize: 10, color: ink }, axisLine: { lineStyle: { color: grid } } },
    yAxis: { type: 'value', scale: true, axisLabel: { fontSize: 10, color: ink, formatter: (v: number) => wan(v) }, splitLine: { lineStyle: { color: grid, opacity: 0.6 } } },
    ink,
  };
};

function ComboEquity({ d, combos }: { d: MaintData; combos: Record<ComboId, ComboCalc | null> }) {
  const opt = useMemo(() => {
    const { xAxis, yAxis, ink } = axisBase(d);
    const ks = (['all', 'gen', 'maint'] as ComboId[]).filter(k => combos[k]);
    return {
      animation: false, grid: { left: 56, right: 12, top: 30, bottom: 44 },
      legend: { top: 0, textStyle: { fontSize: 11, color: ink }, itemWidth: 14 },
      tooltip: { trigger: 'axis', confine: true, valueFormatter: (v: number) => `${wan(v)} 萬` },
      xAxis, yAxis: { ...yAxis, scale: false }, dataZoom: [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 6 }],
      series: ks.map((k, i) => ({
        name: LABEL[k], type: 'line', showSymbol: false, data: combos[k]!.eq, color: cssVar(COLOR[k]),
        lineStyle: { width: k === 'all' ? 2.2 : 1.6 },
        ...(i === 0 ? { markArea: crashArea(d), markLine: isLine(d) } : {}),
      })),
    };
  }, [d, combos]);
  const el = useEChart(opt);
  return <div ref={el} className="mt-2 h-[300px] w-full overflow-hidden sm:h-[380px]" />;
}

function Underwater({ d, combos }: { d: MaintData; combos: Record<ComboId, ComboCalc | null> }) {
  const opt = useMemo(() => {
    const { xAxis, yAxis, ink } = axisBase(d);
    const ks = (['all', 'gen', 'maint'] as ComboId[]).filter(k => combos[k]);
    return {
      animation: false, grid: { left: 56, right: 12, top: 28, bottom: 44 },
      title: { text: '回撤（距前高，萬）', left: 0, top: 0, textStyle: { fontSize: 12, color: ink, fontWeight: 'normal' } },
      tooltip: { trigger: 'axis', confine: true, valueFormatter: (v: number) => `${wan(v)} 萬` },
      xAxis, yAxis: { ...yAxis, scale: false }, dataZoom: [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 6 }],
      series: ks.map((k, i) => ({
        name: LABEL[k], type: 'line', showSymbol: false, data: underwater(combos[k]!.eq, d.dates).dd, color: cssVar(COLOR[k]),
        lineStyle: { width: k === 'all' ? 1.8 : 1.2 }, areaStyle: k === 'all' ? { opacity: 0.12 } : undefined,
        ...(i === 0 ? { markArea: crashArea(d) } : {}),
      })),
    };
  }, [d, combos]);
  const el = useEChart(opt);
  return <div ref={el} className="mt-3 h-[200px] w-full overflow-hidden sm:h-[230px]" />;
}

function StressTable({ d, combos }: { d: MaintData; combos: Record<ComboId, ComboCalc | null> }) {
  const at = (x: string) => d.dates.indexOf(x);
  const pnl = (c: ComboCalc | null, a: number, b: number) => (c ? c.eq[b] - c.eq[a] : null);
  const ks: ComboId[] = ['gen', 'maint', 'all'];
  const tot: Record<ComboId, number> = { gen: 0, maint: 0, all: 0 };
  const rows = d.stress.map(x => {
    const a = at(x.a), b = at(x.b);
    const v = Object.fromEntries(ks.map(k => [k, pnl(combos[k], a, b)])) as Record<ComboId, number | null>;
    ks.forEach(k => { tot[k] += v[k] ?? 0; });
    return { ...x, v, days: Math.round((Date.parse(x.b) - Date.parse(x.a)) / 864e5) };
  });
  const cell = (v: number | null) => <td className={`pl-2 text-right ${sign(v)}`}>{v == null ? '—' : wan(v)}</td>;
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead><tr className="text-muted">
          {['期間（前高 → 最低）', '天數', '台指', ...ks.map(k => `${LABEL[k]}`)].map((h, i) => (
            <th key={h} className={`py-1 font-semibold whitespace-nowrap ${i ? 'pl-2 text-right' : 'pr-2 text-left'}`}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.a} className="border-t border-line tabular-nums">
              <td className="py-1.5 pr-2 text-ink whitespace-nowrap">{r.a} → {r.b}</td>
              <td className="pl-2 text-right text-muted">{r.days}</td>
              <td className="pl-2 text-right text-down">{r.dd.toFixed(1)}%</td>
              {ks.map(k => <Fragment key={k}>{cell(r.v[k])}</Fragment>)}
            </tr>
          ))}
          <tr className="border-t-2 border-line font-semibold tabular-nums">
            <td className="py-1.5 pr-2 text-ink">合計 {rows.length} 段</td><td /><td />
            {ks.map(k => <Fragment key={k}>{cell(tot[k])}</Fragment>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function YearGroupBars({ d, combos, isYear }: { d: MaintData; combos: Record<ComboId, ComboCalc | null>; isYear: number }) {
  const opt = useMemo(() => {
    const { ink } = axisBase(d);
    const grid = cssVar('--c-border');
    const ks = (['gen', 'maint', 'all'] as ComboId[]).filter(k => combos[k]);
    const years = (combos.all ?? combos.gen ?? combos.maint)?.years.map(y => y.y) ?? [];
    return {
      animation: false, grid: { left: 56, right: 12, top: 30, bottom: 28 },
      legend: { top: 0, textStyle: { fontSize: 11, color: ink }, itemWidth: 14 },
      tooltip: { trigger: 'axis', confine: true, valueFormatter: (v: number) => `${wan(v)} 萬` },
      xAxis: { type: 'category', data: years.map(y => (y > isYear ? `${y}*` : String(y))), axisLabel: { fontSize: 10, color: ink }, axisLine: { lineStyle: { color: grid } } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10, color: ink, formatter: (v: number) => wan(v) }, splitLine: { lineStyle: { color: grid, opacity: 0.6 } } },
      series: ks.map(k => ({
        name: LABEL[k], type: 'bar', barMaxWidth: 16, color: cssVar(COLOR[k]),
        itemStyle: { borderRadius: [3, 3, 0, 0] }, data: combos[k]!.years.map(y => y.net),
      })),
    };
  }, [d, combos, isYear]);
  const el = useEChart(opt);
  return <div ref={el} className="mt-2 h-[240px] w-full overflow-hidden" />;
}

function YearGroupTable({ d, combos, isYear }: { d: MaintData; combos: Record<ComboId, ComboCalc | null>; isYear: number }) {
  const ks: ComboId[] = ['gen', 'maint', 'all'];
  const years = (combos.all ?? combos.gen ?? combos.maint)?.years ?? [];
  const low = (y: number) => d.maint.filter((v, i) => v != null && v < 155 && d.dates[i].startsWith(String(y))).length;
  const yr = (c: ComboCalc | null, y: number) => c?.years.find(v => v.y === y);
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-muted">
            <th className="py-1 pr-2 text-left font-semibold" rowSpan={2}>年</th>
            {ks.map(k => <th key={k} colSpan={2} className="pl-2 text-right font-semibold whitespace-nowrap">{LABEL[k]}</th>)}
            <th className="pl-2 text-right font-semibold whitespace-nowrap" rowSpan={2}>維持率&lt;155</th>
          </tr>
          <tr className="text-[11px] text-faint">
            {ks.map(k => <Fragment key={k}><th className="pl-2 text-right font-normal">淨利</th><th className="pl-2 text-right font-normal">MDD</th></Fragment>)}
          </tr>
        </thead>
        <tbody>{years.map(({ y }) => (
          <tr key={y} className="border-t border-line tabular-nums">
            <td className="py-1.5 pr-2 text-muted whitespace-nowrap">{y}{y > isYear && <span className="ml-1 text-[10.5px] text-faint">樣本外</span>}</td>
            {ks.map(k => {
              const v = yr(combos[k], y);
              return <Fragment key={k}>
                <td className={`pl-2 text-right ${sign(v?.net ?? null)}`}>{v ? wan(v.net) : '—'}</td>
                <td className="pl-2 text-right text-muted">{v ? wan(v.mdd) : '—'}</td>
              </Fragment>;
            })}
            <td className="pl-2 text-right text-ink">{low(y) || '—'}{low(y) ? ' 天' : ''}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** 維持率走勢：155／160 線、低於 155 的期間、選取策略的進場點 */
function MaintChart({ d, s, off }: { d: MaintData; s: Strat; off: Set<string> }) {
  const opt = useMemo(() => {
    const { xAxis, yAxis, ink } = axisBase(d);
    const up = cssVar('--c-up'), down = cssVar('--c-down');
    // 低於 155 的連續期間
    const areas: { xAxis: string }[][] = [];
    let st = -1;
    d.maint.forEach((v, i) => {
      const low = v != null && v < 155;
      if (low && st < 0) st = i;
      if (!low && st >= 0) { areas.push([{ xAxis: d.dates[st] }, { xAxis: d.dates[i - 1] }]); st = -1; }
    });
    if (st >= 0) areas.push([{ xAxis: d.dates[st] }, { xAxis: d.dates[d.dates.length - 1] }]);
    const idx = new Map(d.dates.map((x, i) => [x, i]));
    const list = s.group === 'maint' && s.trades ? [s] : d.strategies.filter(x => x.group === 'maint' && x.trades && !off.has(x.id));
    const pts = list.flatMap(x => (x.trades ?? []).map(t => {
      const i = idx.get(t[0]) ?? d.dates.findIndex(v => v >= t[0]);
      const m = i >= 0 ? d.maint.slice(0, i + 1).reverse().find(v => v != null) ?? null : null;
      return { value: [i >= 0 ? d.dates[i] : t[0], m], id: x.id, t, itemStyle: { color: t[2] >= 0 ? up : down } };
    }));
    return {
      animation: false, grid: { left: 44, right: 12, top: 30, bottom: 44 },
      legend: { top: 0, textStyle: { fontSize: 11, color: ink }, itemWidth: 14, data: ['融資維持率', `${list.length === 1 ? list[0].id : '維持率空方'} 進場`] },
      tooltip: {
        trigger: 'item', confine: true,
        formatter: (p: { seriesType: string; data: { id: string; t: [string, string, number] } | number; name: string; value: unknown }) => {
          if (p.seriesType === 'scatter' && typeof p.data === 'object') {
            const t = p.data.t;
            return `${p.data.id}｜進 ${t[0]} → 出 ${t[1]}<br/>損益 ${t[2] >= 0 ? '+' : ''}${wan(t[2])} 萬`;
          }
          return `${p.name}｜維持率 ${p.value}%`;
        },
      },
      xAxis, yAxis: { ...yAxis, axisLabel: { ...yAxis.axisLabel, formatter: (v: number) => `${v}` } },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 6 }],
      series: [
        {
          name: '融資維持率', type: 'line', showSymbol: false, connectNulls: true, data: d.maint, color: cssVar('--cat-1'), lineStyle: { width: 1.4 },
          markArea: { silent: true, itemStyle: { color: 'rgba(214,69,69,0.10)' }, data: areas },
          markLine: {
            silent: true, symbol: 'none', label: { color: ink, fontSize: 10, formatter: '{c}' },
            data: [{ yAxis: 155, lineStyle: { color: down, type: 'dashed' } }, { yAxis: 160, lineStyle: { color: cssVar('--c-muted'), type: 'dotted' } }],
          },
        },
        { name: `${list.length === 1 ? list[0].id : '維持率空方'} 進場`, type: 'scatter', symbolSize: 8, data: pts, color: up, z: 5,
          itemStyle: { borderColor: cssVar('--c-surface'), borderWidth: 1 } },
      ],
    };
  }, [d, s, off]);
  const el = useEChart(opt);
  return <div ref={el} className="mt-2 h-[280px] w-full overflow-hidden sm:h-[320px]" />;
}

function MonthHeat({ d, combos, s }: { d: MaintData; combos: Record<ComboId, ComboCalc | null>; s: Strat }) {
  const [k, setK] = useState<string>('all');
  const opts: [string, string][] = [['all', LABEL.all], ['maint', LABEL.maint], ['gen', LABEL.gen], [s.id, `選取：${s.id}`]];
  const eq = k === 'all' || k === 'maint' || k === 'gen' ? combos[k as ComboId]?.eq : s.eq;
  const grid = useMemo(() => {
    const m = new Map<number, number[]>();
    if (!eq) return m;
    const daily = toDaily(eq);
    d.dates.forEach((x, i) => {
      const y = Number(x.slice(0, 4)), mo = Number(x.slice(5, 7)) - 1;
      if (!m.has(y)) m.set(y, new Array(12).fill(0));
      m.get(y)![mo] += daily[i];
    });
    return m;
  }, [d, eq]);
  const max = Math.max(1, ...[...grid.values()].flat().map(Math.abs));
  const bg = (v: number) => {
    const p = Math.round(Math.min(1, Math.abs(v) / max) ** 0.6 * 70);
    return Math.abs(v) < 0.05 ? undefined : `color-mix(in srgb, var(${v >= 0 ? '--c-up' : '--c-down'}) ${p}%, transparent)`;
  };
  return (
    <div>
      <div role="tablist" aria-label="看哪一組" className="mt-2 flex flex-wrap gap-1.5">
        {opts.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={k === id} onClick={() => setK(id)}
                  className={`h-7 rounded-full px-3 text-[12px] font-semibold ${k === id ? 'bg-accent text-white' : 'bg-sunken text-muted hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] text-[11.5px] tabular-nums">
          <thead><tr className="text-muted">
            <th className="py-1 pr-2 text-left font-semibold">年</th>
            {Array.from({ length: 12 }, (_, i) => <th key={i} className="px-0.5 text-right font-semibold">{i + 1}月</th>)}
            <th className="pl-2 text-right font-semibold">全年</th>
          </tr></thead>
          <tbody>{[...grid.entries()].map(([y, row]) => {
            const tot = row.reduce((a, b) => a + b, 0);
            return (
              <tr key={y} className="border-t border-line">
                <td className="py-1 pr-2 text-muted">{y}</td>
                {row.map((v, i) => <td key={i} className="px-1 py-1 text-right text-ink" style={{ background: bg(v) }}>{Math.abs(v) < 0.05 ? '' : wan(v)}</td>)}
                <td className={`pl-2 text-right font-semibold ${sign(tot)}`}>{wan(tot)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

function CorrMatrix({ d, off, gen }: { d: MaintData; off: Set<string>; gen: ComboCalc | null }) {
  const cols = useMemo(() => {
    const c: { id: string; daily: number[] }[] = d.strategies.filter(x => x.group === 'maint' && !off.has(x.id)).map(x => ({ id: x.id, daily: toDaily(x.eq) }));
    if (gen) c.push({ id: '原組合', daily: toDaily(gen.eq) });
    c.push({ id: '台指', daily: d.txf.map((v, i) => (i ? v - d.txf[i - 1] : 0)) });
    return c;
  }, [d, off, gen]);
  const m = useMemo(() => cols.map(a => cols.map(b => corr(a.daily, b.daily))), [cols]);
  const bg = (v: number) => `color-mix(in srgb, var(${v >= 0 ? '--c-up' : '--c-down'}) ${Math.round(Math.min(1, Math.abs(v)) * 60)}%, transparent)`;
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="text-[11.5px] tabular-nums">
        <thead><tr className="text-muted">
          <th />
          {cols.map(c => <th key={c.id} className="px-1.5 py-1 text-center font-semibold whitespace-nowrap">{c.id}</th>)}
        </tr></thead>
        <tbody>{cols.map((a, i) => (
          <tr key={a.id}>
            <th className="py-1 pr-2 text-left font-semibold text-muted whitespace-nowrap">{a.id}</th>
            {cols.map((b, j) => (
              <td key={b.id} className="h-8 min-w-[44px] px-1 text-center text-ink" style={{ background: i === j ? 'var(--c-sunken)' : bg(m[i][j]) }}>
                {i === j ? '' : m[i][j].toFixed(2)}
              </td>
            ))}
          </tr>
        ))}</tbody>
      </table>
      <p className="mt-1 text-[11px] text-faint">紅＝正相關、綠＝負相關；「台指」＝台指日盤收盤每日漲跌點數。</p>
    </div>
  );
}

function StratTable({ d, off, sel, onSel, onToggle }: {
  d: MaintData; off: Set<string>; sel: string; onSel: (id: string) => void; onToggle: (ids: string[], on: boolean) => void;
}) {
  const head = ['策略', '淨利（萬）', '淨利÷MDD', '獲利因子', '樣本內 ÷MDD', '樣本外 ÷MDD', '交易／勝率', '平均持有', '防過擬合'];
  return (
    <section className="mt-4">
      <h2 className="mb-1 text-[14px] font-bold text-ink">各支策略</h2>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-[12.5px]">
          <thead><tr className="text-muted">
            <th className="w-8 px-2 py-2" />
            {head.map((h, i) => <th key={h} className={`px-2 py-2 font-semibold whitespace-nowrap ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}
          </tr></thead>
          <tbody>
            {d.groups.map(g => {
              const list = d.strategies.filter(x => x.group === g.id);
              const nOn = list.filter(x => !off.has(x.id)).length;
              return (
                <Fragment key={g.id}>
                  <tr className="border-t border-line bg-sunken/60">
                    <td className="px-2 text-center">
                      <input type="checkbox" aria-label={`${g.label}全部開／關`} checked={nOn === list.length}
                             ref={el => { if (el) el.indeterminate = nOn > 0 && nOn < list.length; }}
                             onChange={e => onToggle(list.map(x => x.id), e.target.checked)} />
                    </td>
                    <td colSpan={head.length} className="px-2 py-1.5 text-[12px]">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: COLOR[g.id] }} />
                      <b className="text-ink">{g.label}</b> <span className="text-muted">{nOn}／{list.length} 支｜{g.desc}</span>
                    </td>
                  </tr>
                  {list.map(x => {
                    const st = x.stats;
                    const active = x.id === sel;
                    return (
                      <tr key={x.id} onClick={() => onSel(x.id)} aria-selected={active}
                          className={`cursor-pointer border-t border-line tabular-nums ${active ? 'bg-sunken' : 'hover:bg-hover'} ${off.has(x.id) ? 'opacity-45' : ''}`}>
                        <td className="px-2 text-center" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" aria-label={`${x.id} 放進組合`} checked={!off.has(x.id)} onChange={e => onToggle([x.id], e.target.checked)} />
                        </td>
                        <td className="max-w-[280px] px-2 py-1.5">
                          <div className="font-semibold text-ink">{x.id}<span className="ml-1.5 text-[11px] font-normal text-muted">{x.side === 'long' ? '多' : '空'}｜{x.tf >= 1440 ? '日K' : `${x.tf}分`}</span></div>
                          <div className="truncate text-[11px] text-faint" title={x.desc}>{x.entry}｜{x.filter}｜{x.exit}</div>
                        </td>
                        <td className={`px-2 text-right ${sign(st.all.net)}`}>{wan(st.all.net)}</td>
                        <td className="px-2 text-right text-ink">{r2(st.all.nd)}</td>
                        <td className="px-2 text-right text-ink">{r2(st.all.pf)}</td>
                        <td className="px-2 text-right text-ink">{r2(st.is.nd)}</td>
                        <td className={`px-2 text-right ${sign(st.os.nd)}`}>{st.os.trades ? r2(st.os.nd) : '沒交易'}</td>
                        <td className="px-2 text-right text-muted whitespace-nowrap">{st.all.trades}／{st.all.win ?? '—'}%</td>
                        <td className="px-2 text-right text-muted whitespace-nowrap">{x.ts ? `${x.ts.hold} 天` : '—'}</td>
                        <td className="px-2 text-right text-muted">{x.robust?.passed != null ? `${x.robust.passed}/${x.robust.total}` : '—'}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-faint">點一列看那支的曲線、回撤、每年績效、交易明細與 PowerLanguage；勾選框把策略移出／放回組合（上面所有組合數字跟著重算）。平均持有＝日曆天。</p>
    </section>
  );
}

function Detail({ d, s, off, isYear }: { d: MaintData; s: Strat; off: boolean; isYear: number }) {
  const t = s.ts;
  const uw = useMemo(() => underwater(s.eq, d.dates), [s, d]);
  return (
    <>
      <h2 className="text-[14px] font-bold text-ink">{s.id}　{s.side === 'long' ? '多單' : '空單'}｜{s.tf >= 1440 ? '日K' : `${s.tf}分 K`}{off ? '（已移出組合）' : ''}</h2>
      <p className="mt-0.5 text-[12px] text-muted">{s.desc}</p>
      {s.note && <p className="mt-0.5 text-[11.5px] text-faint">{s.note}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="全期淨利" value={`${wan(s.stats.all.net)} 萬`} cls={sign(s.stats.all.net)} sub={`MDD ${wan(s.stats.all.mdd)} 萬`} />
        <Card label="淨利÷MDD" value={r2(s.stats.all.nd)} sub={`樣本內 ${r2(s.stats.is.nd)}／樣本外 ${s.stats.os.trades ? r2(s.stats.os.nd) : '沒交易'}`} />
        <Card label="獲利因子" value={r2(s.stats.all.pf)} sub={`樣本內 ${r2(s.stats.is.pf)}／樣本外 ${r2(s.stats.os.pf)}`} />
        <Card label="交易次數／勝率" value={s.stats.all.trades.toLocaleString('zh-TW')} sub={s.stats.all.win == null ? '' : `勝率 ${s.stats.all.win}%`} />
        {t && <>
          <Card label="平均每筆" value={`${t.exp >= 0 ? '+' : ''}${t.exp.toFixed(1)} 萬`} cls={sign(t.exp)} sub={`賺 ${t.avgWin ?? '—'}／賠 ${t.avgLoss ?? '—'} 萬`} />
          <Card label="賺賠比" value={r2(t.payoff)} sub={`最大單筆 +${wan(t.maxWin)}／${wan(t.maxLoss)} 萬`} />
          <Card label="最多連賠" value={`${t.lossStreak} 筆`} sub={`平均持有 ${t.hold} 天、最長 ${t.holdMax} 天`} />
        </>}
        <Card label="最長沒創新高" value={`${uw.longest} 天`} sub={uw.from ? `${uw.from} → ${uw.to}` : ''} />
        {s.sqn != null && <Card label="SQN／R 期望值" value={r2(s.sqn)} sub={`R 期望值 ${r2(s.rexp)}、Ulcer ${r2(s.ulcer)}`} />}
        <Card label="賺錢年份" value={`${s.years.filter(y => y.net > 0).length}／${s.years.filter(y => y.trades > 0).length}`} sub="有交易的年份" />
      </div>
      <StratEquity d={d} s={s} dd={uw.dd} />
      <YearBars years={s.years} isYear={isYear} />
      <YearTable years={s.years} isYear={String(isYear)} />
      {s.trades && s.trades.length > 0 && <Trades d={d} s={s} />}
      {s.robust && (
        <div className="mt-3 rounded-lg bg-sunken p-2.5 text-[12px] leading-relaxed text-muted">
          <div className="font-semibold text-ink">防過擬合檢查{s.robust.passed != null ? `（全期，通過 ${s.robust.passed}/${s.robust.total}；上線門檻 4 項）` : ''}</div>
          {s.robust.lines.map((x, i) => <p key={i} className="mt-0.5">{x}</p>)}
        </div>
      )}
      {s.pl && <PlCode id={s.id} code={s.pl} />}
    </>
  );
}

/** 單支：權益（上）＋回撤（下），同一條時間軸 */
function StratEquity({ d, s, dd }: { d: MaintData; s: Strat; dd: number[] }) {
  const opt = useMemo(() => {
    const { xAxis, yAxis, ink } = axisBase(d);
    return {
      animation: false,
      grid: [{ left: 56, right: 12, top: 16, height: '56%' }, { left: 56, right: 12, top: '72%', bottom: 44 }],
      tooltip: { trigger: 'axis', confine: true, valueFormatter: (v: number) => `${wan(v)} 萬` },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      xAxis: [{ ...xAxis, gridIndex: 0, axisLabel: { show: false } }, { ...xAxis, gridIndex: 1 }],
      yAxis: [{ ...yAxis, gridIndex: 0, scale: false }, { ...yAxis, gridIndex: 1, scale: false, splitNumber: 2, name: '回撤', nameTextStyle: { fontSize: 10, color: ink } }],
      dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }, { type: 'slider', xAxisIndex: [0, 1], height: 14, bottom: 6 }],
      series: [
        { name: s.id, type: 'line', showSymbol: false, data: s.eq, color: cssVar(COLOR[s.group]), lineStyle: { width: 2 }, areaStyle: { opacity: 0.08 },
          markArea: crashArea(d), markLine: isLine(d) },
        { name: '回撤', type: 'line', showSymbol: false, data: dd, xAxisIndex: 1, yAxisIndex: 1, color: cssVar('--c-down'), lineStyle: { width: 1 }, areaStyle: { opacity: 0.25 } },
      ],
    };
  }, [d, s, dd]);
  const el = useEChart(opt);
  return <div ref={el} className="mt-3 h-[320px] w-full overflow-hidden sm:h-[380px]" />;
}

function Trades({ d, s }: { d: MaintData; s: Strat }) {
  const rows = [...(s.trades ?? [])].reverse();
  const mAt = (x: string) => {
    const i = d.dates.findIndex(v => v >= x);
    return i > 0 ? d.maint.slice(0, i).reverse().find(v => v != null) ?? null : null;
  };
  const txAt = (x: string) => { const i = d.dates.indexOf(x); return i >= 0 ? d.txf[i] : null; };
  return (
    <details className="mt-3 rounded-lg border border-line" open={rows.length <= 20}>
      <summary className="cursor-pointer px-2.5 py-2 text-[12.5px] font-semibold text-ink">每筆交易（{rows.length} 筆，新的在上面）</summary>
      <div className="max-h-[420px] overflow-auto border-t border-line">
        <table className="w-full text-[12px] tabular-nums">
          <thead className="sticky top-0 bg-surface"><tr className="text-muted">
            {['進場日', '出場日', '持有', '進場前維持率', '台指（進→出）', '損益（萬）'].map((h, i) => (
              <th key={h} className={`px-2 py-1 font-semibold whitespace-nowrap ${i ? 'text-right' : 'text-left'}`}>{h}</th>
            ))}
          </tr></thead>
          <tbody>{rows.map((t, i) => {
            const a = txAt(t[0]), b = txAt(t[1]);
            return (
              <tr key={i} className="border-t border-line">
                <td className="px-2 py-1 text-ink whitespace-nowrap">{t[0]}</td>
                <td className="px-2 text-right text-ink whitespace-nowrap">{t[1]}</td>
                <td className="px-2 text-right text-muted whitespace-nowrap">{Math.round((Date.parse(t[1]) - Date.parse(t[0])) / 864e5)} 天</td>
                <td className="px-2 text-right text-muted">{mAt(t[0]) ?? '—'}</td>
                <td className="px-2 text-right text-muted whitespace-nowrap">{a != null && b != null ? `${a.toLocaleString('zh-TW')} → ${b.toLocaleString('zh-TW')}` : '—'}</td>
                <td className={`px-2 text-right font-semibold ${sign(t[2])}`}>{t[2] >= 0 ? '+' : ''}{wan(t[2])}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </details>
  );
}
