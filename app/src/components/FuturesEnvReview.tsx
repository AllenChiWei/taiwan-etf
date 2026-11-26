/* 期貨對帳單 × 市場環境交叉復盤區塊（/futures）。
 *
 * 載入站內既有歷史環境檔（chips.json、settle.json、atm.json、nextday.json），
 * 在瀏覽器端依平倉日對齊並拆解程式／主觀／選擇權績效。任何一檔缺失時僅隱藏或提示
 * 該維度，不影響整頁使用；對帳單完全不離開瀏覽器。
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchChips } from '../api/chips';
import { fetchAtm } from '../api/atm';
import { fetchSettleHistory, type SettleHistRow } from '../api/settle';
import { fetchNextday } from '../api/extras';
import {
  STRATEGIES, STRATEGY_LABEL, type Strategy, type Trade,
} from '../lib/futures';
import {
  analyzeFuturesEnv, ENV_MAINT_THRESHOLD, MIN_SAMPLE_DAYS,
  type EnvCell, type EnvDimension, type MarketEnvSources,
} from '../lib/futuresEnv';
import { TONE_CLASS } from '../lib/format';
import { Fold } from './Fold';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });

const money = (v: number) => `${v >= 0 ? '+' : '−'}${nf0.format(Math.abs(v))}`;
const tone = (v: number) => TONE_CLASS[v > 0 ? 'up' : v < 0 ? 'down' : 'flat'];
const pct0 = (v: number | null) => (v === null ? '—' : `${nf0.format(v * 100)}%`);
const pct1 = (v: number | null) => (v === null ? '—' : `${nf1.format(v * 100)}%`);

/* 沿用 FuturesPage 的策略色，避開台股紅綠漲跌色。 */
const STRAT_COLOR: Record<Strategy, string> = {
  程式: '#1f6feb',
  主觀: '#e06c00',
  選擇權: '#7b4fd6',
};

type ViewMode = 'compare' | 'all' | Strategy;

const VIEW_MODES: Array<{ id: ViewMode; label: string }> = [
  { id: 'compare', label: '三方式並排' },
  { id: 'all', label: '合計明細' },
  { id: '程式', label: STRATEGY_LABEL.程式 },
  { id: '主觀', label: STRATEGY_LABEL.主觀 },
  { id: '選擇權', label: STRATEGY_LABEL.選擇權 },
];

/* 模組層快取：同一工作階段只抓一次站內環境資料，避免未匯入與匯入後重複請求。 */
let cachedSources: Promise<MarketEnvSources> | null = null;

function loadEnvSources(): Promise<MarketEnvSources> {
  if (!cachedSources) {
    cachedSources = Promise.all([
      fetchChips().catch(() => null),
      fetchSettleHistory().catch(() => [] as SettleHistRow[]),
      fetchAtm().catch(() => null),
      fetchNextday().catch(() => null),
    ]).then(([chips, settle, atm, nextday]) => ({ chips, settle, atm, nextday }));
  }
  return cachedSources;
}

function LowSampleBadge({ days }: { days: number }) {
  return (
    <span
      className="ml-1.5 inline-block rounded border border-line bg-sunken px-1.5 py-px text-[10px] font-medium text-muted align-middle"
      title={`有效交易日僅 ${days} 天（少於 ${MIN_SAMPLE_DAYS} 天），統計不具代表性`}
    >
      樣本 &lt;{MIN_SAMPLE_DAYS} 天
    </span>
  );
}

function StrategyMiniCell({ cell, highlight, last }: { cell: EnvCell; highlight: boolean; last: boolean }) {
  const pad = last ? '' : 'pr-2';
  if (cell.days === 0) {
    return (
      <td className={`py-1.5 ${pad} text-right font-mono tabular-nums text-faint ${highlight ? 'bg-accent-soft/45' : ''}`}>
        —
      </td>
    );
  }
  return (
    <td
      className={`py-1.5 ${pad} text-right font-mono tabular-nums ${highlight ? 'bg-accent-soft/45' : ''}`}
      title={cell.lowSample ? `僅 ${cell.days} 天（少於 ${MIN_SAMPLE_DAYS} 天，不具代表性）` : undefined}
    >
      <div className={`font-semibold ${tone(cell.net)}`}>{money(cell.net)}</div>
      <div className="text-[10.5px] text-muted">
        {cell.days}天{cell.lowSample ? '*' : ''} · 勝 {pct0(cell.dayWinRate)}
      </div>
    </td>
  );
}

/** 尚未匯入對帳單時顯示站內環境資料的實際門檻與涵蓋區間。 */
function PreviewCard({ dim }: { dim: EnvDimension }) {
  const rangeText = dim.id === 'weekday'
    ? '不限期間（週一～週五）'
    : dim.available && dim.coverage
      ? `涵蓋 ${dim.coverage.from} ～ ${dim.coverage.to}`
      : (dim.unavailableReason ?? '資料暫時讀不到');
  return (
    <div className="rounded-lg border border-line bg-bg p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12.5px] font-bold text-ink">{dim.title}</h3>
        <span
          className={`shrink-0 rounded px-1.5 py-px text-[10.5px] font-semibold ${
            dim.available ? 'bg-accent-soft text-accent' : 'bg-sunken text-muted'
          }`}
        >
          {dim.available ? '已就緒' : '暫讀不到'}
        </span>
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-muted">{dim.criterion}</p>
      <p className="mt-1.5 font-mono text-[11px] tabular-nums text-faint">{rangeText}</p>
    </div>
  );
}

function DimensionBlock({ dim, viewMode, highlightStrat }: {
  dim: EnvDimension;
  viewMode: ViewMode;
  highlightStrat: Strategy | null;
}) {
  return (
    <div className="mt-3 rounded-lg border border-line bg-bg p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="text-[13px] font-bold text-ink">{dim.title}</h3>
          <span className="text-[11px] text-muted">{dim.criterion}</span>
        </div>
        {dim.available && (
          <span className="text-[11px] text-faint font-mono tabular-nums">
            對齊 {dim.matchedDays} 天
            {dim.unmatchedDays > 0 && `（${dim.unmatchedDays} 天不在涵蓋期內）`}
            {dim.coverage && ` · ${dim.coverage.from}～${dim.coverage.to}`}
          </span>
        )}
      </div>

      {!dim.available ? (
        <p className="mt-2 rounded bg-sunken px-2.5 py-1.5 text-[12px] text-muted">
          {dim.unavailableReason ?? '此維度資料暫時讀不到'}，不影響其他維度統計。
        </p>
      ) : viewMode === 'compare' ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[660px] text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-faint">
                <th className="py-1 pr-2 font-medium">環境分組</th>
                <th className="py-1 pr-2 text-right font-medium">天數</th>
                <th className="py-1 pr-2 text-right font-medium">合計損益</th>
                <th className="py-1 pr-2 text-right font-medium">日勝率</th>
                {STRATEGIES.map((st, i) => (
                  <th
                    key={st}
                    className={`py-1 ${i < STRATEGIES.length - 1 ? 'pr-2' : ''} text-right font-medium ${highlightStrat === st ? 'bg-accent-soft/45 text-ink' : ''}`}
                  >
                    <span
                      aria-hidden="true"
                      className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                      style={{ background: STRAT_COLOR[st] }}
                    />
                    {STRATEGY_LABEL[st]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dim.rows.map(r => (
                <tr key={r.id} className="border-t border-line/60 align-top">
                  <td className="py-1.5 pr-2">
                    <span className="font-medium text-ink">{r.label}</span>
                    {r.all.lowSample && <LowSampleBadge days={r.all.days} />}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted">
                    {r.all.days}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                    {r.all.days > 0 ? (
                      <>
                        <div className={`font-semibold ${tone(r.all.net)}`}>{money(r.all.net)}</div>
                        <div className="text-[10.5px] text-faint">
                          日均 {r.all.avgDailyNet !== null ? money(r.all.avgDailyNet) : '—'}
                        </div>
                      </>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                    {r.all.days > 0 ? (
                      <>
                        <div className="font-semibold text-ink">{pct1(r.all.dayWinRate)}</div>
                        <div className="text-[10.5px] text-faint">
                          {r.all.winDays}/{r.all.days}日 · 筆 {pct0(r.all.tradeWinRate)}
                        </div>
                      </>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  {STRATEGIES.map((st, i) => (
                    <StrategyMiniCell
                      key={st}
                      cell={r.byStrategy[st]}
                      highlight={highlightStrat === st}
                      last={i === STRATEGIES.length - 1}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-faint">
                <th className="py-1 pr-2 font-medium">環境分組</th>
                <th className="py-1 pr-2 text-right font-medium">天數</th>
                <th className="py-1 pr-2 text-right font-medium">筆數</th>
                <th className="py-1 pr-2 text-right font-medium">總損益</th>
                <th className="py-1 pr-2 text-right font-medium">日均損益</th>
                <th className="py-1 pr-2 text-right font-medium">日勝率</th>
                <th className="py-1 text-right font-medium">筆勝率</th>
              </tr>
            </thead>
            <tbody>
              {dim.rows.map(r => {
                const c = viewMode === 'all' ? r.all : r.byStrategy[viewMode];
                return (
                  <tr key={r.id} className="border-t border-line/60">
                    <td className="py-1.5 pr-2">
                      <span className="font-medium text-ink">{r.label}</span>
                      {c.lowSample && <LowSampleBadge days={c.days} />}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted">{c.days}</td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted">{c.trades}</td>
                    <td className={`py-1.5 pr-2 text-right font-mono font-semibold tabular-nums ${c.days ? tone(c.net) : 'text-faint'}`}>
                      {c.days ? money(c.net) : '—'}
                    </td>
                    <td className={`py-1.5 pr-2 text-right font-mono tabular-nums ${c.avgDailyNet !== null ? tone(c.avgDailyNet) : 'text-faint'}`}>
                      {c.avgDailyNet !== null ? money(c.avgDailyNet) : '—'}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-ink">
                      {c.days ? `${pct1(c.dayWinRate)}（${c.winDays}/${c.days}）` : '—'}
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-muted">
                      {c.trades ? pct1(c.tradeWinRate) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function FuturesEnvReview({ trades, periodLabel, pickKey }: {
  trades: Trade[];
  periodLabel: string;
  pickKey: string;
}) {
  const [sources, setSources] = useState<MarketEnvSources | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('compare');

  useEffect(() => {
    let alive = true;
    void loadEnvSources().then(s => {
      if (alive) setSources(s);
    });
    return () => { alive = false; };
  }, []);

  const review = useMemo(
    () => (sources ? analyzeFuturesEnv(trades, sources) : null),
    [trades, sources],
  );

  const hasTrades = trades.length > 0;
  const highlightStrat: Strategy | null =
    pickKey === '程式' || pickKey === '主觀' || pickKey === '選擇權' ? pickKey : null;

  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-bold text-ink">市場環境復盤</h2>
        <span className="text-[11.5px] text-faint">
          {periodLabel}
          {hasTrades && review && ` · 共 ${review.totalDays} 個平倉交易日`}
        </span>
      </div>

      <p className="mt-1 max-w-[82ch] text-[12px] leading-relaxed text-muted">
        {hasTrades ? (
          <>
            依對帳單<strong className="text-ink">平倉日（結算日）</strong>對齊站內歷史大盤環境，全部在瀏覽器端計算。
            有效交易日<strong className="text-ink">少於 {MIN_SAMPLE_DAYS} 天</strong>的組別會標示「樣本 &lt;{MIN_SAMPLE_DAYS} 天」或「*」，統計不具代表性。
          </>
        ) : (
          <>
            匯入對帳單後，會在瀏覽器端依<strong className="text-ink">平倉日（結算日）</strong>對齊下方四項站內環境資料，
            列出各組天數、損益與勝率，並區分<strong className="text-ink">程式交易／主觀交易／選擇權</strong>
            （樣本少於 {MIN_SAMPLE_DAYS} 天標示不具代表性）。
          </>
        )}
      </p>

      {hasTrades && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {VIEW_MODES.map(m => (
            <button
              key={m.id}
              type="button"
              aria-pressed={viewMode === m.id}
              onClick={() => setViewMode(m.id)}
              className={`h-7 shrink-0 rounded-lg px-2.5 text-[12px] font-semibold transition-colors ${
                viewMode === m.id
                  ? 'bg-accent text-accent-ink'
                  : 'bg-sunken text-muted hover:text-ink'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {!review ? (
        <p className="mt-3 text-[12px] text-muted">載入站內市場環境資料中…</p>
      ) : !hasTrades ? (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {review.dimensions.map(dim => (
            <PreviewCard key={dim.id} dim={dim} />
          ))}
        </div>
      ) : (
        <>
          {review.dimensions.map(dim => (
            <DimensionBlock
              key={dim.id}
              dim={dim}
              viewMode={viewMode}
              highlightStrat={highlightStrat}
            />
          ))}

          <Fold summary="口徑說明、資料日期與限制（依平倉日對齊，留倉單可能跨不同環境）" className="mt-3">
            <ul className="list-disc space-y-1 pl-4">
              <li>
                <strong className="text-muted">依平倉日分組</strong>：對帳單日期為平倉結算日；留倉單的開倉日與平倉日可能處於不同市場環境，統計僅反映平倉當日狀態。
              </li>
              <li>
                <strong className="text-muted">勝率與策略口徑</strong>：日勝率＝當日合計淨損益 &gt; 0 的交易日佔比，另附單筆勝率；程式（小台指、小電子）／主觀／選擇權沿用本頁既有分類，各策略僅計算自己有交易的日子。
              </li>
              <li>
                <strong className="text-muted">樣本數限制</strong>：任一環境組別的有效交易日少於 {MIN_SAMPLE_DAYS} 天（標示「樣本 &lt;{MIN_SAMPLE_DAYS} 天」或「*」）時，結果容易受單日極端值左右，不具統計代表性。
              </li>
              <li>
                <strong className="text-muted">資料來源與最新日期</strong>：
                大盤維持率（門檻 {ENV_MAINT_THRESHOLD}%，
                {review.meta.maintLatest
                  ? `至 ${review.meta.maintLatest}${review.meta.maintSource === 'nextday-fallback' ? '，由隔日漲跌資料備援' : ''}`
                  : '暫無資料'}
                ）；
                結算日（含月選、週三與週五週選，{review.meta.settleLatest ? `至 ${review.meta.settleLatest}` : '暫無資料'}）；
                高波動日（
                {review.meta.vixThreshold !== null
                  ? `臺指 VIX 前 20% ≥ ${review.meta.vixThreshold.toFixed(1)}，至 ${review.meta.vixLatest}`
                  : '臺指 VIX 暫無資料'}
                ；
                {review.meta.ampThreshold !== null
                  ? `台指日振幅前 20% ≥ ${(review.meta.ampThreshold * 100).toFixed(2)}%，近 ${review.meta.ampDays} 日至 ${review.meta.ampLatest}`
                  : '台指日振幅暫無資料'}
                ）。不在涵蓋區間內的舊日期不計入對應維度。
              </li>
              <li>
                全部計算皆在本機瀏覽器完成，對帳單不會上傳；本區塊僅為歷史交易復盤整理，不構成操作建議。
              </li>
            </ul>
          </Fold>
        </>
      )}
    </section>
  );
}
