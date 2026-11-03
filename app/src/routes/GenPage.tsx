/* 策略產生器結果（#/GEN，私人頁，密碼同 v18；2026-11-02 使用者：產生器做 10 支空方策略，看淨利、淨利÷MDD、獲利因子、績效曲線、每年績效）。
 * 2026-11-03 起：多 15＋空 15 支，分「多／空／多+空」三組 Portfolio（資料多了 combos 與每支的 side、sess）。
 * 2026-11-03 站主：點進去看每支的權益曲線、年績效圖、統計；可以單獨開關策略看對整體 Portfolio 的影響
 *   → 每列前面的勾選框（記在這台瀏覽器）、組合在前端重算（lib/genPortfolio.ts）、和「全部開著」比較；詳細區多了年績效長條圖與更多統計。
 *
 * 資料由使用者電腦產生：QuantBrainsAIO\Release\_rebuild\research\gen_ls15_payload.py（或 QT「一鍵組合」的 portfolio.json）算好每支的數字，
 * DashBoard_AI\gen_export.py 用 v18 的 salt 與密碼加密成 data/gen/gen.enc 才推上來。
 * 金額單位萬元；樣本內（用來挑策略）到 isEnd，之後是樣本外。ECharts 只在這一頁才載入。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Vault, type VaultManifest } from '../lib/vault';
import { useVaultExpiry } from '../hooks/useVaultExpiry';
import { Locked } from './QBPage';
import { CATEGORY_COLORS } from '../lib/palette';
import { buildCombo, corr, type Stats, type Year } from '../lib/genPortfolio';

const vault = new Vault(`${import.meta.env.BASE_URL}data/gen/`, 'twetf.v18.unlock');

type Side = 'long' | 'short';
type Group = Side | 'both';
interface Strat {
  id: string; key: string; tf: number; entry: string; filter: string; exit: string;
  /** 舊資料（11-02 空 10 支）只有 dayOnly；11-03 起是 side＋sess（0 留倉、1 日盤當沖、2 夜盤當沖） */
  dayOnly?: boolean; side?: Side; sess?: number;
  stats: Stats; years: Year[]; eq: number[]; robust: { lines: string[]; passed: number; total: number } | null; pl: string;
  sqn?: number | null; rexp?: number | null; ulcer?: number | null;
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
const inGroup = (x: Strat, g: Group) => g === 'both' || sideOf(x) === g;
const wan = (x: number) => x.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const r2 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(2));
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

/** 關掉的策略記在這台瀏覽器（每一批資料各記各的；隱私模式存不了就只在這次有效） */
function useOff(key: string) {
  const k = `twetf.gen.off|${key}`;
  const [off, setOff] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(k) ?? '[]') as string[]); } catch { return new Set(); }
  });
  const save = (s: Set<string>) => {
    setOff(s);
    try { localStorage.setItem(k, JSON.stringify([...s])); } catch { /* 存不了就算了 */ }
  };
  return [off, save] as const;
}

function Board({ d }: { d: GenData }) {
  const orig = useMemo(() => combosOf(d), [d]);
  const groups = (['both', 'long', 'short'] as Group[]).filter(g => orig[g]);
  const [tab, setTab] = useState<Group>(groups[0] ?? 'short');
  const [sel, setSel] = useState<string>(comboId(groups[0] ?? 'short'));
  const [overlay, setOverlay] = useState(false);
  const [off, setOff] = useOff(d.generated);
  const detailRef = useRef<HTMLElement>(null);
  const pickTab = (g: Group) => { setTab(g); setSel(comboId(g)); };
  const pick = (id: string) => {
    setSel(id);
    // 手機：表格很長，點了直接捲到下面的詳細
    if (window.innerWidth < 1024) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const toggle = (ids: string[], on: boolean) => {
    const s = new Set(off);
    for (const id of ids) { if (on) s.delete(id); else s.add(id); }
    setOff(s);
  };
  const list = useMemo(() => d.strategies.filter(x => inGroup(x, tab)), [d, tab]);
  // 組合：全部開著＝原始資料（後端精算）；有關掉的＝前端用開著的重算，並用同一套算法算「全開」當比較基準（四捨五入誤差一致）
  const calc = useMemo(() => {
    const cur: Partial<Record<Group, Combo>> = {};
    const base: Partial<Record<Group, Combo>> = {};
    const hasOff = d.strategies.some(x => off.has(x.id));
    for (const g of (['both', 'long', 'short'] as Group[]).filter(k => orig[k])) {
      if (!hasOff) { cur[g] = orig[g]; continue; }
      const all = d.strategies.filter(x => inGroup(x, g));
      base[g] = buildCombo(all, d.dates, d.isEnd);
      const on = all.filter(x => !off.has(x.id));
      if (on.length) cur[g] = buildCombo(on, d.dates, d.isEnd);
    }
    if (hasOff && cur.long && cur.short) {
      const L = cur.long as ReturnType<typeof buildCombo>, S = cur.short as ReturnType<typeof buildCombo>;
      cur.both = { ...cur.both!, corrLS: Math.round(corr(L.daily, S.daily) * 100) / 100 };
    }
    return { cur, base, hasOff };
  }, [d, off, orig]);
  const combos = calc.cur;
  const comboRows = (tab === 'both' ? groups : [tab]);
  const s = d.strategies.find(x => x.id === sel) ?? null;
  const selCombo = groups.find(g => comboId(g) === sel);
  const cur = s ?? combos[selCombo ?? tab] ?? null;
  const isYear = d.isEnd.slice(0, 4);
  const nOn = (g: Group) => d.strategies.filter(x => inGroup(x, g) && !off.has(x.id)).length;
  const nAll = (g: Group) => d.strategies.filter(x => inGroup(x, g)).length;
  const comboTitle = (g: Group) => `${GROUP_LABEL[g]} ${nOn(g)}${calc.hasOff ? `／${nAll(g)}` : ''} 支合計`;
  const comboSub = (g: Group) => {
    const c = combos[g];
    if (!c) return '全部關掉了';
    return `兩兩相關中位 ${c.corrMedian}、最高 ${c.corrMax}${c.corrLS != null ? `｜多單組合 vs 空單組合 ${c.corrLS}` : ''}`;
  };
  const listOn = list.filter(x => !off.has(x.id)).length;
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
          <li>每列前面的勾選框可以把策略移出組合，上面的合計、曲線、每年績效會用開著的策略重算，並和「全部開著」比較（記在這台瀏覽器）。</li>
        </ul>
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

      {calc.hasOff && <Impact groups={groups} cur={combos} base={calc.base} off={off.size} onReset={() => setOff(new Set())} />}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-muted">
              <th className="w-8 px-2 py-2 text-center font-semibold">
                <input type="checkbox" aria-label="這一組全部開／關" checked={listOn === list.length}
                       ref={el => { if (el) el.indeterminate = listOn > 0 && listOn < list.length; }}
                       onChange={e => toggle(list.map(x => x.id), e.target.checked)} />
              </th>
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
              <Row key={g} id={comboId(g)} sel={sel} onSel={pick} title={comboTitle(g)} sub={comboSub(g)}
                   st={combos[g]?.stats ?? null} robust={null} />
            ))}
            {list.map(x => (
              <Row key={x.id} id={x.id} sel={sel} onSel={pick} title={x.id}
                   sub={`${x.tf >= 1440 ? '日K' : `${x.tf}分`}｜${x.entry}｜${x.filter}｜${x.exit}${sessOf(x) ? `｜${sessOf(x)}` : ''}`}
                   st={x.stats} robust={x.robust} on={!off.has(x.id)} onToggle={v => toggle([x.id], v)} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-faint">點一列看那支策略（或那組合計）的曲線、年績效與統計；勾選框把策略移出／放回組合。樣本內 ≤ {isYear}（挑策略只看這段）、樣本外 {Number(isYear) + 1} 起。</p>

      <section ref={detailRef} className="mt-4 scroll-mt-16 rounded-xl border border-line bg-surface p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-bold text-ink">
            {s ? `${s.id}　${s.tf >= 1440 ? '日K' : `${s.tf}分`}｜${s.entry}${off.has(s.id) ? '（已移出組合）' : ''}` : comboTitle(selCombo ?? tab)}
          </h2>
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            <input type="checkbox" checked={overlay} onChange={e => setOverlay(e.target.checked)} />
            {tab === 'both' ? '疊加多單、空單、多+空三條' : `疊加 ${listOn} 支各自的曲線`}
          </label>
        </div>
        {s && <p className="mt-0.5 text-[12px] text-muted">
          {s.side ? `${GROUP_LABEL[s.side]}｜` : ''}濾網 {s.filter}｜出場 {s.exit}｜
          {s.sess != null ? ({ 0: '留倉（可跨日）', 1: '日盤當沖（13:45 平倉）', 2: '夜盤當沖（05:00 平倉）' } as Record<number, string>)[s.sess]
            : s.dayOnly ? '只做日盤（13:45 平倉）' : '日夜盤都做、可留倉'}
        </p>}
        {cur ? <>
          <StatCards stats={cur.stats} years={cur.years} isYear={Number(isYear)} strat={s} combo={s ? null : (cur as Combo)} />
          <EquityChart d={d} combos={combos} base={calc.base} tab={tab} list={list.filter(x => !off.has(x.id))} sel={sel} overlay={overlay} />
          <YearBars years={cur.years} isYear={Number(isYear)} />
          <YearTable years={cur.years} isYear={isYear} />
        </> : <p className="py-8 text-center text-[13px] text-muted">這一組的策略全部關掉了。</p>}
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

/** 關掉策略後：每組「全開 → 現在」的變化 */
function Impact({ groups, cur, base, off, onReset }: {
  groups: Group[]; cur: Partial<Record<Group, Combo>>; base: Partial<Record<Group, Combo>>; off: number; onReset: () => void;
}) {
  const d = (a: number | null | undefined, b: number | null | undefined) => {
    if (a == null || b == null) return null;
    const x = b - a;
    return <span className={x >= 0 ? 'text-up' : 'text-down'}>（{x >= 0 ? '+' : ''}{x.toFixed(2)}）</span>;
  };
  return (
    <div className="mb-2 rounded-xl border border-accent/40 bg-surface p-2.5 text-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-ink">已移出 {off} 支：組合的變化（全部開著 → 現在）</span>
        <button type="button" onClick={onReset} className="h-7 rounded-lg bg-sunken px-3 text-[12px] text-muted hover:text-ink">全部放回</button>
      </div>
      <div className="mt-1.5 grid gap-1 sm:grid-cols-3">
        {groups.map(g => {
          const b = base[g], c = cur[g];
          if (!b) return null;
          return (
            <div key={g} className="rounded-lg bg-sunken px-2 py-1.5 tabular-nums text-muted">
              <div className="font-semibold text-ink">{GROUP_LABEL[g]}</div>
              {c ? <>
                <div>淨利÷MDD {r2(b.stats.all.nd)} → <b className="text-ink">{r2(c.stats.all.nd)}</b>{d(b.stats.all.nd, c.stats.all.nd)}</div>
                <div>樣本外 {r2(b.stats.os.nd)} → <b className="text-ink">{r2(c.stats.os.nd)}</b>{d(b.stats.os.nd, c.stats.os.nd)}</div>
                <div>淨利 {wan(b.stats.all.net)} → {wan(c.stats.all.net)} 萬；MDD {wan(b.stats.all.mdd)} → {wan(c.stats.all.mdd)} 萬</div>
              </> : <div>全部關掉了</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ id, sel, onSel, title, sub, st, robust, on, onToggle }: {
  id: string; sel: string; onSel: (id: string) => void; title: string; sub: string; st: Stats | null; robust: Strat['robust'];
  on?: boolean; onToggle?: (v: boolean) => void;
}) {
  const active = id === sel;
  return (
    <tr onClick={() => onSel(id)} aria-selected={active}
        className={`cursor-pointer border-t border-line tabular-nums ${active ? 'bg-sunken' : 'hover:bg-hover'} ${on === false ? 'opacity-45' : ''}`}>
      <td className="px-2 text-center" onClick={e => e.stopPropagation()}>
        {onToggle && <input type="checkbox" aria-label={`${title} 放進組合`} checked={on} onChange={e => onToggle(e.target.checked)} />}
      </td>
      <td className="max-w-[260px] px-2 py-1.5">
        <div className="font-semibold text-ink">{title}</div>
        <div className="truncate text-[11px] text-faint" title={sub}>{sub}</div>
      </td>
      {st ? <>
        <td className={`px-2 text-right ${sign(st.all.net)}`}>{wan(st.all.net)}</td>
        <td className="px-2 text-right text-ink">{r2(st.all.nd)}</td>
        <td className="px-2 text-right text-ink">{r2(st.all.pf)}</td>
        <td className="px-2 text-right text-ink">{r2(st.is.nd)}</td>
        <td className={`px-2 text-right ${sign(st.os.nd)}`}>{r2(st.os.nd)}</td>
        <td className="px-2 text-right text-ink">{r2(st.os.pf)}</td>
        <td className="px-2 text-right text-muted whitespace-nowrap">{st.all.trades}／{st.all.win ?? '—'}%</td>
        <td className="px-2 text-right text-muted">{robust ? `${robust.passed}/${robust.total}` : '—'}</td>
      </> : <td colSpan={8} className="px-2 text-center text-muted">—</td>}
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

/** 統計卡：全期、樣本內外、年度分布（賺錢年、最好／最差年）、單支的 SQN 等 */
function StatCards({ stats, years, isYear, strat, combo }: { stats: Stats; years: Year[]; isYear: number; strat: Strat | null; combo: Combo | null }) {
  const nYears = years.length || 1;
  const winY = years.filter(y => y.net > 0).length;
  const best = years.reduce((a, b) => (b.net > a.net ? b : a), years[0] ?? { y: 0, net: 0 } as Year);
  const worst = years.reduce((a, b) => (b.net < a.net ? b : a), years[0] ?? { y: 0, net: 0 } as Year);
  const isYrs = years.filter(y => y.y <= isYear).length || 1, osYrs = years.filter(y => y.y > isYear).length || 1;
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Card label="全期淨利" value={`${wan(stats.all.net)} 萬`} cls={sign(stats.all.net)} sub={`MDD ${wan(stats.all.mdd)} 萬`} />
      <Card label="淨利÷MDD" value={r2(stats.all.nd)} sub={`樣本內 ${r2(stats.is.nd)}／樣本外 ${r2(stats.os.nd)}`} />
      <Card label="獲利因子" value={r2(stats.all.pf)} sub={`樣本內 ${r2(stats.is.pf)}／樣本外 ${r2(stats.os.pf)}`} />
      <Card label="交易次數／勝率" value={stats.all.trades.toLocaleString('zh-TW')} sub={stats.all.win == null ? '' : `勝率 ${stats.all.win}%`} />
      <Card label="樣本內每年淨利" value={`${wan(stats.is.net / isYrs)} 萬`} sub={`MDD ${wan(stats.is.mdd)} 萬`} />
      <Card label="樣本外每年淨利" value={`${wan(stats.os.net / osYrs)} 萬`} cls={sign(stats.os.net)} sub={`MDD ${wan(stats.os.mdd)} 萬`} />
      <Card label="賺錢年份" value={`${winY}／${nYears}`} sub={`最好 ${best.y}（${wan(best.net)}）最差 ${worst.y}（${wan(worst.net)}）`} />
      {strat ? (
        <Card label={strat.sqn != null ? 'SQN／R 期望值' : '防過擬合'} value={strat.sqn != null ? r2(strat.sqn) : strat.robust ? `${strat.robust.passed}/${strat.robust.total}` : '—'}
              sub={strat.sqn != null ? `R 期望值 ${r2(strat.rexp)}、Ulcer ${r2(strat.ulcer)}` : '六項通過數'} />
      ) : (
        <Card label="兩兩相關" value={combo ? `中位 ${combo.corrMedian}` : '—'} sub={combo ? `最高 ${combo.corrMax}${combo.corrLS != null ? `｜多 vs 空 ${combo.corrLS}` : ''}` : ''} />
      )}
    </div>
  );
}

function YearTable({ years, isYear }: { years: Year[]; isYear: string }) {
  return (
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

/** ECharts 共用：只建立一次，選項變了就 setOption */
function useEChart(opt: unknown) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<Chart | null>(null);
  const last = useRef(opt);
  useEffect(() => {
    let disposed = false;
    import('echarts').then(ec => {
      if (disposed || !el.current) return;
      chart.current = ec.init(el.current) as unknown as Chart;
      chart.current.setOption(last.current, true);
    });
    const onResize = () => chart.current?.resize();
    window.addEventListener('resize', onResize);
    return () => { disposed = true; window.removeEventListener('resize', onResize); chart.current?.dispose(); chart.current = null; };
  }, []);
  // 圖表是非同步載入的：最新選項先記著，載入完成時用它畫
  useEffect(() => { last.current = opt; chart.current?.setOption(opt, true); }, [opt]);
  return el;
}

/** 每年淨利長條圖：樣本內實心、樣本外淡色；虧損年用跌色 */
function YearBars({ years, isYear }: { years: Year[]; isYear: number }) {
  const opt = useMemo(() => {
    const ink = cssVar('--c-muted'), grid = cssVar('--c-border'), up = cssVar('--c-up'), down = cssVar('--c-down');
    return {
      animation: false, grid: { left: 52, right: 12, top: 24, bottom: 28 },
      title: { text: '每年淨利（萬；淡色＝樣本外）', left: 0, top: 0, textStyle: { fontSize: 12, color: ink, fontWeight: 'normal' } },
      tooltip: { trigger: 'axis', confine: true, valueFormatter: (v: number) => `${wan(v)} 萬` },
      xAxis: { type: 'category', data: years.map(y => String(y.y)), axisLabel: { fontSize: 10, color: ink }, axisLine: { lineStyle: { color: grid } } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10, color: ink, formatter: (v: number) => wan(v) }, splitLine: { lineStyle: { color: grid, opacity: 0.6 } } },
      series: [{
        type: 'bar', name: '淨利', barMaxWidth: 28,
        data: years.map(y => ({ value: y.net, itemStyle: { color: y.net >= 0 ? up : down, opacity: y.y > isYear ? 0.45 : 0.9 } })),
      }],
    };
  }, [years, isYear]);
  const el = useEChart(opt);
  return <div ref={el} className="mt-3 h-[200px] w-full overflow-hidden" />;
}

function EquityChart({ d, combos, base, tab, list, sel, overlay }: {
  d: GenData; combos: Partial<Record<Group, Combo>>; base: Partial<Record<Group, Combo>>; tab: Group; list: Strat[]; sel: string; overlay: boolean;
}) {
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
    let legend = overlay;
    if (overlay && tab === 'both') {
      // 多+空：三組 Portfolio 疊在一起看互補
      (['both', 'long', 'short'] as Group[]).filter(g => combos[g]).forEach((g, i) => series.push({
        name: GROUP_LABEL[g], type: 'line', showSymbol: false, data: combos[g]!.eq,
        lineStyle: { width: sel === comboId(g) ? 2.5 : 1.6 },
        color: cssVar(CATEGORY_COLORS[i % CATEGORY_COLORS.length]), emphasis: { focus: 'series' },
      }));
      if (shade && series.length) (series[0] as Record<string, unknown>).markArea = shade;
    } else if (overlay) {
      list.forEach((x, i) => series.push({
        name: x.id, type: 'line', showSymbol: false, data: x.eq,
        lineStyle: { width: x.id === sel ? 2.5 : 1.2, opacity: isCombo || x.id === sel ? 1 : 0.35 },
        color: cssVar(CATEGORY_COLORS[i % CATEGORY_COLORS.length]), emphasis: { focus: 'series' },
      }));
      if (shade && series.length) (series[0] as Record<string, unknown>).markArea = shade;
    } else {
      const x = d.strategies.find(v => v.id === sel);
      const g = (Object.keys(combos) as Group[]).find(k => comboId(k) === sel) ?? tab;
      const c = x ? null : combos[g];
      series.push({
        name: x ? x.id : `${GROUP_LABEL[g]}合計${base[g] ? '（現在）' : ''}`, type: 'line', showSymbol: false, data: x ? x.eq : c?.eq ?? [],
        lineStyle: { width: 2 }, color: cssVar('--cat-1'), areaStyle: { opacity: 0.08 }, markArea: shade,
      });
      // 有關掉策略時，合計曲線旁邊畫「全部開著」的虛線對照
      if (!x && base[g]) {
        series.push({ name: '全部開著', type: 'line', showSymbol: false, data: base[g]!.eq, lineStyle: { width: 1.2, type: 'dashed' }, color: cssVar('--c-muted') });
        legend = true;
      }
    }
    return {
      animation: false, grid: { left: 52, right: 12, top: legend ? 46 : 16, bottom: 44 },
      legend: legend ? { top: 0, textStyle: { fontSize: 11, color: ink }, itemWidth: 14 } : undefined,
      tooltip: { trigger: 'axis', confine: true, valueFormatter: (v: number) => `${wan(v)} 萬` },
      xAxis: { type: 'category', data: d.dates, axisLabel: { fontSize: 10, color: ink }, axisLine: { lineStyle: { color: grid } } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10, color: ink, formatter: (v: number) => wan(v) }, splitLine: { lineStyle: { color: grid, opacity: 0.6 } } },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 6 }],
      series,
    };
  }, [d, combos, base, tab, list, sel, overlay]);
  const el = useEChart(opt);
  return <div ref={el} className="mt-3 h-[300px] w-full overflow-hidden sm:h-[360px]" />;
}
