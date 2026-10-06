/* 實盤權益分析（#/EQ，私人頁，密碼同 v18；2026-10-06 使用者要求從 #/me 拆出來單獨一頁）。
 * 資料：DashBoard_AI\equity_export.py → data/equity/equity.enc（每天 13:50 元大權益記錄後自動更新）。
 * 重點是「有沒有贏大盤」：帳戶時間加權報酬 vs 加權報酬指數（含息）；可選全部或單一年（每年從 0 重新算）。
 * 時間軸與大盤相同（週末、休市日在匯出端就拿掉，損益併到下一個交易日）。計算都在 lib/equityAnalysis.ts。
 * 版面（手機 390px）：圖用 viewBox 縮放、表格放 overflow-x-auto（見記憶 taiwanetf-mobile-layout）。 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Vault, type VaultManifest } from '../lib/vault';
import { useVaultExpiry } from '../hooks/useVaultExpiry';
import { Locked } from './QBPage';
import type { EquityData } from '../lib/accountEquity';
import { curve, days, notes, periods, risk, sliceYear, withNav, years, MIN_ANNUAL_DAYS, type BmRow, type Period, type Point, type Risk } from '../lib/equityAnalysis';

const vault = new Vault(`${import.meta.env.BASE_URL}data/equity/`, 'twetf.v18.unlock');
type Data = EquityData & { bm_asof?: string | null; rows: BmRow[] };

const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const money = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf.format(Math.abs(Math.round(v)))}`;
const pct = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d)}%`;
const f2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
const tone = (v: number | null | undefined) => (v == null ? 'text-muted' : v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted');

const ACC = 'var(--cat-1)', BM = 'var(--cat-2)', PX = 'var(--c-faint)';

export function EquityPage() {
  const [manifest, setManifest] = useState<VaultManifest | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'locked' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<Data | null>(null);
  const [msg, setMsg] = useState('');
  const load = async () => {
    try { setState('loading'); setData(await vault.fetchJson<Data>('equity.enc')); setState('ready'); }
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
  if (state === 'locked' && manifest) return <Locked vault={vault} title="實盤權益分析" manifest={manifest} onUnlock={load} />;
  if (state === 'error' || !data) return <p className="py-16 text-center text-[13px] text-down">載入失敗：{msg}</p>;
  return <Board data={data} />;
}

function seg(active: boolean) {
  return `h-8 rounded-lg px-3 text-[12.5px] font-semibold ${active ? 'bg-surface text-ink shadow-sm ring-1 ring-line-strong' : 'text-muted hover:text-ink'}`;
}

function Board({ data }: { data: Data }) {
  const all = useMemo(() => withNav(data.rows), [data.rows]);
  const ys = useMemo(() => years(all), [all]);
  const [year, setYear] = useState<string | null>(null);
  const rows = useMemo(() => sliceYear(all, year), [all, year]);
  const k = useMemo(() => risk(rows), [rows]);
  const c = useMemo(() => curve(rows), [rows]);
  const ds = useMemo(() => days(rows), [rows]);
  const months = useMemo(() => periods(ds, 'M').reverse(), [ds]);
  const yearly = useMemo(() => periods(days(all), 'Y').reverse(), [all]);
  const last = all[all.length - 1];
  const thisMonth = months[0];
  if (!k || !last) return <p className="py-16 text-center text-[13px] text-muted">這段期間沒有資料。</p>;
  const scope = year ? `${year} 年` : '全部期間';
  const bmLag = data.bm_asof && data.bm_asof < data.asof;

  return (
    <div className="mt-4 min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h1 className="text-base font-bold text-ink">實盤權益分析（元大期貨）</h1>
        <Link to="/me" className="text-[12px] text-muted hover:text-ink">← 我的工具</Link>
      </div>
      <p className="text-[11.5px] text-faint">
        資料 {rows[0].d} ～ {data.asof}　·　大盤＝加權報酬指數（含息）{bmLag ? `，大盤資料到 ${data.bm_asof}（當天收盤稍晚公布）` : ''}
        　·　損益已扣出入金、時間軸同大盤交易日
      </p>

      <div className="mt-3 inline-flex flex-wrap gap-1 rounded-xl bg-sunken p-1">
        <button type="button" className={seg(year === null)} onClick={() => setYear(null)}>全部</button>
        {ys.map(y => <button key={y} type="button" className={seg(year === y)} onClick={() => setYear(y)}>{y}</button>)}
      </div>

      <Verdict k={k} scope={scope} />

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="淨值" value={nf.format(last.nav ?? last.tv)} sub={`權益總值 ${nf.format(last.tv)}（含出入金）　未平倉 ${last.oi} 口`} />
        <Tile label={`${scope}損益`} value={money(k.pnl)} cls={tone(k.pnl)} sub={`${k.n} 個交易日`} />
        <Tile label="帳戶報酬（時間加權）" value={pct(k.ret)} cls={tone(k.ret)} sub={`年化 ${pct(k.ann)}${k.n < MIN_ANNUAL_DAYS ? '（僅供參考）' : ''}`} />
        <Tile label="大盤（含息）" value={pct(k.bm)} cls={tone(k.bm)} sub={k.annBm !== null ? `年化 ${pct(k.annBm)}${k.n < MIN_ANNUAL_DAYS ? '（僅供參考）' : ''}` : '加權報酬指數'} />
        <Tile label="超額報酬" value={pct(k.excess)} cls={tone(k.excess)} sub={k.beatDays !== null ? `贏大盤的天數 ${(k.beatDays * 100).toFixed(0)}%` : undefined} />
        <Tile label="同一筆錢放大盤" value={k.bmPnl === null ? '—' : money(k.bmPnl)} cls={tone(k.bmPnl)}
              sub={k.bmPnl === null ? undefined : `你多賺 ${money(k.pnl - k.bmPnl)}`} />
        <Tile label="最大回撤" value={pct(k.mddPct)} cls="text-down" sub={`金額 ${money(k.mddMoney)}　大盤 ${pct(k.mddBm)}`} />
        <Tile label="本月損益" value={thisMonth ? money(thisMonth.pnl) : '—'} cls={tone(thisMonth?.pnl)}
              sub={thisMonth ? `帳戶 ${pct(thisMonth.ret)}　大盤 ${pct(thisMonth.bm)}` : undefined} />
      </div>

      <Section title="累積報酬：帳戶 vs 大盤" hint="同一起點，從 0% 起算；滑過去看當天數字">
        <LineChart pts={c} kind="ret" />
      </Section>
      <Section title="回撤（距前高 %）" hint="越往下代表離前一個高點越遠">
        <LineChart pts={c} kind="dd" />
      </Section>
      <Section title="每日損益（元）" hint="紅＝賺、綠＝賠（台股慣例）">
        <Bars ds={ds} />
      </Section>

      <Section title="每年" hint="每年都從前一年最後一天重新起算">
        <PeriodTable ps={yearly} />
      </Section>
      <Section title={`每月（${scope}）`}>
        <PeriodTable ps={months} />
      </Section>
      <Section title={`風險與報酬（${scope}）`} hint="帳戶與大盤用同一批交易日計算">
        <RiskTable k={k} />
      </Section>
      <Section title="觀察與建議" hint="依上面的數字自動判斷，資料越多越可靠">
        <ul className="space-y-1.5">
          {notes(k).map((n, i) => (
            <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-ink">
              <span className={`mt-0.5 shrink-0 rounded px-1.5 text-[11px] font-semibold ${
                n.tone === 'good' ? 'bg-up/10 text-up' : n.tone === 'warn' ? 'bg-down/10 text-down' : 'bg-sunken text-muted'}`}>
                {n.tone === 'good' ? '優勢' : n.tone === 'warn' ? '注意' : '說明'}
              </span>
              <span>{n.text}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="每日明細" hint="最新在上">
        <DailyTable ds={ds} />
      </Section>
      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
        計算方式：淨值＝權益總值 − 從 {all[0].d} 起的累計出入金（同元大的淨值，出入金不會讓它跳動）；當日損益＝今天權益總值 − 昨天權益總值 − 今天出入金；帳戶報酬＝每天（當日損益 ÷ 昨天權益總值）連乘，出入金不影響。
        超額報酬只比大盤已公布的日子。「同一筆錢放大盤」＝每天把昨天的權益總值放在加權報酬指數會賺多少，與你的實際損益同單位比較。
        beta／alpha 用每日報酬回歸；樣本少時波動很大。
      </p>
    </div>
  );
}

function Verdict({ k, scope }: { k: Risk; scope: string }) {
  if (k.excess === null) return null;
  const win = k.excess >= 0;
  return (
    <div className={`mt-3 rounded-xl border p-3 ${win ? 'border-up/40 bg-up/5' : 'border-down/40 bg-down/5'}`}>
      <div className={`text-[15px] font-bold ${win ? 'text-up' : 'text-down'}`}>
        {win ? '▲ 贏大盤' : '▼ 輸大盤'} {pct(Math.abs(k.excess))}
      </div>
      <div className="mt-0.5 text-[12.5px] text-muted">
        {scope}：帳戶 {pct(k.ret)}　vs　大盤（含息）{pct(k.bm)}
        {k.sharpe !== null && k.sharpeBm !== null && <>　·　Sharpe {f2(k.sharpe)} vs {f2(k.sharpeBm)}</>}
      </div>
    </div>
  );
}

function Tile({ label, value, cls = 'text-ink', sub }: { label: string; value: string; cls?: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-sunken px-3 py-2">
      <div className="truncate text-[11.5px] text-muted">{label}</div>
      <div className={`font-mono text-[15px] font-bold tabular-nums ${cls}`}>{value}</div>
      {sub && <div className="text-[11px] leading-snug text-faint">{sub}</div>}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-3 min-w-0 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-sm font-bold text-ink">{title}</h2>
        {hint && <span className="text-[11.5px] text-faint">{hint}</span>}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

const W = 640, H = 220, PL = 44, PR = 10, PT = 10, PB = 20;

function ticks(lo: number, hi: number, n = 4) {
  const span = hi - lo || 1;
  const raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(Math.round(v / step) * step);
  return out;
}

function LineChart({ pts, kind }: { pts: Point[]; kind: 'ret' | 'dd' }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = kind === 'ret'
    ? [{ key: 'acc', label: '帳戶', color: ACC, dash: '' }, { key: 'bm', label: '大盤（含息）', color: BM, dash: '' },
       { key: 'px', label: '加權指數（不含息）', color: PX, dash: '4 3' }]
    : [{ key: 'accDd', label: '帳戶', color: ACC, dash: '' }, { key: 'bmDd', label: '大盤（含息）', color: BM, dash: '' }];
  const get = (p: Point, key: string) => (p as unknown as Record<string, number | null>)[key];
  const vals = pts.flatMap(p => series.map(s => get(p, s.key)).filter((v): v is number => v !== null));
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const pad = (hi - lo) * 0.06 || 0.01;
  const y0 = lo - (kind === 'dd' ? pad : pad), y1 = hi + (kind === 'dd' ? 0 : pad);
  const x = (i: number) => PL + (pts.length === 1 ? 0.5 : i / (pts.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + ((y1 - v) / (y1 - y0 || 1)) * (H - PT - PB);
  const path = (key: string) => {
    let d = '', pen = false;
    pts.forEach((p, i) => { const v = get(p, key); if (v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    return d;
  };
  const h = hover === null ? null : pts[hover];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-pan-y" role="img"
           aria-label={kind === 'ret' ? '累積報酬：帳戶與大盤' : '回撤：帳戶與大盤'}
           onMouseLeave={() => setHover(null)}
           onPointerMove={e => {
             const b = e.currentTarget.getBoundingClientRect();
             const px = ((e.clientX - b.left) / b.width) * W;
             setHover(Math.max(0, Math.min(pts.length - 1, Math.round(((px - PL) / (W - PL - PR)) * (pts.length - 1)))));
           }}>
        {ticks(y0, y1).map(t => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--c-border-strong)' : 'var(--c-border)'} strokeWidth="1" />
            <text x={PL - 6} y={y(t) + 4} fontSize="11" fill="var(--c-faint)" textAnchor="end">{`${(t * 100).toFixed(Math.abs(t) < 0.1 && t !== 0 ? 1 : 0)}%`}</text>
          </g>
        ))}
        {series.map(s => <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} strokeLinejoin="round" />)}
        <text x={PL} y={H - 4} fontSize="11" fill="var(--c-faint)">{pts[0].d}</text>
        <text x={W - PR} y={H - 4} fontSize="11" fill="var(--c-faint)" textAnchor="end">{pts[pts.length - 1].d}</text>
        {h && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PT} y2={H - PB} stroke="var(--c-border-strong)" strokeDasharray="3 3" />
            {series.map(s => { const v = get(h, s.key); return v === null ? null :
              <circle key={s.key} cx={x(hover)} cy={y(v)} r="4" fill={s.color} stroke="var(--c-surface)" strokeWidth="2" />; })}
          </>
        )}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-1 right-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11.5px] shadow">
          <div className="font-semibold text-ink">{h.d}</div>
          {series.map(s => <div key={s.key}>{s.label} <span className={`font-mono ${tone(get(h, s.key))}`}>{pct(get(h, s.key), 2)}</span></div>)}
          {kind === 'ret' && h.bm !== null && <div className="text-faint">差 <span className="font-mono">{pct(h.acc - h.bm, 2)}</span></div>}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted">
        {series.map(s => (
          <span key={s.key} className="flex items-center gap-1">
            <svg width="16" height="4"><line x1="0" x2="16" y1="2" y2="2" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} /></svg>{s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Bars({ ds }: { ds: ReturnType<typeof days> }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!ds.length) return null;
  const lo = Math.min(0, ...ds.map(d => d.pnl)), hi = Math.max(0, ...ds.map(d => d.pnl));
  const y = (v: number) => PT + ((hi - v) / (hi - lo || 1)) * (H - PT - PB);
  const bw = (W - PL - PR) / ds.length;
  const h = hover === null ? null : ds[hover];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-pan-y" role="img" aria-label="每日損益（元）"
           onMouseLeave={() => setHover(null)}
           onPointerMove={e => {
             const b = e.currentTarget.getBoundingClientRect();
             const px = ((e.clientX - b.left) / b.width) * W;
             setHover(Math.max(0, Math.min(ds.length - 1, Math.floor((px - PL) / bw))));
           }}>
        {ticks(lo, hi).map(t => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--c-border-strong)' : 'var(--c-border)'} strokeWidth="1" />
            <text x={PL - 6} y={y(t) + 4} fontSize="11" fill="var(--c-faint)" textAnchor="end">{`${Math.round(t / 1e4)}萬`}</text>
          </g>
        ))}
        {ds.map((d, i) => {
          const top = y(Math.max(0, d.pnl)), bot = y(Math.min(0, d.pnl));
          return <rect key={d.d} x={PL + i * bw + bw * 0.15} width={Math.max(1, bw * 0.7)} y={top} height={Math.max(1, bot - top)} rx="2"
                       fill={d.pnl >= 0 ? 'var(--c-up)' : 'var(--c-down)'} opacity={hover === null || hover === i ? 0.9 : 0.45} />;
        })}
        <text x={PL} y={H - 4} fontSize="11" fill="var(--c-faint)">{ds[0].d}</text>
        <text x={W - PR} y={H - 4} fontSize="11" fill="var(--c-faint)" textAnchor="end">{ds[ds.length - 1].d}</text>
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-1 right-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11.5px] shadow">
          <div className="font-semibold text-ink">{h.d}</div>
          <div>損益 <span className={`font-mono ${tone(h.pnl)}`}>{money(h.pnl)}</span>（{pct(h.ret, 2)}）</div>
          <div>大盤 <span className={`font-mono ${tone(h.bm)}`}>{pct(h.bm, 2)}</span></div>
          {h.flow !== 0 && <div className="text-faint">出入金 {money(h.flow)}（不算損益）</div>}
        </div>
      )}
    </div>
  );
}

const th = 'py-1 pl-2 text-right font-semibold whitespace-nowrap';
const td = 'py-1 pl-2 text-right whitespace-nowrap';

function PeriodTable({ ps }: { ps: Period[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[12px] tabular-nums">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className="py-1 text-left font-semibold">期間</th>
            <th className={th}>期初淨值</th><th className={th}>期末淨值</th><th className={th}>出入金</th>
            <th className={th}>損益</th><th className={th}>帳戶</th><th className={th}>大盤（含息）</th><th className={th}>加權指數</th>
            <th className={th}>超額</th><th className={th}>同資金放大盤</th><th className={th}>最大回撤</th><th className={th}>勝率</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {ps.map(p => (
            <tr key={p.key} className="border-b border-line last:border-0">
              <td className="py-1 text-left font-sans text-ink">{p.key}{p.bmPartial ? '＊' : ''}</td>
              <td className={`${td} text-muted`}>{nf.format(p.startNav)}</td>
              <td className={`${td} text-ink`}>{nf.format(p.endNav)}</td>
              <td className={`${td} text-muted`}>{p.flow ? money(p.flow) : '—'}</td>
              <td className={`${td} ${tone(p.pnl)}`}>{money(p.pnl)}</td>
              <td className={`${td} ${tone(p.ret)}`}>{pct(p.ret)}</td>
              <td className={`${td} ${tone(p.bm)}`}>{pct(p.bm)}</td>
              <td className={`${td} ${tone(p.bmPx)}`}>{pct(p.bmPx)}</td>
              <td className={`${td} font-semibold ${tone(p.excess)}`}>{pct(p.excess)}</td>
              <td className={`${td} ${tone(p.bmPnl)}`}>{p.bmPnl === null ? '—' : money(p.bmPnl)}</td>
              <td className={`${td} text-down`}>{pct(p.mddPct)}</td>
              <td className={`${td} text-muted`}>{p.winDays}/{p.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ps.some(p => p.bmPartial) && <p className="mt-1 text-[11px] text-faint">＊大盤最後一天還沒公布，超額報酬只比到大盤有資料的日子。</p>}
    </div>
  );
}

function RiskTable({ k }: { k: Risk }) {
  const rows: [string, string, string, string?][] = [
    ['報酬', pct(k.ret), pct(k.bm)],
    ['年化報酬', pct(k.ann), pct(k.annBm), k.n < MIN_ANNUAL_DAYS ? `只有 ${k.n} 天推算一整年，僅供參考（滿 ${MIN_ANNUAL_DAYS} 天較可信）` : undefined],
    ['年化波動', pct(k.vol), pct(k.volBm)],
    ['Sharpe（無風險利率 0）', f2(k.sharpe), f2(k.sharpeBm)],
    ['Sortino', f2(k.sortino), f2(k.sortinoBm)],
    ['最大回撤', pct(k.mddPct), pct(k.mddBm)],
    ['報酬 ÷ 最大回撤', k.mddPct < 0 ? f2(k.ret / -k.mddPct) : '—', k.mddBm && k.mddBm < 0 && k.bm !== null ? f2(k.bm / -k.mddBm) : '—'],
    ['beta（對大盤）', f2(k.beta), '1.00', '1 ＝ 跟大盤同幅度；>1 放大、<0 反向'],
    ['相關係數', f2(k.corr), '1.00'],
    ['alpha（年化）', pct(k.alpha), '0.0%', `扣掉 beta × 大盤後的超額${k.nBm < 40 ? '；樣本少，雜訊大' : ''}`],
    ['上漲捕獲／下跌捕獲', `${f2(k.upCap)}／${f2(k.downCap)}`, '1.00／1.00', '大盤漲（跌）的日子，帳戶平均漲（跌）幾倍'],
    ['贏大盤的天數', k.beatDays === null ? '—' : `${(k.beatDays * 100).toFixed(0)}%`, k.beatDays === null ? '—' : `${(100 - k.beatDays * 100).toFixed(0)}%`, '大盤欄＝大盤贏帳戶的天數'],
    ['勝率（上漲的天數）', `${(k.winRate * 100).toFixed(0)}%`, k.winRateBm === null ? '—' : `${(k.winRateBm * 100).toFixed(0)}%`],
    ['獲利因子（總漲 ÷ 總跌，以報酬率）', f2(k.pfRet), f2(k.pfBm), `金額：總賺 ÷ 總賠 ${f2(k.pf)}`],
    ['平均上漲日／平均下跌日', `${pct(k.avgUp, 2)}／${pct(k.avgDown, 2)}`, k.avgUpBm === null ? '—' : `${pct(k.avgUpBm, 2)}／${pct(k.avgDownBm, 2)}`,
     `金額：平均賺 ${money(k.avgWin)}／平均賠 ${money(k.avgLoss)}`],
    ['最好的一天', k.best ? `${pct(k.best.ret, 2)}（${k.best.d.slice(5)}）` : '—', k.bestBm ? `${pct(k.bestBm.bm, 2)}（${k.bestBm.d.slice(5)}）` : '—',
     k.best ? `金額 ${money(k.best.pnl)}` : undefined],
    ['最差的一天', k.worst ? `${pct(k.worst.ret, 2)}（${k.worst.d.slice(5)}）` : '—', k.worstBm ? `${pct(k.worstBm.bm, 2)}（${k.worstBm.d.slice(5)}）` : '—',
     k.worst ? `金額 ${money(k.worst.pnl)}` : undefined],
    ['目前回撤', pct(k.ddNowPct), pct(k.ddNowBm), `金額 ${money(k.ddNow)}；${k.ddDays ? `帳戶已 ${k.ddDays} 天沒創新高` : '帳戶在高點'}${k.ddDaysBm ? `、大盤已 ${k.ddDaysBm} 天` : k.ddDaysBm === 0 ? '、大盤在高點' : ''}`],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] text-[12px] tabular-nums">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className="py-1 text-left font-semibold">指標</th><th className={th}>帳戶</th><th className={th}>大盤（含息）</th>
            <th className="py-1 pl-3 text-left font-semibold">說明</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b, c, d]) => (
            <tr key={a} className="border-b border-line last:border-0">
              <td className="py-1 text-left text-ink">{a}</td>
              <td className={`${td} font-mono text-ink`}>{b}</td>
              <td className={`${td} font-mono text-muted`}>{c}</td>
              <td className="py-1 pl-3 text-left text-[11.5px] text-faint">{d ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyTable({ ds }: { ds: ReturnType<typeof days> }) {
  const [all, setAll] = useState(false);
  const list = [...ds].reverse();
  const shown = all ? list : list.slice(0, 20);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[12px] tabular-nums">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className="py-1 text-left font-semibold">日期</th><th className={th}>淨值</th><th className={th}>損益</th>
            <th className={th}>帳戶</th><th className={th}>大盤</th><th className={th}>差</th><th className={th}>出入金</th><th className={th}>未平倉</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {shown.map(d => (
            <tr key={d.d} className="border-b border-line last:border-0">
              <td className="py-1 text-left font-sans">{d.d}</td>
              <td className={`${td} text-ink`}>{nf.format(d.nav)}</td>
              <td className={`${td} ${tone(d.pnl)}`}>{money(d.pnl)}</td>
              <td className={`${td} ${tone(d.ret)}`}>{pct(d.ret, 2)}</td>
              <td className={`${td} ${tone(d.bm)}`}>{pct(d.bm, 2)}</td>
              <td className={`${td} ${tone(d.bm === null ? null : d.ret - d.bm)}`}>{d.bm === null ? '—' : pct(d.ret - d.bm, 2)}</td>
              <td className={`${td} text-muted`}>{d.flow ? money(d.flow) : '—'}</td>
              <td className={`${td} text-muted`}>{d.oi}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length > 20 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 h-8 rounded-lg bg-sunken px-3 text-[12px] text-muted hover:text-ink">
          {all ? '收起' : `顯示全部 ${list.length} 天`}
        </button>
      )}
    </div>
  );
}
