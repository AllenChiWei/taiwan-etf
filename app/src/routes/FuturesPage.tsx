/* 期貨對帳單分析。
 *
 * **對帳單不會離開這台裝置。** 這個網站是靜態的、沒有後端，檔案由瀏覽器自己讀、
 * 自己算（解析在 Web Worker 裡，理由見 workers/sheet.worker.ts），算完就丟掉 ——
 * 沒有上傳、重新整理就沒了。唯一記在這台裝置上的是偏好：選擇權賣方的價格區間，
 * 以及手動改過分類的那幾列的「雜湊」（不含金額，見 lib/storage.ts）。
 *
 * 交易分三種方式：程式交易（只有小台指、小電子）、選擇權（台指選擇權，再分賣方
 * 策略與避險）、主觀交易（其餘，多半是個股期貨）。不同月份的合約視為同一商品。
 *
 * 計算全部在 lib/futures.ts，那裡是純函式而且有對真實檔案的測試。這裡只負責畫。
 */

import { useMemo, useRef, useState } from 'react';
import {
  parseSheet, stats, groupBy, byYear, monthMatrix, histogram, dailyCurves,
  mergeTrades, classifyOptions, optionMetrics, StatementError,
  STRATEGIES, STRATEGY_LABEL, OPT_KIND_LABEL, DEFAULT_OPTION_RULE,
  type Trade, type Stats, type Group, type Strategy, type OptKind,
} from '../lib/futures';
import { readSheet } from '../lib/readSheet';
import { bars } from '../lib/chips';
import { TONE_CLASS } from '../lib/format';
import { loadFuturesPrefs, saveFuturesPrefs, type FuturesPrefs } from '../lib/storage';
import { EmptyState } from '../components/EmptyState';
import { PnlChart, type PnlLine } from '../components/PnlChart';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });

const money = (v: number) => `${v >= 0 ? '+' : '−'}${nf0.format(Math.abs(v))}`;
const tone = (v: number) => TONE_CLASS[v > 0 ? 'up' : v < 0 ? 'down' : 'flat'];
/** 月績效格子：一律用萬，欄寬才對得齊；不到 1 萬的多給一位小數，免得變成「+0萬」。 */
const wan = (v: number) =>
  `${v >= 0 ? '+' : '−'}${(Math.abs(v) < 10000 ? nf2 : nf1).format(Math.abs(v) / 10000)}萬`;
const ratio = (v: number | null) => (v === null ? '—' : nf2.format(v));
const ratioTone = (v: number | null) => (v === null ? 'text-muted' : v >= 1 ? 'text-up' : 'text-down');

/* 線的顏色。避開紅綠（台股語境的漲跌），合計用墨色。 */
const COLOR = {
  all: 'var(--c-ink)',
  程式: '#1f6feb',
  主觀: '#e06c00',
  選擇權: '#7b4fd6',
  賣方: '#0f9b8e',
  避險: '#c2185b',
} as const;

/** 篩選：全部、某一種交易方式、或選擇權底下的賣方／避險。 */
type Pick = 'all' | Strategy | OptKind;

const PICK_LABEL = (p: Pick) =>
  p === 'all' ? '全部' : p === '賣方' || p === '避險' ? OPT_KIND_LABEL[p] : STRATEGY_LABEL[p];

function matches(t: Trade, p: Pick): boolean {
  if (p === 'all') return true;
  if (p === '賣方' || p === '避險') return t.optKind === p;
  return t.strategy === p;
}

type Tab = 'product' | 'hold' | 'dist' | 'detail';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'product', label: '各商品' },
  { id: 'hold', label: '當沖／留倉' },
  { id: 'dist', label: '單筆分佈' },
  { id: 'detail', label: '交易明細' },
];

function Section({ title, hint, children }: {
  title: string; hint?: React.ReactNode; children: React.ReactNode;
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

function Chip({ active, onClick, children, small }: {
  active: boolean; onClick: () => void; children: React.ReactNode; small?: boolean;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
            className={`${small ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[12.5px]'} shrink-0 rounded-lg font-semibold transition-colors ${
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
              sub={`${s.n} 筆 · ${nf0.format(s.lots)} 口 · ${s.days} 天`} />
        <Cell label="勝率" value={`${nf1.format(s.winRate * 100)}%`}
              sub={`${s.nWin} 勝 ${s.nLoss} 敗 · 賺錢日 ${nf0.format(s.dayWinRate * 100)}%`} />
        <Cell label="賠率" value={ratio(s.payoff)} cls={ratioTone(s.payoff)}
              sub={`均賺 ${nf0.format(s.avgWin)} ÷ 均賠 ${nf0.format(Math.abs(s.avgLoss))}`} />
        <Cell label="獲利因子" value={ratio(s.profitFactor)} cls={ratioTone(s.profitFactor)}
              sub="總獲利 ÷ 總虧損" />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="期望值" value={money(s.expectancy)} cls={tone(s.expectancy)}
              sub="每筆平均" />
        <Cell label="最大回撤" value={money(s.maxDrawdown)} cls="text-down"
              sub={`報酬回撤比 ${ratio(s.recovery)} · 最大連敗 ${s.maxLossStreak} 筆`} />
        <Cell label="單筆最好／最差" value={money(s.best)} cls="text-up"
              sub={`最差 ${money(s.worst)}`} />
        <Cell label="成本" value={money(-(s.fee + s.tax))} cls="text-down"
              sub={s.costRatio === null
                ? `手續費 ${nf0.format(s.fee)} ＋ 稅 ${nf0.format(s.tax)}`
                : `吃掉毛利的 ${nf1.format(s.costRatio * 100)}%`} />
      </div>
    </>
  );
}

/* ── 績效比較表（三種交易方式、各年度共用） ─────────────── */

interface Row { key: string; label: string; s: Stats; indent?: boolean; bold?: boolean; color?: string }

function StatsTable({ rows, first, onPick, active }: {
  rows: Row[]; first: string; onPick?: (key: string) => void; active?: string;
}) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[640px] text-[12px]">
        <thead>
          <tr className="text-left text-[11px] text-faint">
            <th className="py-1 pr-2 font-medium">{first}</th>
            <th className="py-1 pr-2 text-right font-medium">損益</th>
            <th className="py-1 pr-2 text-right font-medium">筆數</th>
            <th className="py-1 pr-2 text-right font-medium">勝率</th>
            <th className="py-1 pr-2 text-right font-medium">賠率</th>
            <th className="py-1 pr-2 text-right font-medium">獲利因子</th>
            <th className="py-1 pr-2 text-right font-medium">期望值</th>
            <th className="py-1 pr-2 text-right font-medium">最大回撤</th>
            <th className="py-1 text-right font-medium">報酬回撤比</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}
                onClick={onPick ? () => onPick(r.key) : undefined}
                className={`border-t border-line/60 ${onPick ? 'cursor-pointer hover:bg-hover' : ''} ${
                  active === r.key ? 'bg-accent-soft' : ''}`}>
              <td className={`py-1.5 pr-2 ${r.indent ? 'pl-4' : ''}`}>
                {r.color && (
                  <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ background: r.color }} />
                )}
                <span className={r.bold ? 'font-bold text-ink' : 'text-ink'}>
                  {r.indent ? '└ ' : ''}{r.label}
                </span>
              </td>
              <td className={`py-1.5 pr-2 text-right font-mono tabular-nums ${tone(r.s.net)}`}>
                {money(r.s.net)}
              </td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted">{r.s.n}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-ink">
                {r.s.n ? `${nf1.format(r.s.winRate * 100)}%` : '—'}
              </td>
              <td className={`py-1.5 pr-2 text-right font-mono tabular-nums ${ratioTone(r.s.payoff)}`}>
                {ratio(r.s.payoff)}
              </td>
              <td className={`py-1.5 pr-2 text-right font-mono tabular-nums ${ratioTone(r.s.profitFactor)}`}>
                {ratio(r.s.profitFactor)}
              </td>
              <td className={`py-1.5 pr-2 text-right font-mono tabular-nums ${tone(r.s.expectancy)}`}>
                {r.s.n ? money(r.s.expectancy) : '—'}
              </td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-down">
                {r.s.n ? money(r.s.maxDrawdown) : '—'}
              </td>
              <td className={`py-1.5 text-right font-mono tabular-nums ${ratioTone(r.s.recovery)}`}>
                {ratio(r.s.recovery)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function strategyRows(trades: Trade[]): Row[] {
  const rows: Row[] = [{ key: 'all', label: '合計', s: stats(trades), bold: true, color: COLOR.all }];
  for (const st of STRATEGIES) {
    const ts = trades.filter(t => t.strategy === st);
    if (!ts.length) continue;
    rows.push({ key: st, label: STRATEGY_LABEL[st], s: stats(ts), color: COLOR[st] });
    if (st === '選擇權') {
      for (const k of ['賣方', '避險'] as const) {
        const ks = ts.filter(t => t.optKind === k);
        if (ks.length) rows.push({ key: k, label: OPT_KIND_LABEL[k], s: stats(ks), indent: true, color: COLOR[k] });
      }
    }
  }
  return rows;
}

/* ── 月績效 ─────────────────────────────────────────────── */

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function MonthGrid({ trades, note = true }: { trades: Trade[]; note?: boolean }) {
  const rows = useMemo(() => monthMatrix(trades), [trades]);
  const peak = Math.max(1, ...rows.flatMap(r => r.months.map(v => Math.abs(v ?? 0))));
  const all = rows.flatMap(r => r.months).filter((v): v is number => v !== null);
  const up = all.filter(v => v > 0).length;
  return (
    <>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[860px] table-fixed whitespace-nowrap text-[11.5px]">
          <thead>
            <tr className="text-[11px] text-faint">
              <th className="w-12 py-1 text-left font-medium">年</th>
              {MONTHS.map(m => <th key={m} className="py-1 text-right font-medium">{m}</th>)}
              <th className="w-[84px] py-1 text-right font-medium">全年</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.year} className="border-t border-line/60">
                <td className="py-1 font-mono text-muted">{r.year}</td>
                {r.months.map((v, i) => (
                  <td key={i} className="p-0.5">
                    {v === null ? (
                      <div className="py-1 text-right text-faint">·</div>
                    ) : (
                      <div className={`rounded px-1 py-1 text-right font-mono tabular-nums ${tone(v)}`}
                           style={{
                             background: `color-mix(in srgb, var(${v >= 0 ? '--c-up' : '--c-down'}) ${
                               Math.round(6 + (Math.abs(v) / peak) * 26)}%, transparent)`,
                           }}
                           title={`${r.year}-${String(i + 1).padStart(2, '0')}：${money(v)}`}>
                        {wan(v)}
                      </div>
                    )}
                  </td>
                ))}
                <td className={`py-1 pl-1 text-right font-mono font-bold tabular-nums ${tone(r.total)}`}>
                  {money(r.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p className="mt-1.5 text-[11px] text-faint">
        依結算日歸月。有交易的 {all.length} 個月裡 {up} 個月賺錢
        （{all.length ? nf0.format((up / all.length) * 100) : 0}%）；「·」是那個月沒有交易。
      </p>}
    </>
  );
}

/* ── 分組表 ─────────────────────────────────────────────── */

function GroupTable({ groups, label }: { groups: Group[]; label: string }) {
  const peak = Math.max(1, ...groups.map(g => Math.abs(g.stats.net)));
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[460px] text-[12px]">
        <thead>
          <tr className="text-left text-[11px] text-faint">
            <th className="py-1 pr-2 font-medium">{label}</th>
            <th className="py-1 pr-2 text-right font-medium">筆數</th>
            <th className="py-1 pr-2 text-right font-medium">勝率</th>
            <th className="py-1 pr-2 text-right font-medium">賠率</th>
            <th className="py-1 pr-2 text-right font-medium">獲利因子</th>
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
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted">{g.stats.n}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted">
                {nf0.format(g.stats.winRate * 100)}%
              </td>
              <td className={`py-1.5 pr-2 text-right font-mono tabular-nums ${ratioTone(g.stats.payoff)}`}>
                {ratio(g.stats.payoff)}
              </td>
              <td className={`py-1.5 pr-2 text-right font-mono tabular-nums ${ratioTone(g.stats.profitFactor)}`}>
                {ratio(g.stats.profitFactor)}
              </td>
              <td className={`py-1.5 text-right font-mono font-semibold tabular-nums ${tone(g.stats.net)}`}>
                {money(g.stats.net)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── 單筆分佈 ───────────────────────────────────────────── */

const W = 320;

function DistTab({ trades }: { trades: Trade[] }) {
  const hist = useMemo(() => histogram(trades, 21), [trades]);
  const hb = bars(hist.map(b => b.n), W, 70);
  return (
    <>
      <div className="mt-3 overflow-x-auto">
        <svg viewBox={`0 0 ${W} 70`} className="h-24 w-full min-w-[280px]"
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
        大賺撐起整體績效；賣方策略通常相反 —— 很多小賺、左邊有幾筆大賠。
      </p>
    </>
  );
}

/* ── 交易明細 ───────────────────────────────────────────── */

const PAGE = 50;

function DetailTab({ trades, onToggle }: {
  trades: Trade[]; onToggle: (t: Trade) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const [onlyGuess, setOnlyGuess] = useState(false);
  const list = useMemo(() => {
    const l = onlyGuess ? trades.filter(t => t.optGuess) : trades;
    return [...l].reverse();               // 新的在上面
  }, [trades, onlyGuess]);
  const rows = list.slice(0, shown);
  const nGuess = trades.filter(t => t.optGuess).length;
  return (
    <>
      {nGuess > 0 && (
        <label className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" checked={onlyGuess} onChange={e => { setOnlyGuess(e.target.checked); setShown(PAGE); }} />
          只看推定分類的選擇權（{nGuess} 筆）—— 點「賣方／避險」標籤可以改
        </label>
      )}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[520px] text-[12px]">
          <thead>
            <tr className="text-left text-[11px] text-faint">
              <th className="py-1 pr-2 font-medium">結算日</th>
              <th className="py-1 pr-2 font-medium">商品</th>
              <th className="py-1 pr-2 text-right font-medium">口</th>
              <th className="py-1 pr-2 text-right font-medium">開／平</th>
              <th className="py-1 text-right font-medium">損益</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(t => (
              <tr key={t.id} className="border-t border-line/60">
                <td className="py-1 pr-2 font-mono tabular-nums text-muted">{t.date}</td>
                <td className="py-1 pr-2">
                  <span className="text-ink">{t.product}</span>
                  <span className={`ml-1 text-[10.5px] ${t.side === '多' ? 'text-up' : 'text-down'}`}
                        title={t.sideKnown ? '' : '同一天買賣、檔案沒有時間，方向是推定的'}>
                    {t.side}{t.sideKnown ? '' : '?'}
                  </span>
                  {t.dayTrade && <span className="ml-1 text-[10.5px] text-faint">當沖</span>}
                  {t.optKind && (
                    <button type="button" onClick={() => onToggle(t)}
                            title="點一下改成另一類（記在這台裝置）"
                            className="ml-1.5 rounded px-1.5 py-px text-[10.5px] font-semibold text-white"
                            style={{ background: COLOR[t.optKind] }}>
                      {t.optKind}{t.optGuess ? '?' : ''}
                    </button>
                  )}
                  {t.note && <span className="block text-[10.5px] text-faint">{t.note}</span>}
                </td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums text-muted">{t.lots}</td>
                <td className="py-1 pr-2 text-right font-mono text-[11px] tabular-nums text-faint">
                  {nf2.format(t.openPrice)}／{t.closePrice ? nf2.format(t.closePrice) : '結算'}
                </td>
                <td className={`py-1 text-right font-mono font-semibold tabular-nums ${tone(t.net)}`}>
                  {money(t.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown < list.length && (
        <button type="button" onClick={() => setShown(s => s + PAGE * 4)}
                className="mt-2 h-9 w-full rounded-lg bg-sunken text-[12.5px] font-semibold text-muted hover:text-ink">
          再顯示 {Math.min(PAGE * 4, list.length - shown)} 筆（共 {list.length} 筆）
        </button>
      )}
    </>
  );
}

/* ── 選擇權：賣方策略 vs 避險 ──────────────────────────── */

const pct = (v: number | null) => (v === null ? '—' : `${nf0.format(v * 100)}%`);

function KindCard({ kind, trades }: { kind: OptKind; trades: Trade[] }) {
  const s = stats(trades);
  const m = optionMetrics(trades);
  const guess = trades.filter(t => t.optGuess).length;
  const common: Array<[string, string, string?]> = [
    ['勝率', `${nf1.format(s.winRate * 100)}%`, `${s.nWin} 勝 ${s.nLoss} 敗`],
    ['賠率', ratio(s.payoff), `均賺 ${nf0.format(s.avgWin)}／均賠 ${nf0.format(Math.abs(s.avgLoss))}`],
    ['獲利因子', ratio(s.profitFactor)],
  ];
  const lines: Array<[string, string, string?]> = kind === '賣方'
    ? [
        ...common,
        ['平均賣價', `${nf1.format(m.avgPrice)} 點`, `${nf0.format(s.lots)} 口`],
        ['收進權利金', nf0.format(m.premium)],
        ['權利金留下', pct(m.keepRate), '合計損益 ÷ 收進的權利金'],
        ['放到結算', `${m.settled} 筆`, m.settled ? `其中 ${m.settledWin} 筆賺錢` : undefined],
        ['一次大賠＝幾次小賺', m.tailRatio === null ? '—' : `${nf1.format(m.tailRatio)} 次`,
          `最大單筆 ${money(s.worst)}`],
        ['最大回撤', money(s.maxDrawdown)],
      ]
    : [
        ...common,
        ['平均買價', `${nf1.format(m.avgPrice)} 點`, `${nf0.format(s.lots)} 口`],
        ['付出權利金', nf0.format(m.premium)],
        ['收回比例', pct(m.recoverRate), '(付出 ＋ 平倉損益) ÷ 付出'],
        ['放到結算', `${m.settled} 筆`, m.settled ? `其中 ${m.settledWin} 筆有價值` : undefined],
        ['最大單筆獲利', money(s.best), '保險真正理賠的那一次'],
        ['平均每月成本', money(m.perMonth), `有交易的 ${m.months} 個月`],
      ];
  return (
    <div className="rounded-lg border border-line bg-bg p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: COLOR[kind] }} />
          {OPT_KIND_LABEL[kind]}
        </h3>
        <span className={`font-mono text-[16px] font-bold tabular-nums ${tone(s.net)}`}>{money(s.net)}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-faint">
        {s.n} 筆{guess > 0 && `（其中 ${guess} 筆是推定的）`}
      </div>
      {s.n === 0 ? (
        <p className="mt-2 text-[12px] text-muted">這段期間沒有這一類的交易。</p>
      ) : (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          {lines.map(([k, v, sub]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right">
                <span className="font-mono font-semibold tabular-nums text-ink">{v}</span>
                {sub && <span className="block text-[10.5px] text-faint">{sub}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function OptionCompare({ inPeriod, all, periodLabel }: {
  inPeriod: Trade[]; all: Trade[]; periodLabel: string;
}) {
  const optsAll = useMemo(() => all.filter(t => t.strategy === '選擇權'), [all]);
  const opts = useMemo(() => inPeriod.filter(t => t.strategy === '選擇權'), [inPeriod]);

  const years = useMemo(() => byYear(optsAll).map(g => ({
    year: g.key,
    total: g.stats.net,
    s: stats(g.trades.filter(t => t.optKind === '賣方')),
    h: stats(g.trades.filter(t => t.optKind === '避險')),
  })), [optsAll]);

  // 賣方與避險各自再拆買權／賣權：賣 Call 跟賣 Put 的風險完全不同
  const cpGroups = useMemo(() => groupBy(opts, t =>
    `${OPT_KIND_LABEL[t.optKind ?? '避險']}・${t.cp === 'C' ? '買權 Call' : '賣權 Put'}`)
    .sort((a, b) => (a.key < b.key ? -1 : 1)), [opts]);

  if (!optsAll.length) return null;
  return (
    <Section title="選擇權：賣方策略 vs 避險" hint={periodLabel}>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <KindCard kind="賣方" trades={opts.filter(t => t.optKind === '賣方')} />
        <KindCard kind="避險" trades={opts.filter(t => t.optKind === '避險')} />
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
        兩種要用不同的尺看：賣方策略勝率高、賠率低是正常的，重點是「權利金留下幾成」與
        「一次大賠要幾次小賺才補得回來」；避險本來就預期大多數會賠掉權利金，重點是
        「每月花多少」與「真正出事那一次賺回多少」。
      </p>

      <h3 className="mt-3 text-[12.5px] font-bold text-ink">各年度（不受期間篩選影響）</h3>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[620px] text-[12px]">
          <thead>
            <tr className="text-right text-[11px] text-faint">
              <th className="py-1 pr-2 text-left font-medium">年度</th>
              <th className="py-1 pr-2 font-medium" style={{ color: COLOR.賣方 }}>賣方損益</th>
              <th className="py-1 pr-2 font-medium">勝率</th>
              <th className="py-1 pr-2 font-medium">獲利因子</th>
              <th className="py-1 pr-2 font-medium" style={{ color: COLOR.避險 }}>避險損益</th>
              <th className="py-1 pr-2 font-medium">勝率</th>
              <th className="py-1 pr-2 font-medium">獲利因子</th>
              <th className="py-1 font-medium">選擇權合計</th>
            </tr>
          </thead>
          <tbody>
            {years.map(y => (
              <tr key={y.year} className="border-t border-line/60 text-right font-mono tabular-nums">
                <td className="py-1.5 pr-2 text-left text-muted">{y.year}</td>
                <td className={`py-1.5 pr-2 ${tone(y.s.net)}`}>{y.s.n ? money(y.s.net) : '—'}</td>
                <td className="py-1.5 pr-2 text-muted">{y.s.n ? `${nf0.format(y.s.winRate * 100)}%` : '—'}</td>
                <td className={`py-1.5 pr-2 ${ratioTone(y.s.profitFactor)}`}>{ratio(y.s.profitFactor)}</td>
                <td className={`py-1.5 pr-2 ${tone(y.h.net)}`}>{y.h.n ? money(y.h.net) : '—'}</td>
                <td className="py-1.5 pr-2 text-muted">{y.h.n ? `${nf0.format(y.h.winRate * 100)}%` : '—'}</td>
                <td className={`py-1.5 pr-2 ${ratioTone(y.h.profitFactor)}`}>{ratio(y.h.profitFactor)}</td>
                <td className={`py-1.5 font-semibold ${tone(y.total)}`}>{money(y.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-3 text-[12.5px] font-bold" style={{ color: COLOR.賣方 }}>賣方策略・月績效</h3>
      <MonthGrid trades={optsAll.filter(t => t.optKind === '賣方')} note={false} />
      <h3 className="mt-3 text-[12.5px] font-bold" style={{ color: COLOR.避險 }}>避險・月績效</h3>
      <MonthGrid trades={optsAll.filter(t => t.optKind === '避險')} note={false} />

      {opts.length > 0 && (
        <>
          <h3 className="mt-3 text-[12.5px] font-bold text-ink">買權 Call／賣權 Put</h3>
          <GroupTable groups={cpGroups} label="分類" />
        </>
      )}
    </Section>
  );
}

/* ── 選擇權分類設定 ─────────────────────────────────────── */

function OptionPanel({ trades, prefs, setPrefs }: {
  trades: Trade[]; prefs: FuturesPrefs; setPrefs: (p: FuturesPrefs) => void;
}) {
  const opts = trades.filter(t => t.strategy === '選擇權');
  const known = opts.filter(t => !t.optGuess).length;
  const guess = opts.length - known;
  const nManual = opts.filter(t => prefs.overrides[t.id]).length;
  const num = (v: string, fb: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fb;
  };
  return (
    <Section title="選擇權：賣方策略與避險怎麼分" hint={`${opts.length} 筆台指選擇權`}>
      <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-muted">
        <li>
          <strong className="text-ink">方向分得出來的 {known} 筆</strong>：先賣出開倉 → 賣方策略；
          先買進開倉 → 避險。不看價格，因為你也會買 15 點左右的選擇權避險。
        </li>
        <li>
          <strong className="text-ink">同一天買賣的 {guess} 筆</strong>：元大的檔案每一列固定
          「買在前、賣在後」又沒有時間，分不出哪邊先。賣價落在
          <input type="number" inputMode="decimal" value={prefs.sellMin} min={0}
                 onChange={e => setPrefs({ ...prefs, sellMin: num(e.target.value, prefs.sellMin) })}
                 className="mx-1 h-7 w-14 rounded border border-line bg-bg px-1 text-center font-mono text-ink" />
          ～
          <input type="number" inputMode="decimal" value={prefs.sellMax} min={0}
                 onChange={e => setPrefs({ ...prefs, sellMax: num(e.target.value, prefs.sellMax) })}
                 className="mx-1 h-7 w-14 rounded border border-line bg-bg px-1 text-center font-mono text-ink" />
          點的推定為賣方，其餘推定為避險，在明細裡標「?」。
        </li>
        <li>
          推定錯了可以在「交易明細」點那一列的標籤改掉{nManual > 0 && `（目前改了 ${nManual} 筆，`}
          {nManual > 0 && (
            <button type="button" className="text-accent underline"
                    onClick={() => setPrefs({ ...prefs, overrides: {} })}>全部還原</button>
          )}
          {nManual > 0 && '）'}。
        </li>
      </ol>
      {guess > 0 && (
        <p className="mt-2 rounded-lg bg-sunken px-3 py-2 text-[11.5px] leading-relaxed text-muted">
          <strong className="text-ink">想要完全準確：</strong>元大 EasyWin 有一種已實現損益的匯出
          （檔名 EX0659）買、賣兩邊都有「時間」欄位，這頁也讀得懂 —— 用那一種匯出，
          同一天的單也能判斷先後，就不需要推定。
        </p>
      )}
    </Section>
  );
}

/* ── 頁面 ───────────────────────────────────────────────── */

interface Loaded { name: string; n: number; trades: Trade[] }

export function FuturesPage() {
  const [files, setFiles] = useState<Loaded[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState('all');
  const [pickKey, setPickKey] = useState<Pick>('all');
  const [tab, setTab] = useState<Tab>('product');
  const [drawdown, setDrawdown] = useState(false);
  const [prefs, setPrefsState] = useState<FuturesPrefs>(
    () => loadFuturesPrefs({ ...DEFAULT_OPTION_RULE, overrides: {} }));
  const input = useRef<HTMLInputElement>(null);

  function setPrefs(p: FuturesPrefs) {
    setPrefsState(p);
    saveFuturesPrefs(p);
  }

  const all = useMemo(
    () => classifyOptions(mergeTrades(files.map(f => f.trades)), prefs),
    [files, prefs]);
  const years = useMemo(() => [...new Set(all.map(t => t.year))].sort(), [all]);
  const inPeriod = useMemo(
    () => (period === 'all' ? all : all.filter(t => t.year === period)), [all, period]);
  const picked = useMemo(() => inPeriod.filter(t => matches(t, pickKey)), [inPeriod, pickKey]);
  const pickedAllYears = useMemo(() => all.filter(t => matches(t, pickKey)), [all, pickKey]);
  const s = useMemo(() => stats(picked), [picked]);

  const compareRows = useMemo(() => strategyRows(inPeriod), [inPeriod]);
  const yearRows = useMemo<Row[]>(() => byYear(pickedAllYears).map(g => ({
    key: g.key, label: g.key, s: g.stats,
  })), [pickedAllYears]);

  // 曲線：合計＋三種方式；選了選擇權（或它底下的分類）時改看選擇權與賣方、避險
  const curve = useMemo(() => {
    const optView = pickKey === '選擇權' || pickKey === '賣方' || pickKey === '避險';
    const groups: Array<{ key: string; label: string; color: string; bold?: boolean; trades: Trade[] }> = optView
      ? [
          { key: '選擇權', label: '選擇權合計', color: COLOR.選擇權, bold: true,
            trades: inPeriod.filter(t => t.strategy === '選擇權') },
          ...(['賣方', '避險'] as const).map(k => ({
            key: k, label: OPT_KIND_LABEL[k], color: COLOR[k], trades: inPeriod.filter(t => t.optKind === k),
          })),
        ]
      : [
          { key: 'all', label: '合計', color: COLOR.all, bold: true, trades: inPeriod },
          ...STRATEGIES.map(st => ({
            key: st, label: STRATEGY_LABEL[st], color: COLOR[st],
            trades: inPeriod.filter(t => t.strategy === st),
          })),
        ];
    const used = groups.filter(g => g.trades.length);
    const d = dailyCurves(used);
    const lines: PnlLine[] = used.map((g, i) => ({
      key: g.key, label: g.label, color: g.color, bold: g.bold, values: d.series[i].values,
    }));
    return { dates: d.dates, lines, optView };
  }, [inPeriod, pickKey]);

  const products = useMemo(() => groupBy(picked, t => t.base), [picked]);
  const holds = useMemo(() => groupBy(picked, t => (t.dayTrade ? '當沖（同一天開平倉）' : '留倉')), [picked]);
  const hasOptions = all.some(t => t.strategy === '選擇權');

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setError('');
    const added: Loaded[] = [];
    const errors: string[] = [];
    for (const file of Array.from(list)) {
      try {
        const trades = parseSheet(await readSheet(file));
        added.push({ name: file.name, n: trades.length, trades });
      } catch (e) {
        errors.push(`${file.name}：${e instanceof StatementError || e instanceof Error
          ? e.message : '讀不懂這個檔案'}`);
      }
    }
    if (added.length) {
      setFiles(prev => [...prev.filter(p => !added.some(a => a.name === p.name)), ...added]);
      setPeriod('all');
    }
    setError(errors.join('\n'));
    setBusy(false);
  }

  function toggle(t: Trade) {
    if (!t.optKind) return;
    const next: OptKind = t.optKind === '賣方' ? '避險' : '賣方';
    setPrefs({ ...prefs, overrides: { ...prefs.overrides, [t.id]: next } });
  }

  const totalRaw = files.reduce((n, f) => n + f.n, 0);
  const pickOptions: Pick[] = ['all', ...STRATEGIES.filter(st => all.some(t => t.strategy === st))];

  return (
    <>
      <h1 className="sr-only">期貨對帳單分析</h1>

      <section className="mt-4 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <h2 className="text-sm font-bold text-ink">期貨對帳單分析</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          丟進元大期貨的「已實現損益」檔案，分成
          <strong className="text-ink">程式交易</strong>（小台指、小電子）、
          <strong className="text-ink">主觀交易</strong>（其他期貨，多半是個股期貨）與
          <strong className="text-ink">選擇權</strong>（台指選擇權，再分賣方策略與避險）
          三種方式，各自算年度、月份績效、勝率、賠率與獲利因子。不同月份的合約視為同一個商品。
          <strong className="text-ink">檔案不會離開這台裝置</strong> ——
          這個網站沒有後端，解析與計算都在你的瀏覽器裡跑完，關掉分頁就沒了。
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept=".xls,.xlsx,.csv,.txt" multiple
                 className="hidden"
                 onChange={e => { void pick(e.target.files); e.target.value = ''; }} />
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
                  className="h-10 rounded-lg bg-accent px-4 text-[13px] font-semibold text-accent-ink disabled:opacity-60">
            {busy ? '讀取中…' : files.length ? '再加一份對帳單' : '選擇對帳單檔案'}
          </button>
          {files.length > 0 && (
            <button type="button" onClick={() => { setFiles([]); setError(''); setPickKey('all'); }}
                    className="h-10 rounded-lg bg-sunken px-3 text-[12.5px] font-semibold text-muted hover:text-ink">
              全部清除
            </button>
          )}
        </div>

        {files.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5 text-[11.5px]">
            {files.map(f => (
              <li key={f.name} className="flex items-center gap-1 rounded-lg bg-sunken px-2 py-1 text-muted">
                <span className="text-ink">{f.name}</span>
                <span className="font-mono tabular-nums">{f.n} 筆</span>
                <button type="button" aria-label={`移除 ${f.name}`}
                        onClick={() => setFiles(prev => prev.filter(p => p.name !== f.name))}
                        className="ml-0.5 px-1 text-faint hover:text-ink">×</button>
              </li>
            ))}
            {files.length > 1 && totalRaw !== all.length && (
              <li className="px-1 py-1 text-faint">重疊的 {totalRaw - all.length} 筆只算一次</li>
            )}
          </ul>
        )}

        {error && (
          <p className="mt-2 whitespace-pre-line rounded-lg bg-sunken px-3 py-2 text-[12px] leading-relaxed text-down">
            {error}
          </p>
        )}

        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          支援 .xls／.xlsx／.csv，可以一次選好幾份（例如每年一份），期間重疊的部分只算一次。
          <strong className="text-muted">能匯出 CSV 的話建議用 CSV</strong> ——
          讀 .xls 需要一個第三方解析器，所以那段跑在獨立的 Web Worker 裡隔離起來；CSV 則完全不經過它。
        </p>
      </section>

      {!files.length && !busy && !error && (
        <EmptyState title="還沒有對帳單"
                    hint="元大期貨 EasyWin → 帳務查詢 → 已實現損益 → 匯出。"
                    icon="📄" />
      )}

      {all.length > 0 && (
        <>
          <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11.5px] text-faint">期間</span>
              <Chip active={period === 'all'} onClick={() => setPeriod('all')}>全部</Chip>
              {years.map(y => (
                <Chip key={y} active={period === y} onClick={() => setPeriod(y)}>{y}</Chip>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11.5px] text-faint">交易方式</span>
              {pickOptions.map(p => (
                <Chip key={p} active={pickKey === p || (p === '選擇權' && (pickKey === '賣方' || pickKey === '避險'))}
                      onClick={() => setPickKey(p)}>{PICK_LABEL(p)}</Chip>
              ))}
            </div>
            {(pickKey === '選擇權' || pickKey === '賣方' || pickKey === '避險') && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[4.2rem]">
                {(['選擇權', '賣方', '避險'] as const).map(p => (
                  <Chip key={p} small active={pickKey === p} onClick={() => setPickKey(p)}>
                    {p === '選擇權' ? '全部選擇權' : OPT_KIND_LABEL[p]}
                  </Chip>
                ))}
              </div>
            )}
          </section>

          <Section title="三種交易方式比較"
                   hint={period === 'all' ? `${all[0].date} ～ ${all[all.length - 1].date}` : `${period} 年`}>
            <StatsTable rows={compareRows} first="交易方式" active={pickKey}
                        onPick={k => setPickKey(k as Pick)} />
            <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
              點一列可以只看那一種。賠率＝平均獲利 ÷ 平均虧損；獲利因子＝總獲利 ÷ 總虧損；
              報酬回撤比＝總損益 ÷ 最大回撤。三個都是越大越好，獲利因子 1 是損益兩平。
              沒有虧損筆數時顯示「—」而不是 ∞ —— 那種數字不能拿來比較。
            </p>
          </Section>

          <Section title={curve.optView ? '選擇權累計損益' : '累計損益曲線'}
                   hint={(
                     <label className="flex items-center gap-1">
                       <input type="checkbox" checked={drawdown} onChange={e => setDrawdown(e.target.checked)} />
                       顯示回撤
                     </label>
                   )}>
            <PnlChart dates={curve.dates} lines={curve.lines} showDrawdown={drawdown} />
            <p className="mt-1 text-[11px] text-faint">
              橫軸是結算日，同一天的交易加在一起。{curve.optView
                ? '選擇權底下拆成賣方策略與避險兩條線，加起來等於選擇權合計。'
                : '三種方式加起來等於合計；選「選擇權」可以再拆成賣方策略與避險。'}
            </p>
          </Section>

          <Section title={`整體績效 · ${PICK_LABEL(pickKey)}`}
                   hint={period === 'all' ? '全部期間' : `${period} 年`}>
            {picked.length ? <Summary s={s} /> : (
              <p className="mt-2 text-[12px] text-muted">這段期間沒有這一類的交易。</p>
            )}
          </Section>

          <Section title={`年度績效 · ${PICK_LABEL(pickKey)}`} hint="不受上面的期間篩選影響">
            <StatsTable rows={yearRows} first="年度" />
          </Section>

          <Section title={`月績效 · ${PICK_LABEL(pickKey)}`} hint="合計損益（已扣手續費與稅）">
            <MonthGrid trades={pickedAllYears} />
          </Section>

          {hasOptions && (
            <OptionCompare inPeriod={inPeriod} all={all}
                           periodLabel={period === 'all' ? '全部期間' : `${period} 年`} />
          )}
          {hasOptions && <OptionPanel trades={all} prefs={prefs} setPrefs={setPrefs} />}

          <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {TABS.map(t => (
                <Chip key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
                  {t.label}
                </Chip>
              ))}
              <span className="ml-auto text-[11px] text-faint">
                {PICK_LABEL(pickKey)} · {period === 'all' ? '全部期間' : `${period} 年`}
              </span>
            </div>

            {tab === 'product' && <GroupTable groups={products} label="商品（不分月份）" />}
            {tab === 'hold' && (
              <>
                <GroupTable groups={holds} label="持有" />
                <p className="mt-1.5 text-[11px] text-faint">
                  當沖＝同一個交易日開倉又平倉（夜盤算在它所屬的交易日）。
                </p>
              </>
            )}
            {tab === 'dist' && <DistTab trades={picked} />}
            {tab === 'detail' && <DetailTab trades={picked} onToggle={toggle} />}
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
