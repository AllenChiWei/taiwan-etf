/* 盤中價平和：每 15 分鐘（或 60 分鐘）的週選價平和，含前一晚夜盤。
 *
 * 上半部看某一天怎麼走；下半部把最近 N 天疊起來，依「剩幾天到期」分組，
 * 看時間價值在一天之中哪一段流失最多 —— 這是決定雙賣什麼時候進場、要不要留倉過夜的依據。
 * 資料來自期交所逐筆成交（隔天才公布），不是即時報價。 */

import { useEffect, useMemo, useState } from 'react';
import { fetchIntradayDay, fetchIntradayIndex } from '../api/atmIntraday';
import {
  decayCurves, hourlyIndex, pickRow, sessionDecay, sums, synthetic,
  type AtmDay, type AtmIntradayIndex,
} from '../lib/atmIntraday';
import { SERIES_LABEL, type Series } from '../lib/atm';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
const pct = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '' : '−'}${nf0.format(Math.abs(v * 100))}%`);
const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#64748b', '#0ea5e9', '#a3a3a3'];
const LOOKBACK = [10, 20, 30];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
            className={`h-8 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
              active ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}>
      {children}
    </button>
  );
}

interface Line { key: string; label: string; color: string; values: Array<number | null>; dashed?: boolean }

/** 時間軸固定（夜盤 → 日盤），中間畫一條分隔線。null 的點斷開不連。 */
function TimeChart({ labels, sess, lines, fmt, tip }: {
  labels: string[];
  sess: string[];
  lines: Line[];
  fmt: (v: number) => string;
  tip?: (i: number) => string[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000, H = 260;
  const PAD = { top: 12, right: 12, bottom: 24, left: 52 };
  const innerW = W - PAD.left - PAD.right;
  const all = lines.flatMap(l => l.values).filter((v): v is number => v !== null);
  if (labels.length < 2 || !all.length) {
    return <div className="mt-2 grid h-[140px] place-items-center rounded-lg bg-bg text-[12.5px] text-muted">沒有足夠的資料</div>;
  }
  let lo = Math.min(...all), hi = Math.max(...all);
  if (lo === hi) hi = lo + 1;
  const pad = (hi - lo) * 0.06;
  lo -= pad; hi += pad;
  const x = (i: number) => PAD.left + (i / (labels.length - 1)) * innerW;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const path = (vs: Array<number | null>) => {
    let d = '', pen = false;
    vs.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const split = sess.findIndex(s => s === 'D');
  const ticks = [0, 1, 2, 3, 4].map(k => lo + ((hi - lo) * k) / 4);
  const marks = labels.map((_, i) => i).filter(i =>
    i === 0 || i === labels.length - 1 || i === split || i === split - 1 || /^(18|21|00|03|11):00$/.test(labels[i]));
  const h = hover === null ? null : Math.max(0, Math.min(labels.length - 1, hover));
  return (
    <div className="mt-2 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[640px] touch-pan-y" role="img"
           aria-label={`盤中價平和：${lines.map(l => l.label).join('、')}`}
           onMouseLeave={() => setHover(null)}
           onMouseMove={e => {
             const r = e.currentTarget.getBoundingClientRect();
             const px = ((e.clientX - r.left) / r.width) * W;
             setHover(Math.round(((px - PAD.left) / innerW) * (labels.length - 1)));
           }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--c-border)" opacity="0.5" />
            <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="12" fill="var(--c-faint)">{fmt(t)}</text>
          </g>
        ))}
        {split > 0 && (
          <g>
            <line x1={(x(split - 1) + x(split)) / 2} x2={(x(split - 1) + x(split)) / 2} y1={PAD.top} y2={H - PAD.bottom}
                  stroke="var(--c-border-strong)" strokeDasharray="4 4" />
            <text x={(x(split - 1) + x(split)) / 2 - 6} y={PAD.top + 10} textAnchor="end" fontSize="12" fill="var(--c-faint)">夜盤</text>
            <text x={(x(split - 1) + x(split)) / 2 + 6} y={PAD.top + 10} fontSize="12" fill="var(--c-faint)">日盤</text>
          </g>
        )}
        {marks.map(i => (
          <text key={i} x={x(i)} y={H - 6} fontSize="12" fill="var(--c-faint)"
                textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>{labels[i]}</text>
        ))}
        {lines.map(l => (
          <path key={l.key} d={path(l.values)} fill="none" stroke={l.color} strokeWidth="2"
                strokeDasharray={l.dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {h !== null && (
          <g>
            <line x1={x(h)} x2={x(h)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--c-border-strong)" />
            {lines.map(l => l.values[h] !== null && (
              <circle key={l.key} cx={x(h)} cy={y(l.values[h] as number)} r="3.5" fill={l.color} />
            ))}
          </g>
        )}
      </svg>
      <div className="mt-1 min-h-[2.5em] text-[12px] text-muted">
        {h === null ? '把游標移到圖上看各時間點的數字' : (
          <>
            <b className="text-ink">{sess[h] === 'N' ? '夜盤' : '日盤'} {labels[h]}</b>
            {lines.map(l => (
              <span key={l.key} className="ml-3"><span style={{ color: l.color }}>●</span> {l.label} {l.values[h] === null ? '—' : fmt(l.values[h] as number)}</span>
            ))}
            {tip?.(h).map((s, i) => <span key={i} className="ml-3 font-mono tabular-nums">{s}</span>)}
          </>
        )}
      </div>
    </div>
  );
}

function pickIdx<T>(xs: T[], idx: number[] | null): T[] {
  return idx ? idx.map(i => xs[i]) : xs;
}

export function AtmIntradaySection() {
  const [index, setIndex] = useState<AtmIntradayIndex | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [date, setDate] = useState<string>('');
  const [day, setDay] = useState<AtmDay | null>(null);
  const [series, setSeries] = useState<Series>('wed');
  const [hourly, setHourly] = useState(false);
  const [excl, setExcl] = useState(true);
  const [look, setLook] = useState(20);
  const [hist, setHist] = useState<AtmDay[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    fetchIntradayIndex(ac.signal).then(ix => {
      if (!ix || !ix.dates.length) { setState('missing'); return; }
      setIndex(ix);
      // 預設看最近一個「完整」的交易日：週末期交所會先公布週五夜盤（歸屬下週一），那天只有夜盤
      const done = ix.dates.filter(d => !(ix.partial ?? []).includes(d));
      setDate((done.length ? done : ix.dates)[(done.length ? done : ix.dates).length - 1]);
      setState('ready');
    }).catch(() => { if (!ac.signal.aborted) setState('error'); });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!date) return;
    let alive = true;
    fetchIntradayDay(date).then(d => { if (alive) setDay(d); }).catch(() => { if (alive) setDay(null); });
    return () => { alive = false; };
  }, [date]);

  useEffect(() => {
    if (!index) return;
    let alive = true;
    const ds = index.dates.slice(-look);
    Promise.all(ds.map(d => fetchIntradayDay(d).catch(() => null))).then(xs => {
      if (alive) setHist(xs.filter((x): x is AtmDay => x !== null));
    });
    return () => { alive = false; };
  }, [index, look]);

  const idx = useMemo(() => (day && hourly ? hourlyIndex(day) : null), [day, hourly]);
  const row = day ? pickRow(day, series, excl) : null;
  const other = day ? day.rows.find(r => r.s === series && row && r.r !== row.r) ?? null : null;
  const curves = useMemo(() => decayCurves(hist, series), [hist, series]);
  const sessions = useMemo(() => sessionDecay(hist, series), [hist, series]);
  const hIdx = useMemo(() => (hist[0] && hourly ? hourlyIndex(hist[0]) : null), [hist, hourly]);

  if (state === 'loading') return null;

  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-bold text-ink">盤中價平和（每 {hourly ? 60 : 15} 分鐘）</h2>
        <span className="text-[11.5px] text-faint">期交所選擇權逐筆成交 · 隔一個交易日公布</span>
      </div>
      {state !== 'ready' || !index ? (
        <p className="mt-2 text-[12.5px] text-muted">
          {state === 'missing' ? '還沒有盤中資料（每個交易日晚上更新）。' : '盤中價平和載入失敗。'}
        </p>
      ) : (
        <>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            每個時間點取該盤別 30 分鐘內最後一筆成交，價平 = |Call − Put| 最小的履約價。
            一個交易日包含<b>前一晚的夜盤</b>（15:00 ～ 05:00）與當天日盤。
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(['wed', 'fri'] as Series[]).map(s => (
              <Chip key={s} active={series === s} onClick={() => setSeries(s)}>{SERIES_LABEL[s]}</Chip>
            ))}
            <span className="mx-1 w-px self-stretch bg-line" />
            <Chip active={!hourly} onClick={() => setHourly(false)}>15 分鐘</Chip>
            <Chip active={hourly} onClick={() => setHourly(true)}>60 分鐘</Chip>
            <span className="mx-1 w-px self-stretch bg-line" />
            <Chip active={excl} onClick={() => setExcl(!excl)}>到期當日看下一口</Chip>
            <select value={date} onChange={e => setDate(e.target.value)}
                    className="h-8 rounded-lg border border-line bg-bg px-2 text-[12.5px] text-ink">
              {[...index.dates].reverse().map(d => <option key={d} value={d}>{d}{(index.partial ?? []).includes(d) ? "（僅夜盤）" : ""}</option>)}
            </select>
          </div>

          {day && row ? (
            <>
              <div className="mt-2 text-[12px] text-muted">
                {row.c}（到期 {row.e}，剩 {row.dte} 天）
                {other && <>　虛線：{other.c}（剩 {other.dte} 天）</>}
              </div>
              <TimeChart
                labels={pickIdx(day.t, idx)} sess={pickIdx(day.sess, idx)}
                fmt={v => nf0.format(v)}
                lines={[
                  { key: 'a', label: row.c, color: '#ef4444', values: pickIdx(sums(row), idx) },
                  ...(other ? [{ key: 'b', label: other.c, color: '#3b82f6', values: pickIdx(sums(other), idx), dashed: true }] : []),
                ]}
                tip={i => {
                  const j = idx ? idx[i] : i;
                  const syn = synthetic(row)[j];
                  return row.k[j] === null ? [] : [
                    `價平 ${nf0.format(row.k[j] as number)}`,
                    `C ${nf1.format(row.call[j] as number)} / P ${nf1.format(row.put[j] as number)}`,
                    syn === null ? '' : `合成期貨 ${nf0.format(syn)}`,
                  ];
                }} />
            </>
          ) : (
            <p className="mt-2 text-[12.5px] text-muted">{day ? '這一天沒有這個系列的資料' : '載入中…'}</p>
          )}

          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[13px] font-bold text-ink">時間價值在一天中怎麼流失（最近 {hist.length} 天，最近到期那口）</h3>
            <div className="flex gap-1.5">
              {LOOKBACK.map(n => <Chip key={n} active={look === n} onClick={() => setLook(n)}>{n} 天</Chip>)}
            </div>
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            每天以第一個有報價的時間點為 100%，線是之後剩下的比例（中位數），依剩餘天數分組。
            線越往下掉，代表那段時間賣方收到的時間價值越多；但價平和也會因為行情大幅波動而上升，
            所以這是「通常」的樣子，不保證每一天。
          </p>
          {hist[0] && curves.length > 0 && (
            <TimeChart
              labels={pickIdx(hist[0].t, hIdx)} sess={pickIdx(hist[0].sess, hIdx)}
              fmt={v => pct(v)}
              lines={curves.map((c, i) => ({
                key: String(c.dte), color: COLORS[i % COLORS.length],
                label: `剩 ${c.dte} 天（${c.days} 天樣本）`, values: pickIdx(c.ratio, hIdx),
              }))} />
          )}
          {sessions.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-[12.5px]">
                <thead className="text-muted">
                  <tr className="border-b border-line">
                    <th className="py-1.5 text-left font-semibold">剩餘天數</th>
                    <th className="text-right font-semibold">樣本</th>
                    <th className="text-right font-semibold">起點價平和</th>
                    <th className="text-right font-semibold">夜盤流失</th>
                    <th className="text-right font-semibold">隔夜到開盤</th>
                    <th className="text-right font-semibold">日盤流失</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {sessions.map(s => {
                    const c = curves.find(x => x.dte === s.dte);
                    return (
                      <tr key={s.dte} className="border-b border-line/60">
                        <td className="py-1.5 font-sans">剩 {s.dte} 天</td>
                        <td className="text-right">{s.days}</td>
                        <td className="text-right">{c?.start == null ? '—' : nf0.format(c.start)}</td>
                        <td className="text-right">{pct(s.night)}</td>
                        <td className="text-right">{pct(s.gap)}</td>
                        <td className="text-right">{pct(s.day)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-faint">
                正數 = 價平和變便宜（對賣方有利），負數 = 變貴。各欄是中位數，樣本少的列參考就好。
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
