/* 實盤年度績效分析（#/EQY，私人頁，密碼同 v18／#/EQ；2026-11-24 使用者：「每年年底結算要看這份分析」）。
 * 資料同 #/EQ（data/equity/equity.enc）；計算在 lib/equityYear.ts（沿用 equityAnalysis 的口徑：時間加權、每年從前一年最後一天起算）。
 * 驗證用：localStorage twetf.eqDemo=1 時不解鎖、改用假資料（lib/equityYear.demoRows，不含真實權益）。
 * 版面（手機 390px）：圖用 viewBox 縮放、表格放 overflow-x-auto。 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Vault, type VaultManifest } from '../lib/vault';
import { useVaultExpiry } from '../hooks/useVaultExpiry';
import { Locked } from './QBPage';
import type { EquityData } from '../lib/accountEquity';
import { withNav, type BmRow, type Period } from '../lib/equityAnalysis';
import { allYears, demoRows, monthGrid, yearNotes, type YearReport } from '../lib/equityYear';

const vault = new Vault(`${import.meta.env.BASE_URL}data/equity/`, 'twetf.v18.unlock');
type Data = EquityData & { bm_asof?: string | null; rows: BmRow[] };

const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const money = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf.format(Math.abs(Math.round(v)))}`;
const pct = (v: number | null | undefined, d = 1) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = Math.abs(v * 100).toFixed(d);
  return `${Number(s) === 0 ? '' : v > 0 ? '+' : '−'}${s}%`;       // 四捨五入成 0 的不加正負號（不顯示 −0.0%）
};
const f2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
const tone = (v: number | null | undefined) => (v == null ? 'text-muted' : v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted');
const isDemo = () => { try { return localStorage.getItem('twetf.eqDemo') === '1'; } catch { return false; } };

export function EquityYearPage() {
  const [manifest, setManifest] = useState<VaultManifest | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'locked' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<Data | null>(null);
  const [msg, setMsg] = useState('');
  const [demo] = useState(isDemo);
  const load = async () => {
    try { setState('loading'); setData(await vault.fetchJson<Data>('equity.enc')); setState('ready'); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setState('error'); }
  };
  useEffect(() => {
    if (demo) {
      const rows = demoRows();
      setData({ generated: '', asof: rows[rows.length - 1].d, rows, bm_asof: rows[rows.length - 1].d });
      setState('ready');
      return;
    }
    vault.loadManifest().then(async m => {
      if (!m) { setState('missing'); return; }
      setManifest(m);
      if (await vault.restore(m)) await load(); else setState('locked');
    }).catch(e => { setMsg(String(e)); setState('error'); });
  }, [demo]);
  useVaultExpiry(vault, state === 'ready' && !demo, () => { setData(null); setState('locked'); });

  if (state === 'loading') return <p className="py-16 text-center text-[13px] text-muted">載入中…</p>;
  if (state === 'missing') return <p className="py-16 text-center text-[13px] text-muted">還沒有資料。</p>;
  if (state === 'locked' && manifest) return <Locked vault={vault} title="年度績效分析" manifest={manifest} onUnlock={load} />;
  if (state === 'error' || !data) return <p className="py-16 text-center text-[13px] text-down">載入失敗：{msg}</p>;
  return <Board data={data} demo={demo} />;
}

function seg(active: boolean) {
  return `h-8 rounded-lg px-3 text-[12.5px] font-semibold ${active ? 'bg-surface text-ink shadow-sm ring-1 ring-line-strong' : 'text-muted hover:text-ink'}`;
}

function Board({ data, demo }: { data: Data; demo: boolean }) {
  const reps = useMemo(() => allYears(withNav(data.rows)), [data.rows]);
  const [year, setYear] = useState<string | null>(null);
  const i = Math.max(0, reps.findIndex(r => r.year === year));
  const r = reps[i];
  const prev = reps[i + 1] ?? null;
  if (!r) return <p className="py-16 text-center text-[13px] text-muted">還沒有完整的交易日資料。</p>;
  const k = r.k;
  const win = k.excess !== null && k.excess >= 0;

  return (
    <div className="mt-4 min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h1 className="text-base font-bold text-ink">年度績效分析（元大期貨）</h1>
        <Link to="/EQ" className="text-[12px] text-muted hover:text-ink">← 實盤權益分析</Link>
      </div>
      {demo && <p className="mb-2 rounded-lg bg-down/10 px-3 py-1.5 text-[12px] font-semibold text-down">示範模式：以下是假資料（twetf.eqDemo=1），不是你的帳戶。</p>}
      <p className="text-[11.5px] text-faint">
        每年從前一年最後一個交易日的淨值起算　·　報酬＝時間加權（出入金不影響）　·　大盤＝加權報酬指數（含息）　·　資料到 {data.asof}
      </p>

      <div className="mt-3 inline-flex flex-wrap gap-1 rounded-xl bg-sunken p-1">
        {reps.map(x => (
          <button key={x.year} type="button" className={seg(x.year === r.year)} onClick={() => setYear(x.year)}>
            {x.year}{x.partial ? '（至今）' : ''}
          </button>
        ))}
      </div>

      <div className={`mt-3 rounded-xl border p-3 ${k.excess === null ? 'border-line bg-sunken' : win ? 'border-up/40 bg-up/5' : 'border-down/40 bg-down/5'}`}>
        <div className="text-[12.5px] text-muted">{r.year} 年{r.partial ? `（年初至 ${r.to}）` : '全年'}</div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          <span className={`font-mono text-[22px] font-bold tabular-nums ${tone(k.ret)}`}>{pct(k.ret)}</span>
          <span className={`font-mono text-[15px] font-semibold tabular-nums ${tone(k.pnl)}`}>{money(k.pnl)} 元</span>
        </div>
        <div className="mt-0.5 text-[12.5px] text-muted">
          大盤（含息）{pct(k.bm)}　·　{k.excess === null ? '大盤資料不足' : <span className={`font-semibold ${win ? 'text-up' : 'text-down'}`}>{win ? '贏' : '輸'}大盤 {pct(Math.abs(k.excess))}</span>}
          　·　報酬 ÷ 最大回撤 <span className="font-mono font-semibold text-ink">{f2(r.mar)}</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="期初 → 期末淨值" value={nf.format(r.p.endNav)} sub={`期初 ${nf.format(r.p.startNav)}`} />
        <Tile label="出入金" value={r.p.flow ? money(r.p.flow) : '—'} sub="不算損益、不影響報酬率" />
        <Tile label="最大回撤" value={pct(k.mddPct)} cls="text-down" sub={`金額 ${money(k.mddMoney)}　大盤 ${pct(k.mddBm)}`} />
        <Tile label="Sharpe" value={f2(k.sharpe)} sub={`大盤 ${f2(k.sharpeBm)}　年化波動 ${pct(k.vol)}`} />
        <Tile label="稅費合計" value={r.feeDays ? nf.format(r.fee) : '—'}
              sub={r.feeDays ? `${r.feeShare !== null ? `佔毛利 ${(r.feeShare * 100).toFixed(0)}%　` : ''}${r.estDays ? `只算記錄的 ${r.feeDays} 天` : `${r.feeDays} 天`}` : '推算期間沒有稅費資料'} />
        <Tile label="平倉損益" value={r.feeDays ? money(r.cpl) : '—'} cls={tone(r.cpl)} sub={r.estDays ? `只算記錄的 ${r.feeDays} 天` : '已實現（不含未平倉）'} />
        <Tile label="賺錢的月份" value={`${r.upMonths}／${r.months.length}`} sub={r.bestMonth ? `最好 ${r.bestMonth.key.slice(5)} 月 ${pct(r.bestMonth.ret)}` : undefined} />
        <Tile label="賺錢的天數" value={`${(k.winRate * 100).toFixed(0)}%`} sub={`${r.p.winDays}／${r.p.n} 個交易日`} />
      </div>

      <Section title="每月報酬：帳戶 vs 大盤" hint="紅＝帳戶、灰＝大盤（含息）">
        <MonthBars ms={r.months} />
      </Section>
      <Section title="每月明細">
        <MonthTable ms={r.months} />
      </Section>
      <Section title="最深的回撤" hint="以帳戶報酬計；天數＝交易日">
        <DrawdownTable r={r} />
      </Section>
      <Section title="極值與連續">
        <Extremes r={r} />
      </Section>
      <Section title="年度觀察" hint="依上面的數字自動判斷">
        <ul className="space-y-1.5">
          {yearNotes(r, prev).map((n, j) => (
            <li key={j} className="flex gap-2 text-[12.5px] leading-relaxed text-ink">
              <span className={`mt-0.5 shrink-0 rounded px-1.5 text-[11px] font-semibold ${
                n.tone === 'good' ? 'bg-up/10 text-up' : n.tone === 'warn' ? 'bg-down/10 text-down' : 'bg-sunken text-muted'}`}>
                {n.tone === 'good' ? '優勢' : n.tone === 'warn' ? '注意' : '說明'}
              </span>
              <span>{n.text}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="歷年比較" hint="每年各自從 0 起算">
        <YearsTable reps={reps} />
      </Section>
      <Section title="月報酬一覽" hint="顏色越深＝漲跌越大">
        <Heat reps={reps} />
      </Section>
      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
        計算方式同實盤權益分析：當日損益＝今天權益總值 − 昨天權益總值 − 今天出入金；報酬＝每天（當日損益 ÷ 昨天權益總值）連乘；
        淨值＝權益總值 − 累計出入金。報酬 ÷ 最大回撤＝當年報酬 ÷ 當年最大回撤（%）。稅費＝元大記錄的「稅費合計」（手續費＋期交稅），
        佔毛利＝稅費 ÷（損益＋稅費）。用歷史平倉損益往回推算的日子沒有稅費與平倉損益欄，那段期間只算得出損益與報酬。
      </p>
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

const W = 640, H = 200, PL = 40, PR = 8, PT = 10, PB = 20;

function MonthBars({ ms }: { ms: Period[] }) {
  if (!ms.length) return null;
  const vals = ms.flatMap(m => [m.ret, m.bm ?? 0]);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const pad = (hi - lo) * 0.08 || 0.01;
  const y0 = lo - pad, y1 = hi + pad;
  const y = (v: number) => PT + ((y1 - v) / (y1 - y0)) * (H - PT - PB);
  const slot = (W - PL - PR) / ms.length, bw = slot * 0.36;
  const step = (() => { const raw = (y1 - y0) / 4; const mag = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw; })();
  const tks: number[] = [];
  for (let v = Math.ceil(y0 / step) * step; v <= y1 + 1e-12; v += step) tks.push(Math.round(v / step) * step);
  const bar = (v: number, x: number, fill: string, key: string) => {
    const top = y(Math.max(0, v)), bot = y(Math.min(0, v));
    return <rect key={key} x={x} width={bw} y={top} height={Math.max(1, bot - top)} rx="2" fill={fill} />;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="每月報酬：帳戶與大盤">
      {tks.map(t => (
        <g key={t}>
          <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--c-border-strong)' : 'var(--c-border)'} strokeWidth="1" />
          <text x={PL - 6} y={y(t) + 4} fontSize="11" fill="var(--c-faint)" textAnchor="end">{`${(t * 100).toFixed(Math.abs(t) < 0.1 && t !== 0 ? 1 : 0)}%`}</text>
        </g>
      ))}
      {ms.map((m, j) => {
        const x = PL + j * slot + slot * 0.12;
        return (
          <g key={m.key}>
            {bar(m.ret, x, m.ret >= 0 ? 'var(--c-up)' : 'var(--c-down)', 'a')}
            {m.bm !== null && bar(m.bm, x + bw + 2, 'var(--c-faint)', 'b')}
            <text x={x + bw} y={H - 4} fontSize="11" fill="var(--c-faint)" textAnchor="middle">{Number(m.key.slice(5))}</text>
          </g>
        );
      })}
    </svg>
  );
}

const th = 'py-1 pl-2 text-right font-semibold whitespace-nowrap';
const td = 'py-1 pl-2 text-right whitespace-nowrap';

function MonthTable({ ms }: { ms: Period[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-[12px] tabular-nums">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className="py-1 text-left font-semibold">月</th><th className={th}>損益</th><th className={th}>帳戶</th>
            <th className={th}>大盤（含息）</th><th className={th}>超額</th><th className={th}>最大回撤</th><th className={th}>賺錢天數</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {ms.map(m => (
            <tr key={m.key} className="border-b border-line last:border-0">
              <td className="py-1 text-left font-sans text-ink">{m.key}{m.bmPartial ? '＊' : ''}</td>
              <td className={`${td} ${tone(m.pnl)}`}>{money(m.pnl)}</td>
              <td className={`${td} ${tone(m.ret)}`}>{pct(m.ret)}</td>
              <td className={`${td} ${tone(m.bm)}`}>{pct(m.bm)}</td>
              <td className={`${td} font-semibold ${tone(m.excess)}`}>{pct(m.excess)}</td>
              <td className={`${td} text-down`}>{pct(m.mddPct)}</td>
              <td className={`${td} text-muted`}>{m.winDays}/{m.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ms.some(m => m.bmPartial) && <p className="mt-1 text-[11px] text-faint">＊大盤最後一天還沒公布，超額只比到大盤有資料的日子。</p>}
    </div>
  );
}

function DrawdownTable({ r }: { r: YearReport }) {
  if (!r.dds.length) return <p className="text-[12.5px] text-muted">這一年帳戶一路創新高，沒有回撤。</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-[12px] tabular-nums">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className="py-1 text-left font-semibold">前高</th><th className={th}>谷底</th><th className={th}>回到前高</th>
            <th className={th}>深度</th><th className={th}>金額</th><th className={th}>下跌天數</th><th className={th}>恢復天數</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {r.dds.map(d => (
            <tr key={d.start + d.trough} className="border-b border-line last:border-0">
              <td className="py-1 text-left">{d.start}</td>
              <td className={td}>{d.trough}</td>
              <td className={`${td} ${d.end ? '' : 'text-down'}`}>{d.end ?? '還沒回來'}</td>
              <td className={`${td} text-down`}>{pct(d.depth)}</td>
              <td className={`${td} text-down`}>{money(d.money)}</td>
              <td className={td}>{d.fall}</td>
              <td className={td}>{d.recover ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Extremes({ r }: { r: YearReport }) {
  const k = r.k;
  const items: [string, string, string?][] = [
    ['最好的一天', k.best ? `${k.best.d}　${money(k.best.pnl)}（${pct(k.best.ret, 2)}）` : '—'],
    ['最差的一天', k.worst ? `${k.worst.d}　${money(k.worst.pnl)}（${pct(k.worst.ret, 2)}）` : '—'],
    ['最好的月份', r.bestMonth ? `${r.bestMonth.key}　${money(r.bestMonth.pnl)}（${pct(r.bestMonth.ret)}）` : '—'],
    ['最差的月份', r.worstMonth ? `${r.worstMonth.key}　${money(r.worstMonth.pnl)}（${pct(r.worstMonth.ret)}）` : '—'],
    ['最長連續賺錢', r.win ? `${r.win.len} 天（${r.win.from} ～ ${r.win.to}）${money(r.win.pnl)}` : '—'],
    ['最長連續賠錢', r.loss ? `${r.loss.len} 天（${r.loss.from} ～ ${r.loss.to}）${money(r.loss.pnl)}` : '—'],
    ['獲利集中度', k.top3Share !== null ? `最好的 3 天佔全年損益 ${(k.top3Share * 100).toFixed(0)}%` : '—', '越高＝越靠少數幾天'],
    ['平均賺／平均賠（金額）', `${money(k.avgWin)}／${money(k.avgLoss)}`, k.pf !== null ? `總賺 ÷ 總賠 ${f2(k.pf)}` : undefined],
    ['beta／相關係數', `${f2(k.beta)}／${f2(k.corr)}`, '對大盤（含息）'],
  ];
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
      {items.map(([a, b, c]) => (
        <div key={a} className="min-w-0">
          <dt className="text-[11.5px] text-muted">{a}</dt>
          <dd className="font-mono text-ink tabular-nums">{b}{c && <span className="ml-1.5 font-sans text-[11px] text-faint">{c}</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function YearsTable({ reps }: { reps: YearReport[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-[12px] tabular-nums">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className="py-1 text-left font-semibold">年</th><th className={th}>帳戶</th><th className={th}>大盤（含息）</th><th className={th}>超額</th>
            <th className={th}>損益</th><th className={th}>最大回撤</th><th className={th}>報酬÷回撤</th><th className={th}>Sharpe</th>
            <th className={th}>賺錢月</th><th className={th}>稅費</th><th className={th}>最好月</th><th className={th}>最差月</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {reps.map(r => (
            <tr key={r.year} className="border-b border-line last:border-0">
              <td className="py-1 text-left font-sans text-ink">{r.year}{r.partial ? '（至今）' : ''}{r.estDays ? <span className="ml-1 text-[10.5px] text-faint">含推算</span> : null}</td>
              <td className={`${td} font-semibold ${tone(r.k.ret)}`}>{pct(r.k.ret)}</td>
              <td className={`${td} ${tone(r.k.bm)}`}>{pct(r.k.bm)}</td>
              <td className={`${td} ${tone(r.k.excess)}`}>{pct(r.k.excess)}</td>
              <td className={`${td} ${tone(r.k.pnl)}`}>{money(r.k.pnl)}</td>
              <td className={`${td} text-down`}>{pct(r.k.mddPct)}</td>
              <td className={`${td} text-ink`}>{f2(r.mar)}</td>
              <td className={`${td} text-ink`}>{f2(r.k.sharpe)}</td>
              <td className={`${td} text-muted`}>{r.upMonths}/{r.months.length}</td>
              <td className={`${td} text-muted`}>{r.feeDays ? nf.format(r.fee) : '—'}</td>
              <td className={`${td} ${tone(r.bestMonth?.ret)}`}>{r.bestMonth ? `${Number(r.bestMonth.key.slice(5))}月 ${pct(r.bestMonth.ret)}` : '—'}</td>
              <td className={`${td} ${tone(r.worstMonth?.ret)}`}>{r.worstMonth ? `${Number(r.worstMonth.key.slice(5))}月 ${pct(r.worstMonth.ret)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Heat({ reps }: { reps: YearReport[] }) {
  const g = monthGrid(reps);
  const max = Math.max(0.01, ...g.flatMap(r => r.m.filter((v): v is number => v !== null).map(Math.abs)));
  const cell = (v: number | null) => v === null ? undefined
    : { background: `color-mix(in srgb, var(${v >= 0 ? '--c-up' : '--c-down'}) ${Math.round(8 + (Math.abs(v) / max) * 42)}%, transparent)` };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[11.5px] tabular-nums">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className="py-1 text-left font-semibold">年</th>
            {Array.from({ length: 12 }, (_, j) => <th key={j} className="py-1 text-center font-semibold">{j + 1}月</th>)}
            <th className="py-1 pl-2 text-right font-semibold">全年</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {g.map(r => (
            <tr key={r.year} className="border-b border-line last:border-0">
              <td className="py-1 text-left font-sans text-ink">{r.year}</td>
              {r.m.map((v, j) => (
                <td key={j} className={`px-0.5 py-1 text-center ${tone(v)}`} style={cell(v)}>{v === null ? '' : pct(v)}</td>
              ))}
              <td className={`py-1 pl-2 text-right font-semibold ${tone(r.total)}`}>{pct(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
