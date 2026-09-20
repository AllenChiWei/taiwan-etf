/* 個股儀表板的面板。
 *
 * 從 routes/StockPage.tsx 抽出來，因為**同一組面板要出現在兩個地方**：
 * 個股頁本身，以及創新高／漲跌幅／法人買賣超那些清單裡點一檔就滑出來的抽屜。
 * 抽屜要的是「看完就關、留在原來的位置」，所以它不能是換頁 —— 換頁回來
 * 捲動位置就沒了，那正是使用者要避免的。
 *
 * 這裡只負責畫。資料由呼叫端傳進來（個股頁自己抓，抽屜也自己抓），
 * 計算全部在 lib/stock.ts。
 */

import { useMemo, useState } from 'react';
import {
  periodLabel, singleQuarter, ratios, sumInst, instTotals, toLots,
  moneyFromThousands, moneyFromYuan, isoDate, instDaily, periodReturns,
  position, percentiles,
  type StockData, type Quarter, type HighRow, type InstDay,
  type RankRow, type Percentile,
} from '../lib/stock';
import { bars, zeroY, netTone } from '../lib/chips';
import { TONE_CLASS } from '../lib/format';
import { Radar, Donut, type RadarAxis } from './Radar';

export const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
export const nf2 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });

export const pctText = (v: number | null) => (v === null ? '—' : `${nf2.format(v)}%`);
export const signedPct = (v: number | null | undefined) =>
  (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${nf2.format(v)}%`);
const lotsText = (shares: number | null) => {
  const l = toLots(shares);
  return l === null ? '—' : `${l > 0 ? '+' : ''}${nf0.format(Math.round(l))} 張`;
};

export function Chip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
        active ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
    >
      {children}
    </button>
  );
}

export function Section({ title, hint, children }: {
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

export function Cell({ label, value, tone, sub }: {
  label: string; value: string; tone?: string; sub?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-bg px-3 py-2">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-[15px] font-bold tabular-nums ${tone ?? 'text-ink'}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

/* ── 基本資料 ───────────────────────────────────────────── */

export function InfoSection({ data }: { data: StockData }) {
  const i = data.info;
  return (
    <Section title={`${data.code} ${i.name}`} hint={`${i.market}　${i.industry ?? ''}`}>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="實收資本額" value={moneyFromYuan(i.capital)} />
        <Cell label={i.market === '上市' ? '上市日' : '上櫃日'} value={isoDate(i.listed)} />
        <Cell label="董事長" value={i.chair || '—'} />
        <Cell label="公司全名" value={i.full || i.name} />
      </div>
      {i.site && (
        <a href={i.site} target="_blank" rel="noopener noreferrer"
           className="mt-2 inline-block text-[12px] text-accent hover:underline">
          公司網站 ↗
        </a>
      )}
    </Section>
  );
}

/* ── 月營收 ─────────────────────────────────────────────── */

export function RevenueSection({ data }: { data: StockData }) {
  const months = data.m;
  if (months.length === 0) {
    return (
      <Section title="月營收">
        <p className="mt-2 py-3 text-center text-[12.5px] text-muted">還沒有月營收資料。</p>
      </Section>
    );
  }
  const latest = months[months.length - 1];
  const max = Math.max(...months.map(m => Math.abs(m.rev ?? 0)), 1);

  return (
    <Section title="月營收" hint={`最新 ${latest.p}`}>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="當月營收" value={moneyFromThousands(latest.rev)} />
        <Cell label="月增 MoM" value={signedPct(latest.mom)}
              tone={TONE_CLASS[netTone(latest.mom ?? Number.NaN)]} />
        <Cell label="年增 YoY" value={signedPct(latest.yoy)}
              tone={TONE_CLASS[netTone(latest.yoy ?? Number.NaN)]} />
        <Cell label="今年累計" value={moneyFromThousands(latest.cum)}
              sub={`年增 ${signedPct(latest.cumYoy)}`} />
      </div>

      {months.length > 1 && (
        <ul className="mt-2.5 space-y-1">
          {[...months].reverse().map(m => (
            <li key={m.p} className="grid grid-cols-[4.5em_1fr_5.5em] items-center gap-2">
              <span className="font-mono text-[11.5px] text-muted">{m.p}</span>
              <span className="h-4 rounded bg-sunken">
                <span className="block h-4 rounded bg-accent/70"
                      style={{ width: `${Math.max(2, (Math.abs(m.rev ?? 0) / max) * 100)}%` }} />
              </span>
              <span className={`text-right font-mono text-[11.5px] tabular-nums
                                ${TONE_CLASS[netTone(m.yoy ?? Number.NaN)]}`}>
                {signedPct(m.yoy)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-faint">
        長條是當月營收，右邊是年增率。營收為公司自行公告，未經會計師查核。
      </p>
    </Section>
  );
}

/* ── 財報 ───────────────────────────────────────────────── */

export function FinancialSection({ data }: { data: StockData }) {
  const rows = data.q;
  const [period, setPeriod] = useState(rows.length ? rows[rows.length - 1].p : '');
  const cur: Quarter | null = rows.find(r => r.p === period) ?? null;
  const single = useMemo(() => singleQuarter(rows, period), [rows, period]);
  const r = ratios(cur);

  if (!cur) {
    return (
      <Section title="財務報表">
        <p className="mt-2 py-3 text-center text-[12.5px] text-muted">還沒有財報資料。</p>
      </Section>
    );
  }

  return (
    <Section title="財務報表" hint={periodLabel(cur.p)}>
      {rows.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[...rows].reverse().map(row => (
            <button
              key={row.p}
              type="button"
              aria-pressed={row.p === period}
              onClick={() => setPeriod(row.p)}
              className={`h-8 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
                row.p === period ? 'bg-accent text-accent-ink'
                  : 'bg-sunken text-muted hover:text-ink'}`}
            >
              {row.p}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="營業收入" value={moneyFromThousands(cur.rev)} sub="累計" />
        <Cell label="營業利益" value={moneyFromThousands(cur.op)} sub="累計" />
        <Cell label="稅後淨利" value={moneyFromThousands(cur.ni)} sub="歸屬母公司" />
        <Cell label="每股盈餘" value={cur.eps === null || cur.eps === undefined
          ? '—' : `${nf2.format(cur.eps)} 元`} sub="累計 EPS" />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="毛利率" value={pctText(r.gm)} />
        <Cell label="營業利益率" value={pctText(r.om)} />
        <Cell label="稅後純益率" value={pctText(r.pm)} />
        <Cell label="權益報酬率" value={pctText(r.roe)} sub="該期間，未年化" />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="資產總計" value={moneyFromThousands(cur.ta)} />
        <Cell label="負債比" value={pctText(r.debt)} />
        <Cell label="流動比" value={pctText(r.current)} />
        <Cell label="每股淨值" value={cur.bv === null || cur.bv === undefined
          ? '—' : `${nf2.format(cur.bv)} 元`} />
      </div>

      {single && single.p === cur.p && cur.p.endsWith('Q1') === false && (
        <div className="mt-2 rounded-lg border border-line bg-bg px-3 py-2">
          <div className="text-[11.5px] text-muted">單季（扣掉前一期累計）</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
            <span>營收 <span className="font-mono font-semibold">
              {moneyFromThousands(single.rev)}</span></span>
            <span>稅後淨利 <span className="font-mono font-semibold">
              {moneyFromThousands(single.ni)}</span></span>
            <span>EPS <span className="font-mono font-semibold">
              {single.eps === null || single.eps === undefined
                ? '—' : `${nf2.format(single.eps)} 元`}</span></span>
          </div>
        </div>
      )}

      <p className="mt-2 text-[11px] text-faint">
        觀測站公佈的是<strong className="font-semibold">累計數</strong>：第二季是上半年、
        第三季是前三季。單季要有連續兩期才算得出來，這份資料從啟用日起逐期累積。
      </p>
    </Section>
  );
}

/* ── 籌碼 ───────────────────────────────────────────────── */

/* ── 位階：這檔站在自己的高低區間哪裡 ─────────────────── */

const POS_WINDOWS = [150, 200, 250];

export function PositionSection({ row }: { row: HighRow | null }) {
  const [win, setWin] = useState(250);
  const pos = position(row, win);
  const rets = periodReturns(row);

  if (!row) return null;

  return (
    <Section title="位階與漲跌幅" hint={`近 ${win} 個交易日`}>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {POS_WINDOWS.map(w => (
          <Chip key={w} active={win === w} onClick={() => setWin(w)}>{w} 日</Chip>
        ))}
      </div>

      {pos ? (
        <div className="mt-2.5">
          {/* 一條軸把「距高點」「距低點」放在同一個畫面上 —— 分開講兩個百分比
              很難在腦中拼回位置，一條線就看得出是在高檔還是低檔 */}
          <div className="relative h-7">
            <div className="absolute inset-x-0 top-3 h-1.5 rounded-full bg-sunken" />
            <div className="absolute top-3 h-1.5 rounded-full bg-accent"
                 style={{ width: `${pos.pos}%` }} />
            <div className="absolute top-1.5 h-4.5 w-1 -translate-x-1/2 rounded-full bg-ink"
                 style={{ left: `${pos.pos}%` }} />
          </div>
          <div className="flex justify-between font-mono text-[11px] tabular-nums text-faint">
            <span>低 {nf2.format(pos.low)}</span>
            <span className="text-ink">收 {nf2.format(pos.price)}</span>
            <span>高 {nf2.format(pos.high)}</span>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <Cell label="距高點" value={`${nf2.format(pos.fromHigh)}%`}
                  tone={pos.fromHigh >= 0 ? 'up' : 'down'}
                  sub={pos.isHigh ? '今天創新高' : undefined} />
            <Cell label="距低點" value={`+${nf2.format(pos.fromLow)}%`} tone="up"
                  sub={pos.isLow ? '今天創新低' : undefined} />
          </div>
        </div>
      ) : (
        <p className="mt-2 py-3 text-center text-[12.5px] text-muted">
          這檔沒有近 {win} 個交易日的資料（可能是上市未滿這個期間）。
        </p>
      )}

      <div className="mt-3 grid grid-cols-4 gap-2">
        {rets.map(r => (
          <div key={r.key} className="rounded-lg border border-line bg-bg px-2 py-1.5 text-center">
            <div className="text-[11px] text-muted">{r.label}</div>
            <div className={`mt-0.5 font-mono text-[13px] font-bold tabular-nums ${
              r.value === null ? 'text-faint' : TONE_CLASS[r.value >= 0 ? 'up' : 'down']}`}>
              {r.value === null ? '—' : `${r.value >= 0 ? '+' : ''}${nf2.format(r.value)}%`}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        高低點與漲跌幅都以還原股價計算（除權息與分割不會造成假性創低），
        顯示的收盤價則是原始股價。期間以交易日計：一週 5 日、一月 20 日、
        一季 60 日、半年 120 日；上市未滿該期間的顯示「—」而不是 0%。
      </p>
    </Section>
  );
}

/* ── 相對位置：這檔在全市場與同業站在哪裡 ─────────────── */

function PercentileBar({ p, scope }: { p: Percentile; scope: 'market' | 'peer' }) {
  const v = scope === 'market' ? p.market : p.peer;
  const n = scope === 'market' ? p.nMarket : p.nPeer;
  if (p.value === null) return null;
  return (
    <div className="border-b border-line/60 py-2 last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-ink">{p.label}</span>
        <span className={`font-mono text-[12.5px] font-semibold tabular-nums ${
          TONE_CLASS[p.value >= 0 ? 'up' : 'down']}`}>
          {p.value >= 0 ? '+' : ''}{nf2.format(p.value)}{p.unit}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        {/* block 不能省：span 預設是 inline，寬度會縮成內容大小，長條就撐不開 */}
        <span className="block h-1.5 flex-1 rounded-full bg-sunken">
          <span className="block h-full rounded-full bg-accent"
                style={{ width: `${v ?? 0}%` }} />
        </span>
        <span className="w-24 shrink-0 text-right font-mono text-[11px] tabular-nums text-faint">
          {v === null ? '—' : `贏過 ${nf0.format(v)}%`}
        </span>
      </div>
      <span className="mt-0.5 block text-[10.5px] text-faint">
        {scope === 'market' ? `全市場 ${n} 檔` : `同業 ${n} 檔`}
      </span>
    </div>
  );
}

export function PercentileSection(
  { row, allHighs, rank, allRanks }: {
    row: HighRow | null; allHighs: HighRow[];
    rank: RankRow | null; allRanks: RankRow[];
  },
) {
  const rows = useMemo(
    () => percentiles({ high: row, allHighs, rank, allRanks, window: 250 })
      .filter(p => p.value !== null),
    [row, allHighs, rank, allRanks]);

  const [scope, setScope] = useState<'market' | 'peer'>('market');
  const axes: RadarAxis[] = rows.map(p => ({
    label: p.label.replace('近一', '').replace('月營收', '營收').replace('累計營收', '累計'),
    value: scope === 'market' ? p.market : p.peer,
  }));

  if (rows.length === 0) return null;

  return (
    <Section title="相對位置" hint={rank?.i || undefined}>
      <p className="mt-1 text-[11px] leading-snug text-faint">
        每一條是「這檔贏過多少比例的標的」。<strong className="text-muted">
        沒有加權、沒有總分、沒有評級</strong> —— 那種分數的權重是憑空定的，
        換一組權重就換一個結論，而看的人看不到那組權重。百分位不需要權重，
        而且可以自己查證。
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip active={scope === 'market'} onClick={() => setScope('market')}>全市場</Chip>
        <Chip active={scope === 'peer'} onClick={() => setScope('peer')}>
          同業{rows[0]?.nPeer ? ` ${rows[0].nPeer} 檔` : ''}
        </Chip>
      </div>

      {/* 雷達圖的每一軸都是 0–100 的百分位，刻度一致 —— 這是雷達圖唯一
          說得過去的用法，形狀才真的代表什麼 */}
      {/* 不要在 flex-col 上加 items-center：那會讓子元素縮成內容寬度，
          底下那些百分位長條就撐不開（flex-1 在直向容器管的是高度不是寬度）。
          雷達圖自己用 self-center 置中就好。 */}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="w-full max-w-[260px] shrink-0 self-center">
          <Radar axes={axes} />
        </div>
        <div className="min-w-0 flex-1">
          {rows.map(p => <PercentileBar key={p.key} p={p} scope={scope} />)}
        </div>
      </div>
    </Section>
  );
}

/* ── 籌碼結構與多空能量 ─────────────────────────────────── */

export function ChipsVisual({ data }: { data: StockData }) {
  const c = data.chips;
  const rows = useMemo(() => (c ? instDaily(c) : []), [c]);
  if (!c) return null;

  // 近 20 日：買超的量與賣超的量各佔多少 —— 只看淨額會把「大買大賣」
  // 跟「都沒在動」畫成同一個樣子
  const buy = rows.reduce((a, r) => a + Math.max(0, r.total ?? 0), 0);
  const sell = rows.reduce((a, r) => a + Math.min(0, r.total ?? 0), 0);
  const span = buy - sell;
  const bullPct = span > 0 ? (buy / span) * 100 : 50;

  const donuts: Array<{ label: string; value: number | null; text?: string }> = [
    { label: '外資持股', value: c.qfii ?? null },
    { label: '400 張以上', value: c.tdcc?.big ?? null },
    { label: '千張以上', value: c.tdcc?.huge ?? null },
  ];

  return (
    <Section title="籌碼結構" hint={c.tdccDate ? `集保 ${c.tdccDate}` : undefined}>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {donuts.map(d => (
          d.value === null
            ? <div key={d.label} className="text-center text-[12px] text-faint">—</div>
            : <Donut key={d.label} label={d.label} value={d.value} />
        ))}
      </div>

      <h3 className="mt-3 text-[12.5px] font-bold text-ink">
        多空能量（近 {rows.length} 個交易日）
      </h3>
      <div className="mt-1 flex h-6 overflow-hidden rounded-lg bg-sunken">
        <div className="flex items-center justify-start bg-up/85 pl-2 text-[11px] font-semibold text-white"
             style={{ width: `${bullPct}%` }}>
          {bullPct >= 22 ? `買 ${nf0.format(buy)} 張` : ''}
        </div>
        <div className="flex flex-1 items-center justify-end bg-down/85 pr-2 text-[11px] font-semibold text-white">
          {bullPct <= 78 ? `賣 ${nf0.format(Math.abs(sell))} 張` : ''}
        </div>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-faint">
        把每天的三大法人合計拆成買超與賣超兩堆再比大小。只看淨額的話，
        「大買大賣抵銷掉」跟「整段都沒人動」會長得一模一樣，但那是兩回事。
        圓環是持股結構：外資持股與集保的大戶比例越高，籌碼越集中。
      </p>
    </Section>
  );
}

/* ── 三大法人每日買賣超 ─────────────────────────────────── */

const INST_KEYS = [
  { key: 'foreign' as const, label: '外資' },
  { key: 'trust' as const, label: '投信' },
  { key: 'dealer' as const, label: '自營商' },
];

export function InstDailySection({ data }: { data: StockData }) {
  const rows = useMemo(() => (data.chips ? instDaily(data.chips) : []), [data.chips]);
  if (rows.length === 0) return null;

  // 三家共用同一個刻度，否則「投信買 50 張」的柱子會跟「外資買 5000 張」一樣高
  const peak = Math.max(1, ...rows.flatMap(r =>
    INST_KEYS.map(k => Math.abs(r[k.key] ?? 0))));

  return (
    <Section title="三大法人每日買賣超"
             hint={`近 ${rows.length} 個交易日 · 張`}>
      <div className="mt-2 space-y-2.5">
        {INST_KEYS.map(k => {
          const sum = rows.reduce((a: number, r: InstDay) => a + (r[k.key] ?? 0), 0);
          return (
            <div key={k.key}>
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] text-ink">{k.label}</span>
                <span className={`font-mono text-[12px] font-semibold tabular-nums ${
                  TONE_CLASS[sum >= 0 ? 'up' : 'down']}`}>
                  {sum >= 0 ? '+' : ''}{nf0.format(sum)} 張
                </span>
              </div>
              {/* 零軸在中間，紅柱往上、綠柱往下 —— 跟籌碼頁的法人圖同一個畫法 */}
              <div className="mt-1 flex h-10 items-center gap-px">
                {rows.map((r: InstDay) => {
                  const v = r[k.key];
                  // 最小高度 10（約 2px）。共用刻度時，投信的 +107 張跟外資的
                  // −3,950 張比起來不到 3%，用 1 就細到看不見 —— 而「看不見」
                  // 跟「那天沒資料」在畫面上會變成同一件事。
                  const h = v === null ? 0 : Math.max(10, (Math.abs(v) / peak) * 100);
                  return (
                    <div key={r.date} className="relative h-full flex-1" title={`${r.date} ${v ?? '—'} 張`}>
                      <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
                      {v !== null && (
                        <div className={`absolute inset-x-0 ${v >= 0 ? 'bottom-1/2' : 'top-1/2'} ${
                          v >= 0 ? 'bg-up' : 'bg-down'}`}
                             style={{ height: `${h / 2}%` }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        每根是一個交易日，紅柱買超、綠柱賣超，三家共用同一個刻度所以高度可以互相比。
        沒有柱子代表那天還沒有資料，不是買賣超為零。
      </p>
    </Section>
  );
}

export function ChipsSection({ data }: { data: StockData }) {
  const c = data.chips;
  const d1 = sumInst(c, 1);
  const d5 = sumInst(c, 5);
  const d20 = sumInst(c, 20);
  const totals = instTotals(c);

  const W = 320;
  const H = 46;
  // 與籌碼頁同一種資料（每日淨額），所以同樣用柱狀圖：紅買綠賣，一眼看正負
  const rects = bars(totals, W, H);
  const z = zeroY(totals, H);

  return (
    <Section title="籌碼" hint={c.date ? `買賣超資料日 ${c.date}` : undefined}>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Cell label="外資" value={lotsText(d1.foreign)}
              tone={TONE_CLASS[netTone(d1.foreign)]} sub="當日" />
        <Cell label="投信" value={lotsText(d1.trust)}
              tone={TONE_CLASS[netTone(d1.trust)]} sub="當日" />
        <Cell label="自營商" value={lotsText(d1.dealer)}
              tone={TONE_CLASS[netTone(d1.dealer)]} sub="當日" />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Cell label={`近 5 日三大法人`} value={lotsText(d5.foreign + d5.trust + d5.dealer)}
              tone={TONE_CLASS[netTone(d5.foreign + d5.trust + d5.dealer)]}
              sub={`實際 ${d5.days} 個交易日`} />
        <Cell label={`近 20 日三大法人`} value={lotsText(d20.foreign + d20.trust + d20.dealer)}
              tone={TONE_CLASS[netTone(d20.foreign + d20.trust + d20.dealer)]}
              sub={`實際 ${d20.days} 個交易日`} />
      </div>

      {rects.length > 1 && (
        <div className="mt-2 rounded-lg border border-line bg-bg p-2.5">
          <div className="text-[11.5px] text-muted">三大法人每日合計（張）</div>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="presentation"
               className="mt-1 h-12 w-full">
            {z !== null && (
              <line x1="0" x2={W} y1={z} y2={z} stroke="currentColor"
                    className="text-line" strokeWidth="1" strokeDasharray="3 3" />
            )}
            {rects.map((b, i) => (
              <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h}
                    className={b.up ? 'fill-up' : 'fill-down'} />
            ))}
          </svg>
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="融資餘額" value={c.margin?.mb === null || c.margin?.mb === undefined
          ? '—' : `${nf0.format(c.margin.mb)} 張`}
              sub={c.margin?.use ? `使用率 ${nf2.format(c.margin.use)}%` : undefined} />
        <Cell label="融券餘額" value={c.margin?.sb === null || c.margin?.sb === undefined
          ? '—' : `${nf0.format(c.margin.sb)} 張`} />
        <Cell label="外資持股" value={c.qfii === null || c.qfii === undefined
          ? '—' : `${nf2.format(c.qfii)}%`} sub="含陸資" />
        <Cell label="千張大戶" value={c.tdcc?.huge === null || c.tdcc?.huge === undefined
          ? '—' : `${nf2.format(c.tdcc.huge)}%`}
              sub={c.tdccDate ? `集保 ${c.tdccDate}` : undefined} />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Cell label="400 張以上持股" value={c.tdcc?.big === null || c.tdcc?.big === undefined
          ? '—' : `${nf2.format(c.tdcc.big)}%`} sub="占集保庫存" />
        <Cell label="集保股東人數" value={c.tdcc?.holders
          ? `${nf0.format(c.tdcc.holders)} 人` : '—'} />
      </div>

      <p className="mt-2 text-[11px] text-faint">
        買賣超為交易所公佈的股數，這裡換算成張（紅買綠賣）。集保股權分散表每週更新一次，
        所以它的日期與買賣超不同天。近 N 日只累計有資料的交易日。
      </p>
    </Section>
  );
}

