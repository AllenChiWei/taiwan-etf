/* 個股財務分析儀表板（BI 風格）：指標磚、杜邦 ROE 拆解、趨勢小圖。
 *
 * 資料在打開個股時才由瀏覽器向 FinMind 抓（api/finmind.ts），計算在 lib/fundamentals.ts。
 * 面板刻意用固定的深色配色 —— 站主要的是「BI 工具、科技感」，淺色主題下也維持深色面板，
 * 紅漲綠跌的語意照舊。 */

import { useEffect, useMemo, useState } from 'react';
import { fetchFundamentals } from '../api/finmind';
import {
  parseQuarters, computeRatios, yoyDelta, dupontDrivers,
  type Ratios,
} from '../lib/fundamentals';

// 面板自己的配色（不跟主題）：深藍底、青色強調，數字用等寬字
const C = {
  bg: '#0b1220', panel: '#111a2e', border: '#1e2a44', grid: '#1e2a44',
  text: '#e6edf7', muted: '#8ea0bf', faint: '#5b6b88',
  cyan: '#22d3ee', violet: '#a78bfa', amber: '#fbbf24', pink: '#f472b6',
  up: '#f87171', down: '#34d399',
};

const f1 = (v: number | null, unit = '') => (v === null ? '—' : `${v.toFixed(1)}${unit}`);
const f2 = (v: number | null, unit = '') => (v === null ? '—' : `${v.toFixed(2)}${unit}`);
const f0 = (v: number | null, unit = '') => (v === null ? '—' : `${Math.round(v)}${unit}`);
const yi = (v: number | null) => (v === null ? '—' : `${(v / 1e8).toLocaleString('zh-TW', { maximumFractionDigits: 0 })} 億`);

/** 迷你走勢線。 */
function Spark({ values, color }: { values: (number | null)[]; color: string }) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return <div className="h-7" />;
  const lo = Math.min(...nums); const hi = Math.max(...nums); const span = hi - lo || 1;
  const W = 100; const H = 28;
  const pts = values.map((v, i) => (v === null ? null
    : `${(i / (values.length - 1)) * W},${H - 2 - ((v - lo) / span) * (H - 4)}`)).filter(Boolean);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-7 w-full" role="presentation">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.8}
                vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** 指標磚：大數字、跟一年前比、走勢線。better = 數字變大是好事還是壞事（天數、負債比是越小越好）。 */
function Kpi({ label, value, delta, deltaUnit, series, color, better = 'up' }: {
  label: string; value: string; delta: number | null; deltaUnit: string;
  series: (number | null)[]; color: string; better?: 'up' | 'down';
}) {
  const good = delta === null ? null : (better === 'up' ? delta > 0 : delta < 0);
  return (
    <div className="rounded-lg p-2.5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
      <div className="text-[11px] tracking-wide" style={{ color: C.muted }}>{label}</div>
      <div className="mt-0.5 font-mono text-[20px] font-bold tabular-nums" style={{ color: C.text }}>{value}</div>
      <div className="font-mono text-[11px] tabular-nums"
           style={{ color: delta === null ? C.faint : good ? C.up : C.down }}>
        {delta === null ? '—' : `${delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} ${Math.abs(delta).toFixed(1)}${deltaUnit} YoY`}
      </div>
      <Spark values={series} color={color} />
    </div>
  );
}

/** 趨勢小圖：多條線、三條橫格線、最後一點的數值。 */
function Trend({ title, labels, lines, unit }: {
  title: string; labels: string[];
  lines: { name: string; color: string; values: (number | null)[] }[]; unit: string;
}) {
  const nums = lines.flatMap(l => l.values).filter((v): v is number => v !== null);
  const W = 320; const H = 130; const L = 34; const R = 8; const T = 8; const B = 20;
  if (nums.length < 2) return null;
  let lo = Math.min(...nums); let hi = Math.max(...nums);
  if (lo > 0 && lo / (hi || 1) < 0.6) lo = 0;                    // 差距大時從 0 起畫，比較不誇張
  const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
  const x = (i: number) => L + (i / Math.max(1, labels.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  return (
    <div className="rounded-lg p-2.5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-[12px] font-bold" style={{ color: C.text }}>{title}</span>
        <span className="flex flex-wrap gap-x-2 text-[10.5px]">
          {lines.map(l => (
            <span key={l.name} style={{ color: l.color }}>● {l.name}</span>
          ))}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={title}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={C.grid} strokeDasharray="2 3" />
            <text x={L - 4} y={y(t) + 3} textAnchor="end" fontSize="9" fill={C.faint}>
              {Math.abs(t) >= 1000 ? `${(t / 1000).toFixed(0)}k` : t.toFixed(Math.abs(t) < 10 ? 1 : 0)}
            </text>
          </g>
        ))}
        {labels.map((lab, i) => (i % 2 === labels.length % 2 || i === labels.length - 1) && (
          <text key={lab} x={x(i)} y={H - 5} textAnchor="middle" fontSize="8.5" fill={C.faint}>{lab.slice(2)}</text>
        ))}
        {lines.map(l => {
          const pts = l.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
          const lastI = l.values.map((v, i) => (v === null ? -1 : i)).filter(i => i >= 0).pop();
          return (
            <g key={l.name}>
              <polyline points={pts.join(' ')} fill="none" stroke={l.color} strokeWidth={2} />
              {lastI !== undefined && (
                <circle cx={x(lastI)} cy={y(l.values[lastI]!)} r={2.8} fill={l.color} />
              )}
            </g>
          );
        })}
      </svg>
      <div className="text-right text-[10px]" style={{ color: C.faint }}>單位：{unit}</div>
    </div>
  );
}

const DRIVER_LABEL = { netMargin: '淨利率', assetTurnover: '資產週轉率', equityMultiplier: '權益乘數' } as const;

export function FundamentalsBoard({ code }: { code: string }) {
  const [state, setState] = useState<{ rows: Ratios[] | null; error: string | null }>({ rows: null, error: null });

  useEffect(() => {
    const ac = new AbortController();
    setState({ rows: null, error: null });
    fetchFundamentals(code, ac.signal)
      .then(d => {
        if (ac.signal.aborted) return;
        const rows = computeRatios(parseQuarters(d.income, d.balance, d.cashflow));
        setState({ rows, error: rows.length ? null : 'FinMind 沒有這一檔的財報' });
      })
      .catch((e: Error) => { if (!ac.signal.aborted) setState({ rows: null, error: e.message }); });
    return () => ac.abort();
  }, [code]);

  const view = useMemo(() => {
    const all = state.rows;
    if (!all) return null;
    // 只畫算得出 TTM 的季（最近 8 季）
    const rows = all.filter(r => r.roe !== null || r.gm !== null).slice(-8);
    if (!rows.length) return null;
    const last = rows[rows.length - 1];
    const yearAgo = rows.length >= 5 ? rows[rows.length - 5] : null;
    return { rows, last, drivers: yearAgo ? dupontDrivers(last, yearAgo) : null, yearAgo };
  }, [state.rows]);

  return (
    <section className="mt-3 overflow-hidden rounded-xl p-3.5 sm:p-4"
             style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-sm font-bold tracking-wide" style={{ color: C.cyan }}>
          ◆ 財務分析儀表板
        </h2>
        <span className="font-mono text-[11px]" style={{ color: C.faint }}>
          {view ? `${view.last.label} · TTM · 近 ${view.rows.length} 季` : 'FinMind'}
        </span>
      </div>

      {!state.rows && !state.error && (
        <p className="py-10 text-center text-[13px]" style={{ color: C.muted }}>載入財報中…</p>
      )}
      {state.error && (
        <p className="py-8 text-center text-[13px]" style={{ color: C.muted }}>{state.error}</p>
      )}

      {view && (() => {
        const { rows, last, drivers } = view;
        const labels = rows.map(r => r.label);
        const s = (k: keyof Ratios) => rows.map(r => r[k] as number | null);
        const hasInv = last.invTurnover !== null;
        return (
          <>
            {/* 指標磚 */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="ROE（股東權益報酬率）" value={f1(last.roe, '%')} delta={yoyDelta(rows, 'roe')} deltaUnit="pt"
                   series={s('roe')} color={C.cyan} />
              <Kpi label="淨利率" value={f1(last.netMargin, '%')} delta={yoyDelta(rows, 'netMargin')} deltaUnit="pt"
                   series={s('netMargin')} color={C.violet} />
              <Kpi label="毛利率（單季）" value={f1(last.gm, '%')} delta={yoyDelta(rows, 'gm')} deltaUnit="pt"
                   series={s('gm')} color={C.amber} />
              <Kpi label="自由現金流（TTM）" value={yi(last.fcf)} delta={null} deltaUnit=""
                   series={s('fcf')} color={C.pink} />
              <Kpi label="存貨週轉天數" value={hasInv ? f0(last.dio, ' 天') : '不適用'} delta={yoyDelta(rows, 'dio')}
                   deltaUnit=" 天" series={s('dio')} color={C.cyan} better="down" />
              <Kpi label="現金轉換循環" value={last.ccc === null ? '不適用' : f0(last.ccc, ' 天')} delta={yoyDelta(rows, 'ccc')}
                   deltaUnit=" 天" series={s('ccc')} color={C.violet} better="down" />
              <Kpi label="負債比率" value={f1(last.debt, '%')} delta={yoyDelta(rows, 'debt')} deltaUnit="pt"
                   series={s('debt')} color={C.amber} better="down" />
              <Kpi label="營業現金流 ÷ 淨利" value={f2(last.cashQuality, ' 倍')} delta={yoyDelta(rows, 'cashQuality')}
                   deltaUnit="" series={s('cashQuality')} color={C.pink} />
            </div>

            {/* 杜邦拆解樹 */}
            <div className="mt-3 rounded-lg p-3" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              <div className="text-[12px] font-bold" style={{ color: C.text }}>杜邦分析：ROE 是怎麼來的</div>
              <div className="mt-2 flex flex-col items-center">
                <div className="rounded-lg px-4 py-2 text-center" style={{ border: `1.5px solid ${C.cyan}`, background: '#0e2233' }}>
                  <div className="text-[11px]" style={{ color: C.muted }}>ROE</div>
                  <div className="font-mono text-[24px] font-bold tabular-nums" style={{ color: C.cyan }}>{f1(last.roe, '%')}</div>
                </div>
                <div className="h-3 w-px" style={{ background: C.border }} />
                <div className="grid w-full grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1 text-center">
                  {([['netMargin', '淨利率', f1(last.netMargin, '%'), '賺得多', C.violet],
                     null,
                     ['assetTurnover', '資產週轉率', f2(last.assetTurnover, ' 次'), '轉得快', C.amber],
                     null,
                     ['equityMultiplier', '權益乘數', f2(last.equityMultiplier, ' 倍'), '借得多', C.pink]] as const)
                    .map((b, i) => b === null
                      ? <span key={i} className="font-mono text-[16px]" style={{ color: C.faint }}>×</span>
                      : (
                        <div key={b[0]} className="rounded-lg px-1.5 py-2" style={{ border: `1px solid ${b[4]}55`, background: '#0f1a30' }}>
                          <div className="text-[10.5px]" style={{ color: C.muted }}>{b[1]}</div>
                          <div className="font-mono text-[15px] font-bold tabular-nums" style={{ color: b[4] }}>{b[2]}</div>
                          <div className="text-[10px]" style={{ color: C.faint }}>{b[3]}</div>
                        </div>
                      ))}
                </div>
              </div>
              {drivers && view.yearAgo && (
                <div className="mt-3">
                  <div className="text-[11.5px]" style={{ color: C.muted }}>
                    跟一年前（{view.yearAgo.label}，ROE {f1(view.yearAgo.roe, '%')}）比，變化主要來自：
                  </div>
                  <div className="mt-1.5 flex h-3 overflow-hidden rounded-full">
                    {drivers.map(d => (
                      <div key={d.key} style={{ width: `${d.share}%`,
                        background: d.key === 'netMargin' ? C.violet : d.key === 'assetTurnover' ? C.amber : C.pink }} />
                    ))}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[11px]">
                    {drivers.map(d => (
                      <span key={d.key} style={{ color: C.text }}>
                        {DRIVER_LABEL[d.key]} <span className="font-mono">{d.share.toFixed(0)}%</span>
                        <span style={{ color: d.up ? C.up : C.down }}> {d.up ? '↑' : '↓'}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 趨勢小圖 */}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Trend title="獲利能力（單季）" labels={labels} unit="%" lines={[
                { name: '毛利率', color: C.amber, values: s('gm') },
                { name: '營益率', color: C.cyan, values: s('om') },
                { name: '淨利率', color: C.violet, values: s('nm') },
              ]} />
              <Trend title="杜邦：ROE 與 ROA（TTM）" labels={labels} unit="%" lines={[
                { name: 'ROE', color: C.cyan, values: s('roe') },
                { name: 'ROA', color: C.pink, values: s('roa') },
              ]} />
              {hasInv && (
                <Trend title="經營效率（天數）" labels={labels} unit="天" lines={[
                  { name: '存貨', color: C.amber, values: s('dio') },
                  { name: '應收', color: C.cyan, values: s('dso') },
                  { name: '應付', color: C.pink, values: s('dpo') },
                  { name: '現金循環', color: C.violet, values: s('ccc') },
                ]} />
              )}
              <Trend title="現金流（TTM，億元）" labels={labels} unit="億元" lines={[
                { name: '營業現金流', color: C.cyan, values: s('ocf').map(v => (v === null ? null : v / 1e8)) },
                { name: '資本支出', color: C.pink, values: s('capex').map(v => (v === null ? null : v / 1e8)) },
                { name: '自由現金流', color: C.amber, values: s('fcf').map(v => (v === null ? null : v / 1e8)) },
              ]} />
              <Trend title="財務結構" labels={labels} unit="倍" lines={[
                { name: '流動比率', color: C.cyan, values: s('current') },
                { name: '速動比率', color: C.violet, values: s('quick') },
              ]} />
              {hasInv && (
                <Trend title="存貨週轉率（TTM）" labels={labels} unit="次／年" lines={[
                  { name: '存貨週轉率', color: C.amber, values: s('invTurnover') },
                ]} />
              )}
            </div>

            <p className="mt-3 text-[11px] leading-relaxed" style={{ color: C.faint }}>
              比率用近四季合計（TTM）的損益與現金流，除以一年前與現在的平均餘額；毛利率等獲利率是單季。
              ROE 用歸屬母公司的淨利與權益。存貨週轉率 = 營業成本 ÷ 平均存貨，天數 = 365 ÷ 週轉率；
              現金轉換循環 = 存貨天數 + 應收天數 − 應付天數，越短代表錢被卡在營運裡的時間越短。
              ▲▼ 是跟一年前同一季比，紅色代表變好、綠色代表變差（天數與負債比是越低越好）。
              金融業沒有存貨與營業成本，那幾格顯示不適用。資料：FinMind（公開資訊觀測站財報），打開時即時抓取。
            </p>
          </>
        );
      })()}
    </section>
  );
}
