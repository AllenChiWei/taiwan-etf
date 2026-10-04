/* v18 策略頁（獨立密碼）。
 *
 * 資料由使用者自己的電腦每天跑 v18 回測產生（D:\ai\DashBoard_AI\v18_export.py），
 * 在本機加密後才推上來；網站與部署流程都碰不到明文。沒有密碼只能下載到亂數。
 * 這頁刻意不放進上方選單、也不寫進更新日誌：只給知道網址與密碼的人自己看。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { VaultManifest } from '../lib/vault';
import { v18Vault as vault, type V18Data } from '../lib/v18';

const pct = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(d)}%`;
const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted');
const nf1 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });

const STATUS: Record<string, string> = {
  hold: '續抱', enter: '進場', sl: '止損出場', tp: '停利出場', ts: '移動止損出場', exit: '訊號出場',
};

function Card({ label, value, sub, cls = '' }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg px-3 py-2">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-[18px] font-bold tabular-nums ${cls}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

/** 權益曲線（對數刻度：十幾年的複利用線性刻度會把前幾年壓成一條平線）。 */
function EquityChart({ d, v }: { d: string[]; v: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000, H = 280, P = { t: 12, r: 12, b: 24, l: 56 };
  if (d.length < 2) return null;
  const lv = v.map(x => Math.log(x));
  const lo = Math.min(...lv), hi = Math.max(...lv);
  const x = (i: number) => P.l + (i / (d.length - 1)) * (W - P.l - P.r);
  const y = (l: number) => P.t + (1 - (l - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const path = lv.map((l, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(l).toFixed(1)}`).join('');
  const ticks: number[] = [];
  for (let m = 1; m <= Math.exp(hi) * 1.01; m *= 2) if (Math.log(m) >= lo) ticks.push(m);
  const years = d.map((s, i) => [s.slice(0, 4), i] as const).filter(([yr, i]) => i === 0 || d[i - 1].slice(0, 4) !== yr);
  const h = hover === null ? null : Math.max(0, Math.min(d.length - 1, hover));
  return (
    <div className="mt-2 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[640px] touch-pan-y" role="img" aria-label="v18 權益曲線"
           onMouseLeave={() => setHover(null)}
           onMouseMove={e => {
             const r = e.currentTarget.getBoundingClientRect();
             setHover(Math.round((((e.clientX - r.left) / r.width) * W - P.l) / (W - P.l - P.r) * (d.length - 1)));
           }}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(Math.log(t))} y2={y(Math.log(t))} stroke="var(--c-border)" opacity="0.5" />
            <text x={P.l - 6} y={y(Math.log(t))} textAnchor="end" dominantBaseline="middle" fontSize="12" fill="var(--c-faint)">{t}×</text>
          </g>
        ))}
        {years.filter((_, k) => years.length <= 12 || k % 2 === 0).map(([yr, i]) => (
          <text key={yr} x={x(i)} y={H - 6} fontSize="12" fill="var(--c-faint)" textAnchor={i === 0 ? 'start' : 'middle'}>{yr}</text>
        ))}
        <path d={path} fill="none" stroke="var(--c-accent, #2563eb)" strokeWidth="2" strokeLinejoin="round" />
        {h !== null && <circle cx={x(h)} cy={y(lv[h])} r="3.5" fill="var(--c-accent, #2563eb)" />}
      </svg>
      <div className="mt-1 min-h-[1.5em] text-[12px] text-muted">
        {h === null ? '游標移到圖上看各日期的累積倍數' : <>{d[h]}　累積 <b className="text-ink">{nf1.format(v[h])}×</b>（{pct(v[h] - 1, 0)}）</>}
      </div>
    </div>
  );
}

function MonthTable({ monthly }: { monthly: Record<string, number> }) {
  const years = [...new Set(Object.keys(monthly).map(k => k.slice(0, 4)))].sort().reverse();
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[760px] font-mono text-[12px] tabular-nums">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className="py-1.5 text-left font-sans font-semibold">年</th>
            {Array.from({ length: 12 }, (_, i) => <th key={i} className="text-right font-sans font-semibold">{i + 1}月</th>)}
            <th className="text-right font-sans font-semibold">全年</th>
          </tr>
        </thead>
        <tbody>
          {years.map(yr => {
            const ms = Array.from({ length: 12 }, (_, i) => monthly[`${yr}-${String(i + 1).padStart(2, '0')}`]);
            const total = ms.reduce<number>((a, m) => (m === undefined ? a : a * (1 + m)), 1) - 1;
            return (
              <tr key={yr} className="border-b border-line/60">
                <td className="py-1 font-sans">{yr}</td>
                {ms.map((m, i) => (m === undefined ? <td key={i} /> : <td key={i} className={`px-1 py-1 text-right ${tone(m)}`}>{pct(m)}</td>))}
                <td className={`px-1 py-1 text-right font-semibold ${tone(total)}`}>{pct(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Locked({ manifest, onUnlock }: { manifest: VaultManifest; onUnlock: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <form className="mx-auto mt-10 max-w-sm rounded-xl border border-line bg-surface p-5"
          onSubmit={async e => {
            e.preventDefault();
            setBusy(true); setErr(null);
            const ok = await vault.unlock(pw, manifest);
            setBusy(false);
            if (ok) onUnlock(); else setErr('密碼不正確');
          }}>
      <h1 className="text-sm font-bold text-ink">v18 策略</h1>
      <p className="mt-1 text-[12px] text-muted">這一頁需要密碼。</p>
      <input ref={ref} type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password"
             className="mt-3 h-10 w-full rounded-lg border border-line bg-bg px-3 text-[14px] text-ink" placeholder="密碼" />
      {err && <p className="mt-2 text-[12px] text-down">{err}</p>}
      <button type="submit" disabled={busy || !pw}
              className="mt-3 h-10 w-full rounded-lg bg-accent text-[13px] font-semibold text-accent-ink disabled:opacity-50">
        {busy ? '解鎖中…' : '解鎖'}
      </button>
    </form>
  );
}

export function V18Page() {
  const [manifest, setManifest] = useState<VaultManifest | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'locked' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<V18Data | null>(null);
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      setData(await vault.fetchJson<V18Data>('v18.enc'));
      setState('ready');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  };

  useEffect(() => {
    vault.loadManifest().then(async m => {
      if (!m) { setState('missing'); return; }
      setManifest(m);
      if (await vault.restore(m)) await load(); else setState('locked');
    }).catch(e => { setMsg(String(e)); setState('error'); });
  }, []);

  const recent = useMemo(() => (data ? [...data.trades].reverse() : []), [data]);

  if (state === 'loading') return <p className="py-16 text-center text-[13px] text-muted">載入中…</p>;
  if (state === 'missing') return <p className="py-16 text-center text-[13px] text-muted">還沒有資料。</p>;
  if (state === 'locked' && manifest) return <Locked manifest={manifest} onUnlock={load} />;
  if (state === 'error' || !data) return <p className="py-16 text-center text-[13px] text-down">載入失敗：{msg}</p>;

  const s = data.stats;
  return (
    <>
      <div className="mt-4 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-sm font-bold text-ink">v18 策略　資料截至 {data.asof}</h1>
          <button type="button" onClick={() => { vault.lock(); setData(null); setState('locked'); }}
                  className="h-7 rounded-lg bg-sunken px-3 text-[12px] text-muted hover:text-ink">上鎖</button>
        </div>
        <p className="mt-1 text-[12px] text-muted">
          總經 regime：{data.regime.bull ? '🟢 可做多' : '🔴 全數空倉'}
          {data.regime.signal !== null && <>　景氣信號 {data.regime.signal} 分（近 3 月 {data.regime.signalChg !== null && data.regime.signalChg >= 0 ? '+' : ''}{data.regime.signalChg}）</>}
          {data.regime.m1b !== null && <>　M1B 年增 {pct(data.regime.m1b, 2)}</>}
        </p>
        <p className="mt-1 text-[11px] text-faint">數字為 v18 回測（隔日開盤成交、停損 10%、移動停利 13%、停利 45%），僅供本人參考，不構成投資建議。產生於 {data.generated}</p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="今年以來" value={pct(s.ytd)} cls={tone(s.ytd)} sub={`今年最大回撤 ${pct(s.ytdMdd)}`} />
        <Card label="近 1 個月／3 個月" value={pct(s.m1)} cls={tone(s.m1)} sub={`近 3 個月 ${pct(s.m3)}`} />
        <Card label={`年化（${s.since} 起）`} value={pct(s.cagr)} cls={tone(s.cagr)} sub={`Sharpe ${s.sharpe.toFixed(2)}`} />
        <Card label="最大回撤（全期）" value={pct(s.mdd)} cls="text-down" />
      </div>

      <section className="mt-4 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <h2 className="text-sm font-bold text-ink">明日開盤</h2>
        {data.actions.length === 0 ? <p className="mt-1 text-[12.5px] text-muted">無需調整部位。</p> : (
          <ul className="mt-1 space-y-0.5 text-[12.5px]">
            {data.actions.map(a => <li key={a.id}><b>{a.id} {a.name}</b>　{a.action}</li>)}
          </ul>
        )}
        <h2 className="mt-3 text-sm font-bold text-ink">目前持股（{data.holdings.length} 檔）</h2>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="py-1.5 text-left font-semibold">股票</th><th className="text-left font-semibold">進場日</th>
                <th className="text-right font-semibold">進場價</th><th className="text-right font-semibold">現價</th>
                <th className="text-right font-semibold">報酬</th><th className="text-right font-semibold">狀態</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {data.holdings.map(h => (
                <tr key={h.id} className="border-b border-line/60">
                  <td className="py-1.5 font-sans">{h.id} {h.name}</td><td>{h.entry}</td>
                  <td className="text-right">{nf1.format(h.entryPrice)}</td><td className="text-right">{nf1.format(h.price)}</td>
                  <td className={`text-right ${tone(h.ret)}`}>{pct(h.ret, 2)}</td>
                  <td className="text-right font-sans">{STATUS[h.status] ?? h.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h2 className="mt-3 text-sm font-bold text-ink">最新選股（訊號日 {data.selection.date}）</h2>
        {data.selection.pending && (
          <p className="mt-1 text-[11.5px] text-down">訊號日還沒到：目前只有提早公布營收的公司，名單會隨營收陸續公布而變動，以訊號日當天為準。</p>
        )}
        <p className="mt-1 text-[12.5px] text-ink">
          {data.selection.list.length ? data.selection.list.map(x => `${x.id} ${x.name}${x.yoy === null ? '' : `（營收年增 ${nf1.format(x.yoy)}%）`}`).join('、') : '無符合條件的股票'}
        </p>
      </section>

      <section className="mt-4 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <h2 className="text-sm font-bold text-ink">權益曲線（對數刻度）</h2>
        <EquityChart d={data.equity.d} v={data.equity.v} />
        <h2 className="mt-4 text-sm font-bold text-ink">每月報酬</h2>
        <MonthTable monthly={data.monthly} />
      </section>

      <section className="mt-4 mb-4 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <h2 className="text-sm font-bold text-ink">最近的交易（{recent.length} 筆）</h2>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[480px] text-[12.5px]">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="py-1.5 text-left font-semibold">股票</th><th className="text-left font-semibold">進場</th>
                <th className="text-left font-semibold">出場</th><th className="text-right font-semibold">報酬</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {recent.map((t, i) => (
                <tr key={i} className="border-b border-line/60">
                  <td className="py-1.5 font-sans">{t.id} {t.name}</td><td>{t.entry}</td><td>{t.exit ?? '持有中'}</td>
                  <td className={`text-right ${tone(t.ret)}`}>{pct(t.ret, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
