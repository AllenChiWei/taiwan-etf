/* 期貨對帳單分析。
 *
 * **對帳單不會離開這台裝置。** 這個網站是靜態的、沒有後端，檔案由瀏覽器自己讀、
 * 自己算（解析在 Web Worker 裡，理由見 workers/sheet.worker.ts），算完就丟掉 ——
 * 沒有上傳、沒有儲存、重新整理就沒了。這件事畫面上要講清楚，因為使用者交出來的
 * 是自己的完整交易紀錄。
 *
 * 計算全部在 lib/futures.ts，那裡是純函式而且有對真實檔案的測試。這裡只負責畫。
 */

import { useMemo, useRef, useState } from 'react';
import {
  parseSheet, stats, equityCurve, groupBy, byMonth, histogram, StatementError,
  type Trade, type Stats, type Group,
} from '../lib/futures';
import { readSheet } from '../lib/readSheet';
import { bars, linePoints, linePath, zeroY } from '../lib/chips';
import { TONE_CLASS } from '../lib/format';
import { EmptyState } from '../components/EmptyState';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });

const money = (v: number) => `${v >= 0 ? '+' : '−'}${nf0.format(Math.abs(v))}`;
const tone = (v: number) => TONE_CLASS[v > 0 ? 'up' : v < 0 ? 'down' : 'flat'];

type Tab = 'curve' | 'product' | 'month' | 'detail';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'curve', label: '損益曲線' },
  { id: 'product', label: '各商品' },
  { id: 'month', label: '月度' },
  { id: 'detail', label: '交易明細' },
];

function Section({ title, hint, children }: {
  title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-bold text-ink">{title}</h2>
        {hint && <span className="text-[11.5px] text-faint">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Cell({ label, value, cls, sub }: {
  label: string; value: string; cls?: string; sub?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-bg px-3 py-2">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-[16px] font-bold tabular-nums ${cls ?? 'text-ink'}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

function Chip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
            className={`h-8 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
              active ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}>
      {children}
    </button>
  );
}

/* ── 整體績效 ───────────────────────────────────────────── */

function Summary({ s }: { s: Stats }) {
  return (
    <>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="總損益" value={money(s.net)} cls={tone(s.net)}
              sub={`${s.n} 筆 · ${nf0.format(s.lots)} 口`} />
        <Cell label="勝率" value={`${nf1.format(s.winRate * 100)}%`}
              sub={`${s.nWin} 勝 ${s.nLoss} 敗`} />
        <Cell label="賠率" value={s.payoff === null ? '—' : nf2.format(s.payoff)}
              cls={s.payoff !== null && s.payoff >= 1 ? 'text-up' : 'text-down'}
              sub="平均獲利 ÷ 平均虧損" />
        <Cell label="期望值" value={money(s.expectancy)} cls={tone(s.expectancy)}
              sub="每筆平均" />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="獲利因子" value={s.profitFactor === null ? '—' : nf2.format(s.profitFactor)}
              cls={s.profitFactor !== null && s.profitFactor >= 1 ? 'text-up' : 'text-down'}
              sub="總獲利 ÷ 總虧損" />
        <Cell label="最大回撤" value={money(s.maxDrawdown)} cls="text-down"
              sub={`最大連敗 ${s.maxLossStreak} 筆`} />
        <Cell label="單筆最好／最差" value={money(s.best)} cls="text-up"
              sub={`最差 ${money(s.worst)}`} />
        <Cell label="成本" value={money(-(s.fee + s.tax))} cls="text-down"
              sub={s.costRatio === null
                ? `手續費 ${nf0.format(s.fee)} ＋ 稅 ${nf0.format(s.tax)}`
                : `吃掉毛利的 ${nf1.format(s.costRatio * 100)}%`} />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        賠率與獲利因子都是「越大越好、1 是損益兩平」。沒有虧損筆數時顯示「—」而不是
        ∞ —— 那種數字不能拿來比較。成本那一格是這份對帳單裡最容易被忽略的：
        當沖型的交易，手續費與期交稅常常吃掉毛利的一大半。
      </p>
    </>
  );
}

/* ── 損益曲線與分佈 ─────────────────────────────────────── */

const W = 320, H = 110;

function CurveTab({ trades }: { trades: Trade[] }) {
  const curve = useMemo(() => equityCurve(trades), [trades]);
  const values = curve.map(p => p.cum);
  const pts = linePoints(values, W, H);
  const z = zeroY(values, H);
  const hist = useMemo(() => histogram(trades, 21), [trades]);
  const hb = bars(hist.map(b => b.n), W, 70);

  return (
    <>
      <h3 className="mt-3 text-[12.5px] font-bold text-ink">累計損益</h3>
      <div className="mt-1 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full min-w-[280px]"
             preserveAspectRatio="none" role="img" aria-label="累計損益曲線">
          {z !== null && (
            <line x1="0" y1={z} x2={W} y2={z} className="stroke-line" strokeDasharray="3 3" />
          )}
          <path d={linePath(pts)} fill="none"
                className={values[values.length - 1] >= 0 ? 'stroke-up' : 'stroke-down'}
                strokeWidth="1.5" />
        </svg>
      </div>
      <p className="mt-1 text-[11px] text-faint">
        橫軸是第幾筆交易（不是日期）—— 對帳單只有結算日，同一天可能有幾十筆，
        照日期畫會把當沖的節奏壓扁。虛線是損益兩平。
      </p>

      <h3 className="mt-3 text-[12.5px] font-bold text-ink">單筆損益分佈</h3>
      <div className="mt-1 overflow-x-auto">
        <svg viewBox={`0 0 ${W} 70`} className="h-20 w-full min-w-[280px]"
             preserveAspectRatio="none" role="img" aria-label="單筆損益分佈">
          {hb.map((b, i) => (
            <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h}
                  className={hist[i].to <= 0 ? 'fill-down' : 'fill-up'} />
          ))}
        </svg>
      </div>
      <div className="flex justify-between font-mono text-[10.5px] tabular-nums text-faint">
        <span>{hist.length ? money(hist[0].from) : ''}</span>
        <span>{hist.length ? money(hist[hist.length - 1].to) : ''}</span>
      </div>
      <p className="mt-1 text-[11px] text-faint">
        每一格是一個損益區間，高度是落在那個區間的筆數。右邊拖得很長代表少數幾筆
        大賺撐起整體績效，那種分佈對心理素質的要求跟平均分佈完全不同。
      </p>
    </>
  );
}

/* ── 分組表 ─────────────────────────────────────────────── */

function GroupTable({ groups, label }: { groups: Group[]; label: string }) {
  const peak = Math.max(1, ...groups.map(g => Math.abs(g.stats.net)));
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[340px] text-[12px]">
        <thead>
          <tr className="text-left text-[11px] text-faint">
            <th className="py-1 pr-2 font-medium">{label}</th>
            <th className="py-1 pr-2 text-right font-medium">筆數</th>
            <th className="py-1 pr-2 text-right font-medium">勝率</th>
            <th className="py-1 text-right font-medium">損益</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <tr key={g.key} className="border-t border-line/60">
              <td className="py-1.5 pr-2">
                <span className="text-ink">{g.key}</span>
                <span className="mt-1 block h-1 max-w-[130px] rounded-full bg-sunken">
                  <span className={`block h-full rounded-full ${
                    g.stats.net >= 0 ? 'bg-up' : 'bg-down'}`}
                        style={{ width: `${Math.max(2, (Math.abs(g.stats.net) / peak) * 100)}%` }} />
                </span>
              </td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted">
                {g.stats.n}
              </td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted">
                {nf0.format(g.stats.winRate * 100)}%
              </td>
              <td className={`py-1.5 text-right font-mono font-semibold tabular-nums ${
                tone(g.stats.net)}`}>
                {money(g.stats.net)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── 月度 ───────────────────────────────────────────────── */

function MonthTab({ trades }: { trades: Trade[] }) {
  const months = useMemo(() => byMonth(trades), [trades]);
  const vals = months.map(m => m.stats.net);
  const mb = bars(vals, W, 90);
  const z = zeroY(vals, 90);
  return (
    <>
      <div className="mt-3 overflow-x-auto">
        <svg viewBox={`0 0 ${W} 90`} className="h-24 w-full min-w-[280px]"
             preserveAspectRatio="none" role="img" aria-label="每月損益">
          {z !== null && (
            <line x1="0" y1={z} x2={W} y2={z} className="stroke-line" strokeDasharray="3 3" />
          )}
          {mb.map((b, i) => (
            <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h}
                  className={vals[i] >= 0 ? 'fill-up' : 'fill-down'} />
          ))}
        </svg>
      </div>
      <GroupTable groups={months} label="月份" />
    </>
  );
}

/* ── 交易明細 ───────────────────────────────────────────── */

const PAGE = 50;

function DetailTab({ trades }: { trades: Trade[] }) {
  const [shown, setShown] = useState(PAGE);
  const rows = trades.slice(0, shown);
  return (
    <>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[420px] text-[12px]">
          <thead>
            <tr className="text-left text-[11px] text-faint">
              <th className="py-1 pr-2 font-medium">結算日</th>
              <th className="py-1 pr-2 font-medium">商品</th>
              <th className="py-1 pr-2 text-right font-medium">口</th>
              <th className="py-1 pr-2 text-right font-medium">進／出</th>
              <th className="py-1 text-right font-medium">損益</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={`${t.date}-${i}`} className="border-t border-line/60">
                <td className="py-1 pr-2 font-mono tabular-nums text-muted">{t.date.slice(5)}</td>
                <td className="py-1 pr-2">
                  <span className="text-ink">{t.product}</span>
                  <span className={`ml-1 text-[10.5px] ${
                    t.side === '多' ? 'text-up' : 'text-down'}`}>{t.side}</span>
                </td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums text-muted">{t.lots}</td>
                <td className="py-1 pr-2 text-right font-mono text-[11px] tabular-nums text-faint">
                  {nf2.format(t.openPrice)}／{t.closePrice ? nf2.format(t.closePrice) : '未平'}
                </td>
                <td className={`py-1 text-right font-mono font-semibold tabular-nums ${tone(t.net)}`}>
                  {money(t.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown < trades.length && (
        <button type="button" onClick={() => setShown(s => s + PAGE * 4)}
                className="mt-2 h-9 w-full rounded-lg bg-sunken text-[12.5px] font-semibold text-muted hover:text-ink">
          再顯示 {Math.min(PAGE * 4, trades.length - shown)} 筆（共 {trades.length} 筆）
        </button>
      )}
    </>
  );
}

/* ── 頁面 ───────────────────────────────────────────────── */

export function FuturesPage() {
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [tab, setTab] = useState<Tab>('curve');
  const input = useRef<HTMLInputElement>(null);

  const s = useMemo(() => (trades ? stats(trades) : null), [trades]);
  const products = useMemo(
    () => (trades ? groupBy(trades, t => t.base) : []), [trades]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const rows = await readSheet(file);
      setTrades(parseSheet(rows));
      setName(file.name);
      setTab('curve');
    } catch (e) {
      setTrades(null);
      setError(e instanceof StatementError || e instanceof Error
        ? e.message : '讀不懂這個檔案');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="sr-only">期貨對帳單分析</h1>

      <section className="mt-4 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <h2 className="text-sm font-bold text-ink">期貨對帳單分析</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          丟進元大期貨的「已實現損益」檔案，算出勝率、賠率、期望值、最大連敗與
          成本佔比。<strong className="text-ink">檔案不會離開這台裝置</strong> ——
          這個網站沒有後端，解析與計算都在你的瀏覽器裡跑完，關掉分頁就沒了。
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept=".xls,.xlsx,.csv,.txt"
                 className="hidden"
                 onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
                  className="h-10 rounded-lg bg-accent px-4 text-[13px] font-semibold text-accent-ink disabled:opacity-60">
            {busy ? '讀取中…' : trades ? '換一份對帳單' : '選擇對帳單檔案'}
          </button>
          {name && <span className="text-[11.5px] text-faint">{name}</span>}
        </div>

        {error && (
          <p className="mt-2 rounded-lg bg-sunken px-3 py-2 text-[12px] leading-relaxed text-down">
            {error}
          </p>
        )}

        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          支援 .xls／.xlsx／.csv。
          <strong className="text-muted">能匯出 CSV 的話建議用 CSV</strong> ——
          讀 .xls 需要一個第三方解析器（它有兩個沒有修補版本的已知問題），
          所以那段跑在獨立的 Web Worker 裡隔離起來；CSV 則完全不經過它。
        </p>
      </section>

      {!trades && !busy && !error && (
        <EmptyState title="還沒有對帳單"
                    hint="元大期貨 e 櫃台 → 帳務查詢 → 已實現損益 → 匯出。"
                    icon="📄" />
      )}

      {trades && s && (
        <>
          <Section title="整體績效" hint={`${trades[0]?.date} ～ ${trades[trades.length - 1]?.date}`}>
            <Summary s={s} />
          </Section>

          <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
            <div className="flex flex-wrap gap-1.5">
              {TABS.map(t => (
                <Chip key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
                  {t.label}
                </Chip>
              ))}
            </div>

            {tab === 'curve' && <CurveTab trades={trades} />}
            {tab === 'product' && <GroupTable groups={products} label="商品" />}
            {tab === 'month' && <MonthTab trades={trades} />}
            {tab === 'detail' && <DetailTab trades={trades} />}
          </section>
        </>
      )}

      <p className="mt-4 mb-2 text-[11.5px] leading-relaxed text-faint">
        數字全部來自你提供的對帳單，本頁只做整理與統計，不構成投資建議。
        歷史績效不代表未來報酬。
      </p>
    </>
  );
}
