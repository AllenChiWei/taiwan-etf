/* 策略產生器結果（#/GEN，私人頁，密碼同 v18；2026-11-02 使用者：產生器做 10 支空方策略，看淨利、淨利÷MDD、獲利因子、績效曲線、每年績效）。
 * 2026-11-03 起：多 15＋空 15 支，分「多／空／多+空」三組 Portfolio（資料多了 combos 與每支的 side、sess）。
 *
 * 資料由使用者電腦產生：QuantBrainsAIO\Release\_rebuild\research\gen_ls15_payload.py（舊版 gen_short10_payload.py）算好所有數字，
 * DashBoard_AI\gen_export.py 用 v18 的 salt 與密碼加密成 data/gen/gen.enc 才推上來；網頁只負責排版與畫圖。
 * 金額單位萬元；樣本內（用來挑策略）到 isEnd，之後是樣本外。ECharts 只在這一頁才載入。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Vault, type VaultManifest } from '../lib/vault';
import { useVaultExpiry } from '../hooks/useVaultExpiry';
import { Locked } from './QBPage';
import { CATEGORY_COLORS } from '../lib/palette';

const vault = new Vault(`${import.meta.env.BASE_URL}data/gen/`, 'twetf.v18.unlock');

interface Seg { net: number; mdd: number; nd: number | null; pf: number | null; trades: number; win: number | null }
interface Year extends Seg { y: number }
interface Stats { all: Seg; is: Seg; os: Seg }
type Side = 'long' | 'short';
type Group = Side | 'both';
interface Strat {
  id: string; key: string; tf: number; entry: string; filter: string; exit: string;
  /** 舊資料（11-02 空 10 支）只有 dayOnly；11-03 起是 side＋sess（0 留倉、1 日盤當沖、2 夜盤當沖） */
  dayOnly?: boolean; side?: Side; sess?: number;
  stats: Stats; years: Year[]; eq: number[]; robust: { lines: string[]; passed: number; total: number } | null; pl: string;
}
interface Combo { stats: Stats; years: Year[]; eq: number[]; corrMedian: number; corrMax: number; n?: number; corrLS?: number }
interface GenData {
  generated: string; title: string; isEnd: string; notes: string[]; dates: string[]; strategies: Strat[];
  combo?: Combo;
  combos?: Partial<Record<Group, Combo>>;
}

const GROUP_LABEL: Record<Group, string> = { long: '多單', short: '空單', both: '多+空' };
/** 合計列的 id（和策略 id 不會撞名） */
const comboId = (g: Group) => `__${g}`;
const SESS = ['留倉', '日盤當沖', '夜盤當沖'];
const sessOf = (x: Strat) => (x.sess != null ? SESS[x.sess] ?? '' : x.dayOnly ? '只做日盤' : '');
const sideOf = (x: Strat): Side => x.side ?? 'short';
/** 舊資料只有一組 combo（空 10 支），當成「空單」那組 */
const combosOf = (d: GenData): Partial<Record<Group, Combo>> => d.combos ?? (d.combo ? { short: d.combo } : {});
const wan = (x: number) => x.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const r2 = (x: number | null) => (x == null ? '—' : x.toFixed(2));
const sign = (x: number | null) => (x == null ? 'text-muted' : x >= 0 ? 'text-up' : 'text-down');
/** ECharts 畫在 canvas 上，不認得 var(--x)：從目前主題取實際色值 */
const cssVar = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v.replace(/^var\((.*)\)$/, '$1')).trim() || '#888';

export function GenPage() {
  const [manifest, setManifest] = useState<VaultManifest | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'locked' | 'ready' | 'error'>('loading');
  const [d, setD] = useState<GenData | null>(null);
  const [msg, setMsg] = useState('');

  const load = async () => {
    try { setState('loading'); setD(await vault.fetchJson<GenData>('gen.enc')); setState('ready'); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setState('error'); }
  };
  useEffect(() => {
    vault.loadManifest().then(async m => {
      if (!m) { setState('missing'); return; }
      setManifest(m);
      if (await vault.restore(m)) await load(); else setState('locked');
    }).catch(e => { setMsg(String(e)); setState('error'); });
  }, []);
  useVaultExpiry(vault, state === 'ready', () => { setD(null); setState('locked'); });

  if (state === 'loading') return <p className="py-16 text-center text-[13px] text-muted">載入中…</p>;
  if (state === 'missing') return <p className="py-16 text-center text-[13px] text-muted">還沒有策略產生器的資料。</p>;
  if (state === 'locked' && manifest) return <Locked vault={vault} title="策略產生器" manifest={manifest} onUnlock={load} />;
  if (state === 'error' || !d) return <p className="py-16 text-center text-[13px] text-down">載入失敗：{msg}</p>;
  return <Board d={d} />;
}

function Board({ d }: { d: GenData }) {
  const combos = useMemo(() => combosOf(d), [d]);
  const groups = (['both', 'long', 'short'] as Group[]).filter(g => combos[g]);
  const [tab, setTab] = useState<Group>(groups[0] ?? 'short');
  const [sel, setSel] = useState<string>(comboId(groups[0] ?? 'short'));
  const [overlay, setOverlay] = useState(false);
  const pickTab = (g: Group) => { setTab(g); setSel(comboId(g)); };
  const list = useMemo(() => (tab === 'both' ? d.strategies : d.strategies.filter(x => sideOf(x) === tab)), [d, tab]);
  // 「多+空」分頁的合計列：多+空、多單、空單三組都列，方便對照
  const comboRows = (tab === 'both' ? groups : [tab]).filter(g => combos[g]);
  const s = d.strategies.find(x => x.id === sel) ?? null;
  const selCombo = (Object.keys(combos) as Group[]).find(g => comboId(g) === sel);
  const cur = s ?? combos[selCombo ?? tab]!;
  const stats = cur.stats;
  const years = cur.years;
  const isYear = d.isEnd.slice(0, 4);
  const comboTitle = (g: Group) => `${GROUP_LABEL[g]} ${combos[g]?.n ?? list.length} 支合計`;
  const comboSub = (g: Group) => {
    const c = combos[g]!;
    return `兩兩相關中位 ${c.corrMedian}、最高 ${c.corrMax}${c.corrLS != null ? `｜多單組合 vs 空單組合 ${c.corrLS}` : ''}`;
  };
  return (
    <div className="mt-3 min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h1 className="text-base font-bold text-ink">{d.title}</h1>
        <span className="text-[11.5px] text-faint">更新於 {d.generated}　·　<Link to="/me" className="hover:text-ink">← 我的工具</Link></span>
      </div>
      <details className="mb-3 rounded-xl border border-line bg-surface p-3 text-[12.5px] text-muted">
        <summary className="cursor-pointer font-semibold text-ink">怎麼做出來的、數字怎麼看</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 leading-relaxed">{d.notes.map((t, i) => <li key={i}>{t}</li>)}</ul>
      </details>

      {groups.length > 1 && (
        <div role="tablist" aria-label="策略組" className="mb-2 flex gap-1 border-b border-line">
          {groups.map(g => (
            <button key={g} type="button" role="tab" aria-selected={tab === g} onClick={() => pickTab(g)}
                    className={`-mb-px border-b-2 px-3 pb-2 text-[13.5px] font-semibold transition-colors ${
                      tab === g ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
              {GROUP_LABEL[g]}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-muted">
              <th className="px-2 py-2 text-left font-semibold">策略</th>
              <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">淨利（萬）</th>
              <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">淨利÷MDD</th>
              <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">獲利因子</th>
              <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">樣本內 ÷MDD</th>
              <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">樣本外 ÷MDD</th>
              <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">樣本外 PF</th>
              <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">交易／勝率</th>
              <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">防過擬合</th>
            </tr>
          </thead>
          <tbody>
            {comboRows.map(g => (
              <Row key={g} id={comboId(g)} sel={sel} onSel={setSel} title={comboTitle(g)} sub={comboSub(g)}
                   st={combos[g]!.stats} robust={null} />
            ))}
            {list.map(x => (
              <Row key={x.id} id={x.id} sel={sel} onSel={setSel} title={x.id}
                   sub={`${x.tf >= 1440 ? '日K' : `${x.tf}分`}｜${x.entry}｜${x.filter}｜${x.exit}${sessOf(x) ? `｜${sessOf(x)}` : ''}`}
                   st={x.stats} robust={x.robust} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-faint">點一列看那支策略（或那組合計）的績效曲線與每年績效。樣本內 ≤ {isYear}（挑策略只看這段）、樣本外 {Number(isYear) + 1} 起。</p>

      <section className="mt-4 rounded-xl border border-line bg-surface p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-bold text-ink">
            {s ? `${s.id}　${s.tf >= 1440 ? '日K' : `${s.tf}分`}｜${s.entry}` : comboTitle(selCombo ?? tab)}
          </h2>
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            <input type="checkbox" checked={overlay} onChange={e => setOverlay(e.target.checked)} />
            {tab === 'both' ? '疊加多單、空單、多+空三條' : `疊加 ${list.length} 支各自的曲線`}
          </label>
        </div>
        {s && <p className="mt-0.5 text-[12px] text-muted">
          {s.side ? `${GROUP_LABEL[s.side]}｜` : ''}濾網 {s.filter}｜出場 {s.exit}｜
          {s.sess != null ? ({ 0: '留倉（可跨日）', 1: '日盤當沖（13:45 平倉）', 2: '夜盤當沖（05:00 平倉）' } as Record<number, string>)[s.sess]
            : s.dayOnly ? '只做日盤（13:45 平倉）' : '日夜盤都做、可留倉'}
        </p>}
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Card label="全期淨利" value={`${wan(stats.all.net)} 萬`} cls={sign(stats.all.net)} sub={`MDD ${wan(stats.all.mdd)} 萬`} />
          <Card label="淨利÷MDD" value={r2(stats.all.nd)} sub={`樣本內 ${r2(stats.is.nd)}／樣本外 ${r2(stats.os.nd)}`} />
          <Card label="獲利因子" value={r2(stats.all.pf)} sub={`樣本內 ${r2(stats.is.pf)}／樣本外 ${r2(stats.os.pf)}`} />
          <Card label="交易次數／勝率" value={`${stats.all.trades.toLocaleString('zh-TW')}`} sub={stats.all.win == null ? '' : `勝率 ${stats.all.win}%`} />
        </div>
        <EquityChart d={d} combos={combos} tab={tab} list={list} sel={sel} overlay={overlay} />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-muted">
              {['年', '淨利（萬）', 'MDD（萬）', '淨利÷MDD', '獲利因子', '交易', '勝率'].map((h, i) => (
                <th key={h} className={`py-1 font-semibold whitespace-nowrap ${i ? 'pl-2 text-right' : 'pr-2 text-left'}`}>{h}</th>
              ))}
            </tr></thead>
            <tbody>{years.map(y => (
              <tr key={y.y} className="border-t border-line tabular-nums">
                <td className="py-1.5 pr-2 text-muted whitespace-nowrap">{y.y}{y.y > Number(isYear) && <span className="ml-1 text-[10.5px] text-faint">樣本外</span>}</td>
                <td className={`pl-2 text-right ${sign(y.net)}`}>{wan(y.net)}</td>
                <td className="pl-2 text-right text-ink">{wan(y.mdd)}</td>
                <td className="pl-2 text-right text-ink">{r2(y.nd)}</td>
                <td className="pl-2 text-right text-ink">{r2(y.pf)}</td>
                <td className="pl-2 text-right text-ink">{y.trades}</td>
                <td className="pl-2 text-right text-ink">{y.win == null ? '—' : `${y.win}%`}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {s?.robust && (
          <div className="mt-3 rounded-lg bg-sunken p-2.5 text-[12px] leading-relaxed text-muted">
            <div className="font-semibold text-ink">防過擬合檢查（全期，通過 {s.robust.passed}/{s.robust.total}）</div>
            {s.robust.lines.map((t, i) => <p key={i} className="mt-0.5">{t}</p>)}
          </div>
        )}
        {s?.pl && <PlCode id={s.id} code={s.pl} />}
      </section>
    </div>
  );
}

function Row({ id, sel, onSel, title, sub, st, robust }: {
  id: string; sel: string; onSel: (id: string) => void; title: string; sub: string; st: Stats; robust: Strat['robust'];
}) {
  const on = id === sel;
  return (
    <tr onClick={() => onSel(id)} aria-selected={on}
        className={`cursor-pointer border-t border-line tabular-nums ${on ? 'bg-sunken' : 'hover:bg-hover'}`}>
      <td className="max-w-[260px] px-2 py-1.5">
        <div className="font-semibold text-ink">{title}</div>
        <div className="truncate text-[11px] text-faint" title={sub}>{sub}</div>
      </td>
      <td className={`px-2 text-right ${sign(st.all.net)}`}>{wan(st.all.net)}</td>
      <td className="px-2 text-right text-ink">{r2(st.all.nd)}</td>
      <td className="px-2 text-right text-ink">{r2(st.all.pf)}</td>
      <td className="px-2 text-right text-ink">{r2(st.is.nd)}</td>
      <td className={`px-2 text-right ${sign(st.os.nd)}`}>{r2(st.os.nd)}</td>
      <td className="px-2 text-right text-ink">{r2(st.os.pf)}</td>
      <td className="px-2 text-right text-muted whitespace-nowrap">{st.all.trades}／{st.all.win ?? '—'}%</td>
      <td className="px-2 text-right text-muted">{robust ? `${robust.passed}/${robust.total}` : '—'}</td>
    </tr>
  );
}

function Card({ label, value, sub, cls = 'text-ink' }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-lg bg-sunken px-2.5 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`text-[16px] font-bold tabular-nums ${cls}`}>{value}</div>
      {sub && <div className="text-[11px] text-faint tabular-nums">{sub}</div>}
    </div>
  );
}

function PlCode({ id, code }: { id: string; code: string }) {
  const [done, setDone] = useState(false);
  return (
    <details className="mt-3 rounded-lg border border-line">
      <summary className="cursor-pointer px-2.5 py-2 text-[12.5px] font-semibold text-ink">PowerLanguage（{id}，在 MC 編譯回測比對後再上線）</summary>
      <div className="border-t border-line p-2">
        <button type="button" className="mb-2 h-7 rounded-lg bg-sunken px-3 text-[12px] text-muted hover:text-ink"
                onClick={() => navigator.clipboard?.writeText(code).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
          {done ? '已複製' : '複製程式碼'}
        </button>
        <pre className="max-h-[420px] overflow-auto whitespace-pre text-[11px] leading-snug text-ink">{code}</pre>
      </div>
    </details>
  );
}

type Chart = { setOption: (o: unknown, notMerge?: boolean) => void; resize: () => void; dispose: () => void };

function EquityChart({ d, combos, tab, list, sel, overlay }: {
  d: GenData; combos: Partial<Record<Group, Combo>>; tab: Group; list: Strat[]; sel: string; overlay: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<Chart | null>(null);
  const opt = useMemo(() => {
    const ink = cssVar('--c-muted'), grid = cssVar('--c-border');
    const cut = d.dates.findIndex(x => x > d.isEnd);
    const shade = cut > 0 ? {
      silent: true, itemStyle: { color: 'rgba(128,128,128,0.08)' },
      data: [[{ xAxis: d.dates[cut], name: '樣本外' }, { xAxis: d.dates[d.dates.length - 1] }]],
      label: { color: ink, fontSize: 10, position: 'insideTopLeft' },
    } : undefined;
    const series: unknown[] = [];
    const isCombo = sel.startsWith('__');
    if (overlay && tab === 'both') {
      // 多+空：三組 Portfolio 疊在一起看互補
      (['both', 'long', 'short'] as Group[]).filter(g => combos[g]).forEach((g, i) => series.push({
        name: GROUP_LABEL[g], type: 'line', showSymbol: false, data: combos[g]!.eq,
        lineStyle: { width: sel === comboId(g) ? 2.5 : 1.6 },
        color: cssVar(CATEGORY_COLORS[i % CATEGORY_COLORS.length]), emphasis: { focus: 'series' },
      }));
      if (shade) (series[0] as Record<string, unknown>).markArea = shade;
    } else if (overlay) {
      list.forEach((x, i) => series.push({
        name: x.id, type: 'line', showSymbol: false, data: x.eq,
        lineStyle: { width: x.id === sel ? 2.5 : 1.2, opacity: isCombo || x.id === sel ? 1 : 0.35 },
        color: cssVar(CATEGORY_COLORS[i % CATEGORY_COLORS.length]), emphasis: { focus: 'series' },
      }));
      if (shade) (series[0] as Record<string, unknown>).markArea = shade;
    } else {
      const x = d.strategies.find(v => v.id === sel);
      const g = (Object.keys(combos) as Group[]).find(k => comboId(k) === sel) ?? tab;
      series.push({
        name: x ? x.id : `${GROUP_LABEL[g]}合計`, type: 'line', showSymbol: false, data: x ? x.eq : combos[g]!.eq,
        lineStyle: { width: 2 }, color: cssVar('--cat-1'), areaStyle: { opacity: 0.08 }, markArea: shade,
      });
    }
    return {
      animation: false, grid: { left: 52, right: 12, top: overlay ? 46 : 16, bottom: 44 },
      legend: overlay ? { top: 0, textStyle: { fontSize: 11, color: ink }, itemWidth: 14 } : undefined,
      tooltip: { trigger: 'axis', confine: true, valueFormatter: (v: number) => `${wan(v)} 萬` },
      xAxis: { type: 'category', data: d.dates, axisLabel: { fontSize: 10, color: ink }, axisLine: { lineStyle: { color: grid } } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10, color: ink, formatter: (v: number) => wan(v) }, splitLine: { lineStyle: { color: grid, opacity: 0.6 } } },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 6 }],
      series,
    };
  }, [d, combos, tab, list, sel, overlay]);
  useEffect(() => {
    let disposed = false;
    import('echarts').then(ec => {
      if (disposed || !el.current) return;
      chart.current = ec.init(el.current) as unknown as Chart;
      chart.current.setOption(opt, true);
    });
    const onResize = () => chart.current?.resize();
    window.addEventListener('resize', onResize);
    return () => { disposed = true; window.removeEventListener('resize', onResize); chart.current?.dispose(); chart.current = null; };
    // 只建立一次；選項變動由下一個 effect 更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { chart.current?.setOption(opt, true); }, [opt]);
  return <div ref={el} className="mt-3 h-[300px] w-full overflow-hidden sm:h-[360px]" />;
}
