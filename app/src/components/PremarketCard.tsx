/* 盤前作戰卡（#/nextday 最上方）：水平點位軸（SVG）疊合明天漲跌停、95%／99% 預測區間、
 * 週選價平和 ±1 倍區間、Call／Put 最大未平倉壓力支撐牆與目前收盤；
 * 下方濃縮大盤融資維持率、狀態放寬倍數、外資大台淨口數、小台散戶多空比、是否結算日與台股重要事件。
 *
 * 所有跨檔資料（atm.json、chips.json、retail.json、calendar.json）皆容許缺檔，缺哪一項就優雅降級不破頁。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { fetchAtm } from '../api/atm';
import { fetchChips } from '../api/chips';
import { fetchRetail } from '../api/retail';
import { fetchCalendar } from '../api/extras';
import { REGIME_LABEL, type NextdayData } from '../lib/nextday';
import { SERIES_LABEL, WEEKDAY_LABEL, weekdayOf, type AtmData, type Series } from '../lib/atm';
import { MAINT_T, netTone, type ChipsData } from '../lib/chips';
import type { RetailData } from '../lib/retail';
import type { CalendarData } from '../lib/calendar';
import { TONE_CLASS } from '../lib/format';
import { Fold } from './Fold';
import {
  buildAxisModel, buildPremarketSummary, contractShort, fmtInt, layoutAxisLabels, pickOptionContracts, shortDate,
  type AxisTone, type PlacedLabel, type PremarketAxis,
} from '../lib/premarket';

const AMBER = '#d97706';

const AXIS_COLOR: Record<AxisTone, string> = {
  up: 'var(--c-up)',
  down: 'var(--c-down)',
  accent: 'var(--c-accent)',
  yield: 'var(--c-yield)',
  ink: 'var(--c-ink)',
};

function dayLabel(iso: string): string {
  const wd = weekdayOf(iso);
  return `${shortDate(iso)}${wd === null ? '' : `（${WEEKDAY_LABEL[wd]}）`}`;
}

function shortDayLabel(iso: string): string {
  const wd = weekdayOf(iso);
  return `${shortDate(iso)}${wd === null ? '' : `（${WEEKDAY_LABEL[wd].slice(1)}）`}`;
}

function signedPct(v: number, digits = 1): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`;
}

function signedInt(v: number): string {
  const n = Math.round(v);
  return `${n > 0 ? '+' : ''}${fmtInt(n)}`;
}

function maintZoneNote(v: number): string {
  if (v < MAINT_T.sell) return '斷頭區';
  if (v < MAINT_T.accel) return '加速區';
  if (v < MAINT_T.calm) return `<${MAINT_T.calm}% 注意`;
  return '正常區';
}

export function PremarketCard({ data }: { data: NextdayData }) {
  const [atm, setAtm] = useState<AtmData | null>(null);
  const [chips, setChips] = useState<ChipsData | null>(null);
  const [retail, setRetail] = useState<RetailData | null>(null);
  const [calendar, setCalendar] = useState<CalendarData | null>(null);
  const [seriesOverride, setSeriesOverride] = useState<Series | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchAtm(ac.signal).then(d => { if (!ac.signal.aborted) setAtm(d); }).catch(() => {});
    fetchChips(ac.signal).then(d => { if (!ac.signal.aborted) setChips(d); }).catch(() => {});
    fetchRetail(ac.signal).then(d => { if (!ac.signal.aborted) setRetail(d); }).catch(() => {});
    fetchCalendar(ac.signal).then(d => { if (!ac.signal.aborted) setCalendar(d); }).catch(() => {});
    return () => ac.abort();
  }, []);

  const optInfo = useMemo(
    () => pickOptionContracts(atm, data.meta.next, { date: data.meta.date, close: data.meta.close }),
    [atm, data.meta.next, data.meta.date, data.meta.close],
  );

  const activeOpt = useMemo(() => {
    if (!optInfo.list.length) return null;
    return optInfo.list.find(o => o.series === seriesOverride)
      ?? optInfo.list.find(o => o.series === optInfo.defaultSeries)
      ?? optInfo.list[0];
  }, [optInfo, seriesOverride]);

  const axis = useMemo(() => buildAxisModel(data, activeOpt), [data, activeOpt]);
  const summary = useMemo(
    () => buildPremarketSummary({
      nextday: data, atm, chips, retail, calendar, selectedOption: activeOpt,
    }),
    [data, atm, chips, retail, calendar, activeOpt],
  );

  const m = data.meta;

  return (
    <section id="sec-premarket" className="mt-3 scroll-mt-16 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 className="text-base font-bold text-ink">盤前作戰卡</h2>
          <span className="text-[12px] text-muted">
            目標交易日 <b className="text-ink">{dayLabel(m.next)}</b>
            {m.regime !== 'normal' && (
              <span className="ml-1 rounded bg-sunken px-1.5 py-0.5 text-[11px] text-ink">
                {REGIME_LABEL[m.regime]}
              </span>
            )}
          </span>
        </div>
        {optInfo.list.length > 1 && (
          <div role="tablist" aria-label="點位軸選擇權合約" className="flex flex-wrap gap-1">
            {optInfo.list.map(o => {
              const on = activeOpt?.series === o.series;
              return (
                <button
                  key={o.series}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setSeriesOverride(o.series)}
                  className={`h-7 rounded-lg px-2 text-[11.5px] font-semibold transition-colors ${
                    on ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
                >
                  {o.series === 'wed' ? '週三' : '週五'} {o.contract}（剩 {o.dte} 天）
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 圖例列 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block h-2.5 w-4 rounded-xs bg-accent/45" />
          95% 區間
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block h-2.5 w-4 rounded-xs bg-accent/20" />
          99% 區間
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block h-2.5 w-4 rounded-xs border border-dashed border-line-strong bg-sunken" />
          漲跌停 ±{(m.limit * 100).toFixed(0)}%
        </span>
        {activeOpt && (
          <>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="inline-block h-1.5 w-4 rounded-xs" style={{ background: 'var(--c-yield)', opacity: 0.7 }} />
              週選價平和 ±1×
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="inline-block h-3 w-1 rounded-xs bg-down" />
              <span aria-hidden className="inline-block h-3 w-1 rounded-xs bg-up" />
              Put／Call 最大 OI 牆
            </span>
          </>
        )}
      </div>

      <PremarketAxisSvg axis={axis} />

      {activeOpt ? (
        <p className="mt-1 text-[11px] leading-snug text-muted">
          <b className="text-ink">{SERIES_LABEL[activeOpt.series]} {activeOpt.contract}</b>
          （到期 {shortDate(activeOpt.expiry)}・剩 {activeOpt.dte} 天・{activeOpt.day} 收盤）：
          價平和 <span className="font-mono tabular-nums text-ink">{fmtInt(activeOpt.straddle)}</span> 點
          （±{((activeOpt.straddle / activeOpt.straddleIndex) * 100).toFixed(1)}%）
          {activeOpt.putWall && (
            <>
              {' · '}Put 支撐 <span className="font-mono tabular-nums text-down">{fmtInt(activeOpt.putWall.strike)}</span>
              （{fmtInt(activeOpt.putWall.oi)} 口）
            </>
          )}
          {activeOpt.callWall && (
            <>
              {' · '}Call 壓力 <span className="font-mono tabular-nums text-up">{fmtInt(activeOpt.callWall.strike)}</span>
              （{fmtInt(activeOpt.callWall.oi)} 口）
            </>
          )}
          {activeOpt.thin && (
            <span className="ml-1 font-semibold" style={{ color: AMBER }}>
              ・剛換倉未平倉偏薄
            </span>
          )}
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-faint">
          週選價平和／未平倉資料暫時讀不到，點位軸僅顯示統計區間與漲跌停。
        </p>
      )}

      {/* 下方一行濃縮（大螢幕 6 欄一排，平板 3 欄，手機 2 欄不撐寬） */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {/* 1. 大盤融資維持率 */}
        <Link
          to="/chips"
          className="min-w-0 rounded-lg border border-line bg-bg px-2.5 py-2 transition-colors hover:border-accent/60"
          style={summary.maint && summary.maint.level >= 1 ? { borderLeftColor: AMBER, borderLeftWidth: 3 } : undefined}
        >
          <div className="flex items-baseline justify-between gap-1">
            <span className="truncate text-[11px] text-muted">大盤融資維持率</span>
            {summary.maint && <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-faint">{shortDate(summary.maint.date)}</span>}
          </div>
          <div
            className="mt-0.5 truncate font-mono text-[15px] font-bold leading-snug tabular-nums text-ink"
            style={summary.maint && summary.maint.level >= 1 ? { color: AMBER } : undefined}
          >
            {summary.maint ? `${summary.maint.value.toFixed(1)}%` : '—'}
          </div>
          <div className="mt-0.5 truncate text-[10.5px] text-faint">
            {summary.maint
              ? `${maintZoneNote(summary.maint.value)}${summary.maint.delta !== null ? `・${summary.maint.delta >= 0 ? '+' : '−'}${Math.abs(summary.maint.delta).toFixed(1)} 點` : ''}`
              : '暫時讀不到'}
          </div>
        </Link>

        {/* 2. 狀態放寬倍數 */}
        <div
          className="min-w-0 rounded-lg border border-line bg-bg px-2.5 py-2"
          style={summary.state?.wide ? { borderLeftColor: AMBER, borderLeftWidth: 3 } : undefined}
        >
          <div className="flex items-baseline justify-between gap-1">
            <span className="truncate text-[11px] text-muted">狀態放寬倍數</span>
            {summary.state && <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-faint">{shortDate(summary.state.date)}</span>}
          </div>
          <div className="mt-0.5 truncate font-mono text-[14px] font-bold leading-snug tabular-nums text-ink">
            {summary.state ? (
              <>
                <span style={summary.state.fd > 1.05 ? { color: AMBER } : undefined}>
                  <span className="font-sans text-[12.5px]">下</span>×{summary.state.fd.toFixed(2)}
                </span>
                <span className="mx-1 font-sans text-[11px] font-normal text-faint">/</span>
                <span style={summary.state.fu > 1.05 ? { color: AMBER } : undefined}>
                  <span className="font-sans text-[12.5px]">上</span>×{summary.state.fu.toFixed(2)}
                </span>
              </>
            ) : '—'}
          </div>
          <div className="mt-0.5 truncate text-[10.5px] text-faint">
            {summary.state
              ? (summary.state.wide ? (summary.state.topReasons.join('、') || '壓力狀態放寬') : '平常狀態無放寬')
              : '無狀態調整'}
          </div>
        </div>

        {/* 3. 外資大台淨口數 */}
        <Link
          to="/chips"
          className="min-w-0 rounded-lg border border-line bg-bg px-2.5 py-2 transition-colors hover:border-accent/60"
        >
          <div className="flex items-baseline justify-between gap-1">
            <span className="truncate text-[11px] text-muted">外資大台淨口數</span>
            {summary.foreignTx && <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-faint">{shortDate(summary.foreignTx.date)}</span>}
          </div>
          <div className={`mt-0.5 truncate font-mono text-[15px] font-bold leading-snug tabular-nums ${
            summary.foreignTx ? TONE_CLASS[netTone(summary.foreignTx.net)] : 'text-faint'}`}>
            {summary.foreignTx ? (
              <>
                {signedInt(summary.foreignTx.net)}
                <span className="ml-0.5 font-sans text-[12.5px] font-semibold">口</span>
              </>
            ) : '—'}
          </div>
          <div className="mt-0.5 truncate text-[10.5px] text-faint">
            {summary.foreignTx
              ? `大台約當${summary.foreignTx.delta !== null ? `・日 ${signedInt(summary.foreignTx.delta)}` : ''}`
              : '籌碼暫時讀不到'}
          </div>
        </Link>

        {/* 4. 散戶多空比 */}
        <Link
          to="/chips"
          className="min-w-0 rounded-lg border border-line bg-bg px-2.5 py-2 transition-colors hover:border-accent/60"
        >
          <div className="flex items-baseline justify-between gap-1">
            <span className="truncate text-[11px] text-muted">散戶多空比</span>
            {summary.retailMtx && <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-faint">{shortDate(summary.retailMtx.date)}</span>}
          </div>
          <div className={`mt-0.5 truncate font-mono text-[15px] font-bold leading-snug tabular-nums ${
            summary.retailMtx ? TONE_CLASS[netTone(summary.retailMtx.ratio)] : 'text-faint'}`}>
            {summary.retailMtx ? signedPct(summary.retailMtx.ratio) : '—'}
          </div>
          <div className="mt-0.5 truncate text-[10.5px] text-faint">
            {summary.retailMtx
              ? `小台推算${summary.retailMtx.delta !== null ? `・日 ${signedPct(summary.retailMtx.delta)}` : ''}`
              : '暫時讀不到'}
          </div>
        </Link>

        {/* 5. 是否結算日 */}
        <Link
          to="/settle"
          className="min-w-0 rounded-lg border border-line bg-bg px-2.5 py-2 transition-colors hover:border-accent/60"
          style={summary.settle.isSettle ? { borderLeftColor: AMBER, borderLeftWidth: 3 } : undefined}
        >
          <div className="flex items-baseline justify-between gap-1">
            <span className="truncate text-[11px] text-muted">是否結算日</span>
            <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-faint">
              {summary.settle.date ? shortDate(summary.settle.date) : '規則'}
            </span>
          </div>
          <div
            className="mt-0.5 text-[14px] font-bold leading-snug text-ink"
            style={summary.settle.isSettle ? { color: AMBER } : undefined}
          >
            {summary.settle.isSettle ? `是（${summary.settle.label}）` : '否'}
          </div>
          <div className="mt-0.5 truncate text-[10.5px] text-faint">
            {summary.settle.isSettle
              ? `${summary.settle.contract ?? summary.settle.label}・13:00–13:30`
              : summary.settle.nextDate
                ? `下次 ${shortDayLabel(summary.settle.nextDate)}${summary.settle.nextContract ? contractShort(summary.settle.nextContract) : ''}`
                : '尚無後續到期資料'}
          </div>
        </Link>

        {/* 6. 重要事件 */}
        <Link
          to="/calendar"
          className="min-w-0 rounded-lg border border-line bg-bg px-2.5 py-2 transition-colors hover:border-accent/60"
          style={summary.events.important ? { borderLeftColor: AMBER, borderLeftWidth: 3 } : undefined}
        >
          <div className="flex items-baseline justify-between gap-1">
            <span className="truncate text-[11px] text-muted">重要事件</span>
            <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-faint">
              {summary.events.date ? shortDate(summary.events.date) : '規則'}
            </span>
          </div>
          <div
            className={`mt-0.5 text-[13.5px] font-bold leading-snug sm:text-[14px] ${
              summary.events.calendarLoaded || summary.events.ruleTitles.length > 0 ? 'text-ink' : 'text-faint'}`}
            style={summary.events.important ? { color: AMBER } : undefined}
          >
            {summary.events.summary}
          </div>
          <div className="mt-0.5 truncate text-[10.5px] text-faint">
            {summary.events.detail}
          </div>
        </Link>
      </div>

      {/* 各來源資料日期 */}
      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-faint">
        <span className="font-semibold text-muted">來源日期</span>
        {summary.dates.map(item => (
          <span key={item.key} className="whitespace-nowrap">
            {item.label}：
            {item.date
              ? <span className="font-mono tabular-nums text-muted">{item.date}</span>
              : <span>暫時讀不到</span>}
            {item.note && <span className="ml-0.5">（{item.note}）</span>}
          </span>
        ))}
      </div>

      {summary.hasDateMismatch && (
        <p className="mt-1 text-[11px] leading-snug" style={{ color: AMBER }}>
          ⚠ 各來源資料日期不一致（價平和／期貨約 19:00、融資維持率最晚約 21:30 更新），對照時請留意盤後時間差。
        </p>
      )}

      <Fold summary="盤前作戰卡口徑：上排看隔日單日統計、下排看週選到期日定價與 OI；僅供對照參考">
        點位軸上排為隔日統計區間（95%／99%，含狀態放寬）與漲跌停（前收 ×1.1／×0.9）；下排為所選週選合約的價平和 ±1 倍區間與價外 Call／Put 最大未平倉履約價（對應至該合約到期日，不是單日；未平倉牆屬籌碼解讀，指數仍可能穿越）。
        大盤融資維持率採證交所全市場擔保維持率口徑（165% 以下留意、156% 以下加速區）；外資大台淨口數為大台＋小台÷4＋微台÷20 約當值；小台散戶多空比為三大法人以外部位推算。
        結算日取自期交所選擇權到期日（已含假日順延）；重要事件來自台股行事曆（法說會、除權息、股東會與財報／月營收法定期限），
        <strong className="text-muted">不含美國總經發布時程（FOMC／CPI／非農）</strong>。本卡僅供盤前點位與籌碼檢視，不構成投資建議。
      </Fold>
    </section>
  );
}

/** 水平點位軸（手寫 SVG，依容器實際寬度自動錯開標籤層數，390px 手機也不重疊）。 */
function PremarketAxisSvg({ axis }: { axis: PremarketAxis }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(336);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => { if (el.clientWidth > 0) setW(el.clientWidth); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const compact = W < 540;
  const padL = 12;
  const padR = 12;
  const topLayout = useMemo(
    () => layoutAxisLabels(axis.topMarkers, axis.min, axis.max, W, padL, padR, compact),
    [axis.topMarkers, axis.min, axis.max, W, compact],
  );
  const botLayout = useMemo(
    () => layoutAxisLabels(axis.bottomMarkers, axis.min, axis.max, W, padL, padR, compact),
    [axis.bottomMarkers, axis.min, axis.max, W, compact],
  );

  const LANE_H = 30;
  const BOX_H = 24;
  const TOP_PAD = 6;
  const GAP_Y = 10;
  const topLanes = Math.max(1, topLayout.lanes);
  const botLanes = botLayout.lanes;
  const hasOpt = Boolean(axis.options);

  const spineY = TOP_PAD + topLanes * LANE_H + GAP_Y + 10;
  const spineTop = spineY - 9;
  const spineBot = hasOpt ? spineY + 19 : spineY + 9;
  const H = botLanes > 0 ? spineBot + GAP_Y + botLanes * LANE_H + 4 : spineBot + 10;

  const span = Math.max(1, axis.max - axis.min);
  const inner = Math.max(1, W - padL - padR);
  const xOf = (v: number) => padL + ((v - axis.min) / span) * inner;

  const topBoxTop = (lane: number) => spineTop - GAP_Y - lane * LANE_H - BOX_H;
  const botBoxTop = (lane: number) => spineBot + GAP_Y + lane * LANE_H;

  const leaderPath = (item: PlacedLabel, side: 'top' | 'bottom') => {
    const yStart = side === 'top' ? spineTop : spineBot;
    const yEnd = side === 'top' ? topBoxTop(item.lane) + BOX_H : botBoxTop(item.lane);
    if (Math.abs(item.boxX - item.anchorX) < 1) {
      return `M${item.anchorX.toFixed(1)},${yStart.toFixed(1)} L${item.anchorX.toFixed(1)},${yEnd.toFixed(1)}`;
    }
    const elbowY = side === 'top' ? yEnd + 4 : yEnd - 4;
    return `M${item.anchorX.toFixed(1)},${yStart.toFixed(1)} L${item.anchorX.toFixed(1)},${elbowY.toFixed(1)} L${item.boxX.toFixed(1)},${yEnd.toFixed(1)}`;
  };

  const renderLabel = (item: PlacedLabel, side: 'top' | 'bottom') => {
    const yTop = side === 'top' ? topBoxTop(item.lane) : botBoxTop(item.lane);
    const color = AXIS_COLOR[item.tone];
    return (
      <g key={`${side}-${item.id}`}>
        <title>{item.detail}</title>
        <rect x={item.left} y={yTop} width={item.width} height={BOX_H} rx={4} className="fill-surface" opacity={0.92} />
        <text
          x={item.boxX}
          y={yTop + 10}
          textAnchor="middle"
          fontSize={10}
          fontWeight={item.tone === 'ink' ? 700 : 600}
          fill={item.tone === 'ink' ? 'var(--c-ink)' : 'var(--c-muted)'}
        >
          {item.titleText}
        </text>
        <text
          x={item.boxX}
          y={yTop + 21}
          textAnchor="middle"
          fontSize={11}
          fontWeight={700}
          fill={color}
          className="font-mono tabular-nums"
        >
          {item.valueText}
        </text>
      </g>
    );
  };

  const xLimDn = xOf(axis.limDn);
  const xLimUp = xOf(axis.limUp);
  const xClose = xOf(axis.close);
  const opt = axis.options;

  return (
    <div ref={box} className="mt-1.5 w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block w-full max-w-full"
        role="img"
        aria-label="盤前點位軸：明天漲跌停、95% 與 99% 預測區間、週選價平和區間、最大未平倉壓力與支撐、目前收盤"
      >
        {/* 先畫全部導線，確保文字圖層壓在導線上方不被遮擋 */}
        <g fill="none" strokeWidth={1} opacity={0.65}>
          {topLayout.items.map(it => (
            <path key={`lt-${it.id}`} d={leaderPath(it, 'top')} stroke={AXIS_COLOR[it.tone]} />
          ))}
          {botLayout.items.map(it => (
            <path key={`lb-${it.id}`} d={leaderPath(it, 'bottom')} stroke={AXIS_COLOR[it.tone]} />
          ))}
        </g>

        {/* 水平底軸線 */}
        <line x1={padL} x2={W - padR} y1={spineY} y2={spineY} className="stroke-line" strokeWidth={1.5} />

        {/* 漲跌停硬上下限軌道（前收 ×0.9 ～ ×1.1） */}
        <rect
          x={xLimDn}
          y={spineY - 6}
          width={Math.max(1, xLimUp - xLimDn)}
          height={12}
          rx={3}
          fill="var(--c-sunken)"
          stroke="var(--c-border-strong)"
          strokeWidth={1}
          strokeDasharray="3 2"
        />

        {/* 99% 與 95% 統計區間帶 */}
        {axis.d99 !== null && axis.u99 !== null && (
          <rect
            x={xOf(axis.d99)}
            y={spineY - 6}
            width={Math.max(1, xOf(axis.u99) - xOf(axis.d99))}
            height={12}
            rx={2}
            fill="var(--c-accent)"
            opacity={0.18}
          />
        )}
        {axis.d95 !== null && axis.u95 !== null && (
          <rect
            x={xOf(axis.d95)}
            y={spineY - 6}
            width={Math.max(1, xOf(axis.u95) - xOf(axis.d95))}
            height={12}
            rx={2}
            fill="var(--c-accent)"
            opacity={0.42}
          />
        )}

        {/* 漲跌停兩端短豎線 */}
        <line x1={xLimDn} x2={xLimDn} y1={spineY - 8} y2={spineY + 8} stroke="var(--c-down)" strokeWidth={2} />
        <line x1={xLimUp} x2={xLimUp} y1={spineY - 8} y2={spineY + 8} stroke="var(--c-up)" strokeWidth={2} />

        {/* 週選價平和 ±1 倍區間（畫在主軸下方一條細帶，避免與統計區間混色） */}
        {opt && opt.straddle > 0 && (
          <g>
            <rect
              x={xOf(opt.straddleLow)}
              y={spineY + 10}
              width={Math.max(1, xOf(opt.straddleHigh) - xOf(opt.straddleLow))}
              height={6}
              rx={2}
              fill="var(--c-yield)"
              opacity={0.4}
            />
            <line
              x1={xOf(opt.straddleLow)} x2={xOf(opt.straddleLow)}
              y1={spineY + 8} y2={spineY + 18}
              stroke="var(--c-yield)" strokeWidth={2}
            />
            <line
              x1={xOf(opt.straddleHigh)} x2={xOf(opt.straddleHigh)}
              y1={spineY + 8} y2={spineY + 18}
              stroke="var(--c-yield)" strokeWidth={2}
            />
          </g>
        )}

        {/* Put／Call 最大未平倉支撐壓力牆：貫穿兩層區間，方便直接對照是否重疊 */}
        {opt?.putWall && (
          <line
            x1={xOf(opt.putWall.strike)} x2={xOf(opt.putWall.strike)}
            y1={spineY - 5} y2={spineY + 18}
            stroke="var(--c-down)" strokeWidth={3} strokeLinecap="round"
          />
        )}
        {opt?.callWall && (
          <line
            x1={xOf(opt.callWall.strike)} x2={xOf(opt.callWall.strike)}
            y1={spineY - 5} y2={spineY + 18}
            stroke="var(--c-up)" strokeWidth={3} strokeLinecap="round"
          />
        )}

        {/* 目前收盤基準點 */}
        <line x1={xClose} x2={xClose} y1={spineTop} y2={spineBot} stroke="var(--c-ink)" strokeWidth={2} />
        <circle cx={xClose} cy={spineY} r={4} fill="var(--c-ink)" stroke="var(--c-surface)" strokeWidth={1.5} />

        {/* 標籤（上排：統計與漲跌停；下排：選擇權價平和與 OI 牆） */}
        {topLayout.items.map(it => renderLabel(it, 'top'))}
        {botLayout.items.map(it => renderLabel(it, 'bottom'))}
      </svg>
    </div>
  );
}
