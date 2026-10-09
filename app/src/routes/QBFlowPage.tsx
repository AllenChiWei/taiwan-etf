/* QT 流程比較（#/QTF，私人頁，密碼同 v18）：三個策略池 × A → B → C → 複利（2026-10-06 使用者要求）。
 *
 * 資料：research/flow_export.py → data/qbflow/flow.enc（v18 同密碼加密）。
 *   A 評價前（等權）、B 分多空序位 15＋Sortino 250、C 自動槓桿（集成／慢速恢復海龜可切換）、複利（C＋QT 步進 10%）。
 *   同風險：本金 2,800 萬，各自縮放到全期最大回撤＝本金 20%；原始規模：回測口數（K＝1）的累積損益（複利不適用）。
 * 版面（手機）：圖表 tooltip confine、容器 overflow 隱藏；表格放在 overflow-x-auto 的框裡（見記憶 taiwanetf-mobile-layout）。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Vault, type VaultManifest } from '../lib/vault';
import { useVaultExpiry } from '../hooks/useVaultExpiry';
import { Locked } from './QBPage';

type StageKey = 'A' | 'B' | 'C' | 'K' | 'M';
type Mode = 'same' | 'raw' | 'real';
interface Money { net: number; mdd: number; nd: number | null; cagr: number; mdd_pct: number; sharpe: number | null; worst_y: number; years: Record<string, number> }
interface Raw { net: number; mdd: number; nd: number | null; sharpe: number | null; years: Record<string, number> }
interface Pool {
  key: string; name: string; n: number; start: string; end: string; weeks: string[];
  same: Record<string, Money>; raw: Record<string, Raw>;
  series_same: Record<string, number[]>; series_raw: Record<string, number[]>;
  wins: Record<string, number | null>; avg_lev: Record<string, number>;
  /** 實際規模（本金 2,800 萬、約 30 口小台、照 QT 取整）：B、C_*、K_*（真正複利）、M（大盤含息）；lots＝期末口數倍數 */
  real?: { stats: Record<string, Money>; series: Record<string, number[]>; lots: Record<string, number> };
}
interface PropSection { h: string; paras?: string[]; table?: { head: string[]; rows: string[][] }; note?: string }
interface Proposal { title: string; generated: string; summary: string; sections: PropSection[] }
interface Flow { generated: string; capital: number; target_mdd: number; c_variants: Record<string, string>; pools: Pool[]; proposal?: Proposal }

const vault = new Vault(`${import.meta.env.BASE_URL}data/qbflow/`, 'twetf.v18.unlock');
const COLORS: Record<StageKey, string> = { A: '#85847e', B: '#2a78d6', C: '#eb6834', K: '#4a3aa7', M: '#9a9a94' };
const LABEL: Record<StageKey, string> = { A: 'A 評價前', B: 'B 評價後', C: 'C 自動槓桿', K: '複利', M: '大盤（含息）' };
const SHORT: Record<string, string> = { qb: '原本', qba: '合併', qbw: '盲測', qbv: 'Activate' };
const POOL_HINT: Record<string, string> = { qb: 'Export', qba: '＋Activate', qbw: '網路 50 個', qbv: '只有 Activate' };

const w = (v: number) => Math.round(v / 1e4).toLocaleString('zh-TW');
const p1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const f2 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));

export function QBFlowPage() {
  const [manifest, setManifest] = useState<VaultManifest | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'locked' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<Flow | null>(null);
  const [msg, setMsg] = useState('');
  const [pool, setPool] = useState('qb');
  const [mode, setMode] = useState<Mode>('real');
  const [cv, setCv] = useState('ens');
  const [on, setOn] = useState<Record<StageKey, boolean>>({ A: true, B: true, C: true, K: true, M: true });

  const load = async () => {
    try { setState('loading'); setData(await vault.fetchJson<Flow>('flow.enc')); setState('ready'); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setState('error'); }
  };
  useEffect(() => {
    vault.loadManifest().then(async m => {
      if (!m) { setState('missing'); return; }
      setManifest(m);
      if (await vault.restore(m)) await load(); else setState('locked');
    }).catch(e => { setMsg(String(e)); setState('error'); });
  }, []);
  useVaultExpiry(vault, state === 'ready', () => { setData(null); setState('locked'); });

  if (state === 'loading') return <p className="py-16 text-center text-[13px] text-muted">載入中…</p>;
  if (state === 'missing') return <p className="py-16 text-center text-[13px] text-muted">還沒有資料。</p>;
  if (state === 'locked' && manifest) return <Locked vault={vault} title="QT 流程比較" manifest={manifest} onUnlock={load} />;
  if (state === 'error' || !data) return <p className="py-16 text-center text-[13px] text-down">載入失敗：{msg}</p>;
  const P = data.pools.find(p => p.key === pool) ?? data.pools[0];
  return <Board data={data} P={P} pool={pool} setPool={setPool} mode={mode} setMode={setMode} cv={cv} setCv={setCv} on={on} setOn={setOn} />;
}

function seg(active: boolean) {
  return `h-9 rounded-lg px-3 text-[13px] font-semibold ${active ? 'bg-surface text-ink shadow-sm ring-1 ring-line-strong' : 'text-muted hover:text-ink'}`;
}

function Board({ data, P, pool, setPool, mode: mode0, setMode, cv, setCv, on, setOn }: {
  data: Flow; P: Pool; pool: string; setPool: (v: string) => void; mode: Mode; setMode: (v: Mode) => void;
  cv: string; setCv: (v: string) => void; on: Record<StageKey, boolean>; setOn: (v: Record<StageKey, boolean>) => void;
}) {
  const mode: Mode = mode0 === 'real' && !P.real ? 'same' : mode0;
  const keyOf = (s: StageKey) => (s === 'C' ? `C_${cv}` : s === 'K' ? `K_${cv}` : s);
  const stages: StageKey[] = mode === 'raw' ? ['A', 'B', 'C'] : mode === 'real' ? ['B', 'C', 'K', 'M'] : ['A', 'B', 'C', 'K'];
  const shown = stages.filter(s => on[s]);
  const prevOf: Record<StageKey, StageKey | null> = { A: null, B: 'A', C: 'B', K: 'C', M: null };
  const winOf = (s: StageKey) => (s === 'B' ? P.wins.B : s === 'C' ? P.wins[`C_${cv}`] : null);

  return (
    <div className="mt-4 overflow-x-clip">
      <h1 className="text-base font-bold text-ink">QT 流程比較：A → B → C → 複利</h1>
      <p className="mt-1 text-[12px] text-muted">
        四個策略池各用目前測試出來最好的設定；可切換策略池、C 的做法、實際規模／同風險／原始規模，並勾選要看的步驟。資料 {data.generated}。
      </p>

      {data.proposal && <ProposalCard p={data.proposal} />}

      <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-line bg-sunken p-1 sm:grid-cols-4" role="tablist" aria-label="策略池">
        {data.pools.map(p => (
          <button key={p.key} type="button" role="tab" aria-selected={p.key === pool} onClick={() => setPool(p.key)}
                  className={`flex min-h-[48px] flex-col items-center justify-center rounded-lg px-1 text-center ${p.key === pool ? 'bg-surface text-ink shadow-sm ring-1 ring-line-strong' : 'text-muted hover:text-ink'}`}>
            <span className="text-[13.5px] font-semibold"><span className="sm:hidden">{SHORT[p.key]}</span><span className="hidden sm:inline">{p.name}</span></span>
            <span className="text-[10.5px] text-faint">{POOL_HINT[p.key]}・{p.n} 條</span>
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px]">
        <span className="inline-flex rounded-lg bg-sunken p-0.5">
          <button type="button" className={seg(mode === 'real')} onClick={() => setMode('real')}>實際規模</button>
          <button type="button" className={seg(mode === 'same')} onClick={() => setMode('same')}>同風險</button>
          <button type="button" className={seg(mode === 'raw')} onClick={() => setMode('raw')}>原始規模</button>
        </span>
        <label className="flex items-center gap-1 text-muted">C 用
          <select value={cv} onChange={e => setCv(e.target.value)} className="h-9 max-w-[13rem] rounded-lg border border-line bg-bg px-2 text-[12.5px] text-ink">
            {Object.entries(data.c_variants).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" aria-label="要顯示的步驟">
        {stages.map(s => (
          <button key={s} type="button" aria-pressed={on[s]} onClick={() => setOn({ ...on, [s]: !on[s] })}
                  className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold ${on[s] ? 'border-line-strong bg-surface text-ink' : 'border-line text-faint'}`}>
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: on[s] ? COLORS[s] : 'transparent', border: `2px solid ${COLORS[s]}` }} />
            {LABEL[s]}
          </button>
        ))}
      </div>

      <Steps P={P} mode={mode} stages={stages} keyOf={keyOf} prevOf={prevOf} />

      <div className="mt-3 rounded-xl border border-line bg-surface p-3">
        <div className="text-[13px] font-bold text-ink">權益曲線{mode === 'real' ? '（萬元，本金 2,800 萬、約 30 口小台起，對數刻度）' : mode === 'same' ? '（萬元，本金 2,800 萬，對數刻度）' : '（累積損益，萬元，回測口數）'}</div>
        <Chart P={P} mode={mode} shown={shown} keyOf={keyOf} />
      </div>

      <div className="mt-3 rounded-xl border border-line bg-surface p-3">
        <div className="text-[13px] font-bold text-ink">重點指標</div>
        <div className="mt-2 overflow-x-auto">
          <MetricsTable P={P} mode={mode} stages={stages} keyOf={keyOf} winOf={winOf} />
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-line bg-surface p-3">
        <div className="text-[13px] font-bold text-ink">每年{mode === 'raw' ? '損益（萬）' : '報酬率'}{mode !== 'raw' && <span className="ml-1 text-[11px] font-normal text-faint">（不複利＝當年損益÷本金；複利＝以年初權益為分母）</span>}</div>
        <div className="mt-2 overflow-x-auto">
          <YearTable P={P} mode={mode} stages={stages} keyOf={keyOf} />
        </div>
      </div>

      <ul className="mt-3 list-disc space-y-1 pl-5 text-[11.5px] leading-relaxed text-muted">
        <li><b>A</b> 評價前：所有策略（多空分拆）等權。<b>B</b> 評價後：QT 分多空各序位 15、X1_v3 Sortino 250（目前 QT 設定，照 QT 規則逐日模擬）。</li>
        <li><b>C</b> 自動槓桿（總帳戶動能轉換率每天調整，只用前一天收盤以前的 B 權益，已扣調整成本）：
          集成＝慢速恢復海龜＋20 日波動目標＋3 日急跌煞車三者平均，三個策略池都穩健（建議）；慢速恢復海龜＝目前的 MC 指標。
          平均槓桿：{Object.entries(P.avg_lev).map(([k, v]) => `${k === 'ens' ? '集成' : '海龜'} ${v.toFixed(2)}`).join('、')}。</li>
        <li><b>複利</b>（2026-10-07 改）：口數跟著權益等比例放大、當天生效＝集成指標把動能轉換率乘上（目前權益÷起始本金），不設上限。
          獲利越多打越多口，淨利會衝高，報酬率也不會被稀釋。不用 QT 內建的「實際操作資金步進調整」：它要等訊號列表清空才加碼，很少生效，而且回撤反而較大。
          {P.real && <>期末口數約為起始的 {P.real.lots[`K_${cv}`]} 倍，實際會受流動性、滑價與保證金限制。</>}</li>
        <li><b>實際規模</b>：本金 2,800 萬、約 30 口小台（K＝0.05），照 QT 規則無條件捨去取整；B、C 口數固定，年報酬＝當年損益÷本金（不被累積的權益稀釋）；
          <b>大盤（含息）</b>＝同一筆本金買進加權報酬指數持有。</li>
        <li><b>同風險</b>：本金 {(data.capital / 1e4).toLocaleString('zh-TW')} 萬，A／B／C 各自縮放到全期最大回撤＝本金 {(data.target_mdd * 100).toFixed(0)}%，所以淨利、年化（單利）可以直接比；
          複利從 C 的規模起算。<b>原始規模</b>：回測口數（K＝1）的累積損益，看的是實際曲線形狀與淨利／回撤比。</li>
        <li>3 年勝率：每季起算一個 3 年視窗，這一步的淨利／回撤勝過上一步的比例。回測滑價 0；實盤另有滑價與 QT 調整口數的手續費。</li>
      </ul>
    </div>
  );
}

function Steps({ P, mode, stages, keyOf, prevOf }: {
  P: Pool; mode: Mode; stages: StageKey[]; keyOf: (s: StageKey) => string; prevOf: Record<StageKey, StageKey | null>;
}) {
  if (mode === 'real' && P.real) {
    const R = P.real;
    return (
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stages.map(s => {
          const m = R.stats[keyOf(s)];
          if (!m) return null;
          return (
            <div key={s} className="rounded-xl border border-line bg-surface p-2.5" style={{ borderTop: `3px solid ${COLORS[s]}` }}>
              <div className="text-[11.5px] font-semibold text-muted">{LABEL[s]}</div>
              <div className="mt-0.5 text-[18px] font-bold text-ink">{w(m.net)} 萬</div>
              <div className="text-[11px] text-faint">淨利（本金 2,800 萬）</div>
              <div className="mt-0.5 text-[11px] text-muted">{s === 'K' || s === 'M' ? '年化（複利）' : '年化（單利）'} {p1(m.cagr)}・回撤 {p1(m.mdd_pct)}</div>
            </div>
          );
        })}
      </div>
    );
  }
  const val = (s: StageKey) => (mode === 'same' ? P.same[keyOf(s)]?.nd : P.raw[keyOf(s)]?.nd) ?? null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stages.map(s => {
        const v = val(s);
        const pv = prevOf[s] ? val(prevOf[s] as StageKey) : null;
        const d = v != null && pv != null && pv !== 0 ? v / pv - 1 : null;
        const m = mode === 'same' ? P.same[keyOf(s)] : null;
        return (
          <div key={s} className="rounded-xl border border-line bg-surface p-2.5" style={{ borderTop: `3px solid ${COLORS[s]}` }}>
            <div className="text-[11.5px] font-semibold text-muted">{LABEL[s]}</div>
            <div className="mt-0.5 text-[18px] font-bold text-ink">{f2(v)}</div>
            <div className="text-[11px] text-faint">淨利 ÷ 最大回撤</div>
            {d != null && <div className={`text-[11.5px] font-semibold ${d >= 0 ? 'text-up' : 'text-down'}`}>{d >= 0 ? '▲' : '▼'} {Math.abs(d * 100).toFixed(1)}%（比上一步）</div>}
            {m && <div className="mt-0.5 text-[11px] text-muted">年化 {p1(m.cagr)}・回撤 {p1(m.mdd_pct)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function MetricsTable({ P, mode, stages, keyOf, winOf }: {
  P: Pool; mode: Mode; stages: StageKey[]; keyOf: (s: StageKey) => string; winOf: (s: StageKey) => number | null;
}) {
  const R = P.real;
  const rows: Array<[string, (s: StageKey) => string]> = mode === 'real' && R
    ? [['淨利（萬）', s => w(R.stats[keyOf(s)].net)], ['最大回撤（萬）', s => w(R.stats[keyOf(s)].mdd)],
       ['年化報酬', s => p1(R.stats[keyOf(s)].cagr)], ['最大回撤 %', s => p1(R.stats[keyOf(s)].mdd_pct)],
       ['淨利 ÷ 回撤', s => f2(R.stats[keyOf(s)].nd)], ['Sharpe', s => f2(R.stats[keyOf(s)].sharpe)], ['最差年', s => p1(R.stats[keyOf(s)].worst_y)],
       ['期末口數倍數', s => (s === 'K' ? `${R.lots[keyOf(s)] ?? '—'} 倍` : s === 'M' ? '—' : '1 倍')]]
    : mode === 'same'
    ? [['淨利（萬）', s => w(P.same[keyOf(s)].net)], ['最大回撤（萬）', s => w(P.same[keyOf(s)].mdd)], ['淨利 ÷ 回撤', s => f2(P.same[keyOf(s)].nd)],
       ['年化報酬', s => p1(P.same[keyOf(s)].cagr)], ['最大回撤 %', s => p1(P.same[keyOf(s)].mdd_pct)], ['Sharpe', s => f2(P.same[keyOf(s)].sharpe)],
       ['最差年', s => p1(P.same[keyOf(s)].worst_y)], ['3 年勝率', s => { const v = winOf(s); return v == null ? '—' : `${Math.round(v * 100)}%`; }]]
    : [['淨利（萬）', s => w(P.raw[keyOf(s)].net)], ['最大回撤（萬）', s => w(P.raw[keyOf(s)].mdd)], ['淨利 ÷ 回撤', s => f2(P.raw[keyOf(s)].nd)],
       ['Sharpe', s => f2(P.raw[keyOf(s)].sharpe)], ['3 年勝率', s => { const v = winOf(s); return v == null ? '—' : `${Math.round(v * 100)}%`; }]];
  return (
    <table className="w-full text-[12px] sm:text-[12.5px]">
      <thead><tr className="text-muted">
        <th className="py-1 pr-2 text-left font-normal">指標</th>
        {stages.map(s => <th key={s} className="py-1 pl-1.5 text-right font-semibold" style={{ color: COLORS[s] }}>{s === 'K' ? '複利' : s === 'M' ? '大盤' : s}</th>)}
      </tr></thead>
      <tbody>{rows.map(([name, f]) => (
        <tr key={name} className="border-t border-line">
          <td className="py-1.5 pr-1 text-muted">{name}</td>
          {stages.map(s => <td key={s} className="whitespace-nowrap py-1.5 pl-1.5 text-right tabular-nums text-ink">{f(s)}</td>)}
        </tr>
      ))}</tbody>
    </table>
  );
}

function YearTable({ P, mode, stages, keyOf }: { P: Pool; mode: Mode; stages: StageKey[]; keyOf: (s: StageKey) => string }) {
  const src = (s: StageKey) => (mode === 'real' && P.real ? P.real.stats[keyOf(s)].years : mode === 'same' ? P.same[keyOf(s)].years : P.raw[keyOf(s)].years);
  const years = Object.keys(src(stages[0])).sort();
  const fmt = (v: number | undefined) => (v == null ? '—' : mode === 'raw' ? Math.round(v / 1e4).toLocaleString('zh-TW') : p1(v));
  return (
    <table className="w-full text-[12px] sm:text-[12.5px]">
      <thead><tr className="text-muted">
        <th className="py-1 pr-2 text-left font-normal">年</th>
        {stages.map(s => <th key={s} className="py-1 pl-1.5 text-right font-semibold" style={{ color: COLORS[s] }}>{s === 'K' ? '複利' : s === 'M' ? '大盤' : s}</th>)}
      </tr></thead>
      <tbody>{years.map(y => (
        <tr key={y} className="border-t border-line">
          <td className="py-1 pr-2 text-muted">{y}</td>
          {stages.map(s => { const v = src(s)[y]; return (
            <td key={s} className={`whitespace-nowrap py-1 pl-1.5 text-right tabular-nums ${v != null && v < 0 ? 'text-down' : 'text-ink'}`}>{fmt(v)}</td>); })}
        </tr>
      ))}</tbody>
    </table>
  );
}

function Chart({ P, mode, shown, keyOf }: { P: Pool; mode: Mode; shown: StageKey[]; keyOf: (s: StageKey) => string }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<{ setOption: (o: unknown, notMerge?: boolean) => void; resize: () => void; dispose: () => void } | null>(null);
  const opt = useMemo(() => {
    const series = shown.map(s => ({
      name: LABEL[s], type: 'line', showSymbol: false, smooth: false,
      itemStyle: { color: COLORS[s] }, lineStyle: { width: s === 'K' || s === 'C' ? 2 : 1.5, type: s === 'M' ? 'dashed' : 'solid' },
      data: (mode === 'real' && P.real ? P.real.series : mode === 'same' ? P.series_same : P.series_raw)[keyOf(s)] ?? [],
    }));
    return {
      animation: false, grid: { left: 52, right: 10, top: 26, bottom: 46 },
      legend: { top: 0, textStyle: { fontSize: 11 }, itemWidth: 14 },
      tooltip: { trigger: 'axis', confine: true, valueFormatter: (v: number) => `${Math.round(v).toLocaleString('zh-TW')} 萬` },
      xAxis: { type: 'category', data: P.weeks, axisLabel: { fontSize: 10 } },
      yAxis: mode !== 'raw' ? { type: 'log', axisLabel: { fontSize: 10 } } : { type: 'value', axisLabel: { fontSize: 10 } },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 6 }],
      series,
    };
  }, [P, mode, shown, keyOf]);
  useEffect(() => {
    let disposed = false;
    import('echarts').then(ec => {
      if (disposed || !el.current) return;
      chart.current = ec.init(el.current) as unknown as typeof chart.current;
      chart.current?.setOption(opt, true);
    });
    const onResize = () => chart.current?.resize();
    window.addEventListener('resize', onResize);
    return () => { disposed = true; window.removeEventListener('resize', onResize); chart.current?.dispose(); chart.current = null; };
    // 只建立一次；選項變動由下一個 effect 更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { chart.current?.setOption(opt, true); }, [opt]);
  return <div ref={el} className="mt-1 h-[300px] w-full overflow-hidden sm:h-[360px]" />;
}

/* 跨池穩健方案（提案）：內容全部來自加密資料（research/proposal_build.py），網頁程式只負責排版 */
function ProposalCard({ p }: { p: Proposal }) {
  return (
    <details open className="mt-3 rounded-xl border border-line bg-surface p-3">
      <summary className="cursor-pointer text-[14px] font-bold text-ink">📋 {p.title}（提案）<span className="ml-2 text-[11px] font-normal text-faint">{p.generated}</span></summary>
      <p className="mt-2 rounded-lg bg-sunken p-2.5 text-[12.5px] leading-relaxed text-ink">{p.summary}</p>
      {p.sections.map((s, i) => (
        <section key={i} className="mt-3">
          {s.h && <h2 className="text-[13px] font-bold text-ink">{s.h}</h2>}
          {s.paras?.map((t, j) => <p key={j} className="mt-1 text-[12.5px] leading-relaxed text-muted">{t}</p>)}
          {s.table && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead><tr className="text-muted">{s.table.head.map((h, j) => <th key={j} className={`whitespace-nowrap py-1 ${j ? 'pl-2 text-right' : 'pr-2 text-left'} font-semibold`}>{h}</th>)}</tr></thead>
                <tbody>{s.table.rows.map((r, j) => (
                  <tr key={j} className="border-t border-line">
                    {r.map((c, k) => <td key={k} className={`py-1.5 tabular-nums ${k ? 'whitespace-nowrap pl-2 text-right text-ink' : 'pr-2 text-muted'}`}>{c}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {s.note && <p className="mt-1 text-[11.5px] leading-relaxed text-faint">{s.note}</p>}
        </section>
      ))}
    </details>
  );
}
