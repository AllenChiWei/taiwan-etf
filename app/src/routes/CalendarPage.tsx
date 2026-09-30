/* 台股行事曆：接下來哪天有什麼事。
 *
 * 除權息與股東會是交易所的公告（scripts/fetch_calendar.py）；財報與月營收的法定期限、
 * 期貨月結算日是依規則推算（lib/calendar.ts），畫面上標「規則」以示區別。
 *
 * 「只看我的」＝收藏 ∪ 配息試算裡的持股。規則事件跟每一檔都有關，所以照樣顯示。
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { fetchCalendar, fetchEtfDividends, fetchYields } from '../api/extras';
import {
  allEvents, filterEvents, groupByDate, dayLabel, daysUntil, KIND_LABEL,
  etfExDivMonth, shiftMonth,
  type CalendarData, type EventKind, type CalEvent, type EtfInfo, type EtfExDivRow,
} from '../lib/calendar';
import type { EtfDividendData, YieldData } from '../lib/dividend';
import { useEtfData, useFavoritesApi } from '../context/AppContext';
import { EmptyState } from '../components/EmptyState';

const KINDS: EventKind[] = ['exdiv', 'meeting', 'report', 'revenue', 'settle'];

const KIND_CLASS: Record<EventKind, string> = {
  exdiv: 'bg-accent-soft text-accent',
  meeting: 'bg-sunken text-ink',
  report: 'bg-sunken text-muted',
  revenue: 'bg-sunken text-muted',
  settle: 'bg-sunken text-muted',
};

/** 台北的今天。用 sv-SE 是因為它的日期格式剛好是 YYYY-MM-DD。 */
function taipeiToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 配息試算的持股代號。讀不到就當沒有 —— 這只是篩選的便利功能。 */
function holdingCodes(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem('twetf.holdings') ?? '[]');
    if (!Array.isArray(v)) return [];
    return v.filter(x => x && typeof x.code === 'string' && x.m !== 'us').map(x => x.code as string);
  } catch {
    return [];
  }
}

function when(n: number): string {
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  return `${n} 天後`;
}

function EventRow({ e }: { e: CalEvent }) {
  const isStock = e.code !== null && /^\d{4}$/.test(e.code);
  return (
    <li className="flex gap-2.5 border-b border-line/60 py-2 last:border-0">
      <span className={`mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${KIND_CLASS[e.kind]}`}>
        {KIND_LABEL[e.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {e.code && (
            isStock
              ? <Link to="/stock" search={{ code: e.code }}
                      className="font-mono text-[12.5px] font-bold text-accent hover:underline">{e.code}</Link>
              : <span className="font-mono text-[12.5px] font-bold text-muted">{e.code}</span>
          )}
          <span className="text-[13.5px] font-semibold text-ink">{e.title}</span>
          {!e.code && <span className="text-[10.5px] text-faint">規則</span>}
        </div>
        {e.detail && <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{e.detail}</p>}
      </div>
    </li>
  );
}

/* ───────────── ETF 除息分頁 ─────────────
 * 一次看一個月：這個月已經除息與即將除息的 ETF、每股金額。配息紀錄（dividends.json）與
 * 殖利率（yields.json）只有切到這個分頁才載入，平常看行事曆不用多抓這兩份。 */

function monthLabel(month: string): string {
  return `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5, 7))} 月`;
}

function fmtCash(v: number): string {
  return (Math.round(v * 10000) / 10000).toString();
}

function ExDivRow({ r, today, y }: { r: EtfExDivRow; today: string; y: number | null | undefined }) {
  const n = daysUntil(r.d, today);
  const status = n < 0 ? '已除息' : n === 0 ? '今天除息' : n === 1 ? '明天除息' : `${n} 天後`;
  return (
    <li className="flex items-start gap-2.5 border-b border-line/60 py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-[12.5px] font-bold text-muted">{r.code}</span>
          <span className="text-[13.5px] font-semibold text-ink">{r.name}</span>
        </div>
        <p className="mt-0.5 text-[12px] text-muted">
          {[r.freq && r.freq !== '—' ? r.freq : '',
            r.cust && r.cust !== '—' ? `保管：${r.cust}` : '',
            y != null ? `年化殖利率 ${y.toFixed(2)}%` : '',
            !r.exact ? '權息合併計價，金額可能高估' : ''].filter(Boolean).join('・')}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-[14px] font-bold text-ink">
          {r.cash === null ? <span className="text-[12px] font-semibold text-faint">金額待公告</span> : (
            <>
              {/* 交易所還沒填、先用投信公告的：預估的要標出來，實際金額可能不同 */}
              {r.ck === 'est' && (
                <span className="mr-1 rounded bg-sunken px-1 py-0.5 align-middle font-sans text-[10.5px]
                                 font-semibold text-muted">預估</span>
              )}
              {`${fmtCash(r.cash)} 元`}
            </>
          )}
        </div>
        <div className={`text-[11.5px] ${n < 0 ? 'text-faint' : n <= 1 ? 'font-semibold text-up' : 'text-muted'}`}>
          {status}
        </div>
        {r.pay && (
          <div className={`text-[11.5px] ${r.pay < today ? 'text-faint' : 'text-muted'}`}>
            {dayLabel(r.pay)} {r.pay < today ? '已發放' : '發放'}
          </div>
        )}
      </div>
    </li>
  );
}

function EtfExDivTab({ calendar, today, query, mine }: {
  calendar: CalendarData | null; today: string; query: string; mine: ReadonlySet<string> | null;
}) {
  const dataset = useEtfData();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [divs, setDivs] = useState<EtfDividendData | null>(null);
  const [yields, setYields] = useState<YieldData | null>(null);
  const [state, setState] = useState<'loading' | 'ready'>('loading');

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([fetchEtfDividends(ac.signal), fetchYields(ac.signal)])
      .then(([d, y]) => { if (!ac.signal.aborted) { setDivs(d); setYields(y); setState('ready'); } })
      .catch(() => { if (!ac.signal.aborted) setState('ready'); });
    return () => ac.abort();
  }, []);

  const etfs = useMemo(
    () => new Map<string, EtfInfo>(dataset.etfs.map(e => [e.code, { name: e.name, freq: e.freq, cust: e.cust }])),
    [dataset]);
  const rows = useMemo(
    () => etfExDivMonth(month, divs?.dividends ?? null, calendar, etfs),
    [month, divs, calendar, etfs]);

  const q = query.trim().toLowerCase();
  const shown = rows.filter(r =>
    (!mine || mine.has(r.code))
    && (!q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)));

  const groups: Array<{ d: string; items: EtfExDivRow[] }> = [];
  for (const r of shown) {
    const last = groups[groups.length - 1];
    if (last && last.d === r.d) last.items.push(r);
    else groups.push({ d: r.d, items: [r] });
  }
  const done = rows.filter(r => r.d < today).length;

  if (state === 'loading') {
    return <p className="py-12 text-center text-[13px] text-muted">載入配息資料中…</p>;
  }

  return (
    <>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="上個月"
                className="h-8 rounded-lg bg-sunken px-3 text-[13px] font-semibold text-muted hover:text-ink">‹</button>
        <span className="min-w-[7.5em] text-center text-[14px] font-bold text-ink">{monthLabel(month)}</span>
        <button type="button" onClick={() => setMonth(m => shiftMonth(m, 1))} aria-label="下個月"
                className="h-8 rounded-lg bg-sunken px-3 text-[13px] font-semibold text-muted hover:text-ink">›</button>
        {month !== today.slice(0, 7) && (
          <button type="button" onClick={() => setMonth(today.slice(0, 7))}
                  className="h-8 rounded-lg px-2 text-[12.5px] font-semibold text-accent hover:underline">回到本月</button>
        )}
      </div>
      <p className="mt-1.5 text-[12px] text-muted">
        {rows.length === 0
          ? '這個月目前沒有 ETF 除息的紀錄或預告'
          : `共 ${rows.length} 筆 ETF 除息：已除息 ${done} 筆、即將除息 ${rows.length - done} 筆`}
      </p>

      {!divs && (
        <p className="mt-3 rounded-lg border border-line bg-surface p-3 text-[12.5px] text-muted">
          這次部署沒有抓到配息紀錄，下面只列出交易所預告、還沒除息的 ETF。
        </p>
      )}

      {groups.length === 0 ? (
        rows.length > 0 && (
          <EmptyState title="沒有符合的 ETF"
                      hint={mine && mine.size === 0 ? '你還沒有收藏或配息持股。' : '換個篩選條件試試。'}
                      icon="💰" />
        )
      ) : (
        <div className="mt-3 rounded-xl border border-line bg-surface px-3.5 pb-1 sm:px-4">
          {groups.map(g => (
            <div key={g.d}>
              <div className="sticky top-[env(safe-area-inset-top,0px)] z-10 -mx-3.5 border-b border-line/60
                              bg-surface/95 px-3.5 py-1.5 backdrop-blur sm:-mx-4 sm:px-4">
                <span className="text-[12.5px] font-bold text-ink">{dayLabel(g.d)}</span>
                <span className="ml-1.5 font-mono text-[11px] text-faint">{g.items.length}</span>
              </div>
              <ul>{g.items.map(r => (
                <ExDivRow key={`${r.code}-${r.d}`} r={r} today={today} y={yields?.yields[r.code]?.y} />
              ))}</ul>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 mb-2 text-[11.5px] leading-relaxed text-faint">
        除息日與每股金額來源：臺灣證券交易所、證券櫃檯買賣中心公告（配息紀錄＋除權息預告），以公告為準，
        投信可能更改日期或金額。交易所還沒填金額時，改用投信在 e添富發布的收益分配公告：
        標「預估」的是評價日估算的金額，實際金額通常在除息前幾天公布、可能略有不同。
        「金額待公告」是連投信都還沒公布金額。發放日取自證交所 e添富與投信公告。
        年化殖利率＝最近一次除息金額 × 每年配息次數 ÷ 最近收盤價，和台股清單上的殖利率相同。
      </p>
    </>
  );
}

export function CalendarPage() {
  const fav = useFavoritesApi();
  const [data, setData] = useState<CalendarData | null>(null);
  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [kinds, setKinds] = useState<Set<EventKind>>(() => new Set(KINDS));
  const [query, setQuery] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [tab, setTab] = useState<'events' | 'etf'>('events');

  useEffect(() => {
    const ac = new AbortController();
    fetchCalendar(ac.signal)
      .then(d => { if (!ac.signal.aborted) { setData(d); setState('ready'); } })
      .catch(() => { if (!ac.signal.aborted) setState('ready'); });
    return () => ac.abort();
  }, []);

  const today = taipeiToday();
  const until = data?.meta.until && data.meta.until > today ? data.meta.until : addDays(today, 90);
  const events = useMemo(() => allEvents(data, today, until), [data, today, until]);

  const mine = useMemo(
    () => new Set([...fav.codes, ...holdingCodes()]),
    [fav.codes]);

  const shown = filterEvents(events, { kinds, query, mine: onlyMine ? mine : null });
  const groups = groupByDate(shown);

  if (state === 'loading') {
    return <p className="py-16 text-center text-[13px] text-muted">載入行事曆中…</p>;
  }

  const toggle = (k: EventKind) => setKinds(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next.size ? next : new Set(KINDS);
  });

  return (
    <>
      <div className="mt-4">
        <h1 className="text-lg font-bold text-ink">台股行事曆</h1>
        <p className="text-[12px] text-muted">
          {tab === 'events'
            ? <>除權息、股東會、財報與月營收期限、期貨結算・{today} 起到 {until}</>
            : <>每個月哪幾檔 ETF 除息、每股配多少・可切換月份</>}
        </p>
      </div>

      <div role="tablist" aria-label="行事曆分頁" className="mt-3 flex gap-1 border-b border-line">
        {([['events', '行事曆'], ['etf', 'ETF 除息']] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`-mb-px border-b-2 px-3 pb-2 text-[13.5px] font-semibold transition-colors ${
                    tab === k ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'etf' ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input type="search" value={query} onChange={e => setQuery(e.target.value)}
                   placeholder="搜尋代號或名稱" aria-label="搜尋代號或名稱"
                   className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[13px]
                              text-ink placeholder:text-faint sm:max-w-xs" />
            <label className="flex h-9 items-center gap-1.5 text-[12.5px] text-muted">
              <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} />
              只看收藏與持股（{mine.size}）
            </label>
          </div>
          <EtfExDivTab calendar={data} today={today} query={query} mine={onlyMine ? mine : null} />
        </>
      ) : (<>

      {!data && (
        <p className="mt-3 rounded-lg border border-line bg-surface p-3 text-[12.5px] text-muted">
          這次部署沒有抓到交易所的除權息與股東會資料，下面只列出依規則推算的日子。
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {KINDS.map(k => (
          <button key={k} type="button" aria-pressed={kinds.has(k)} onClick={() => toggle(k)}
                  className={`h-8 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
                    kinds.has(k) ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input type="search" value={query} onChange={e => setQuery(e.target.value)}
               placeholder="搜尋代號或名稱" aria-label="搜尋代號或名稱"
               className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[13px]
                          text-ink placeholder:text-faint sm:max-w-xs" />
        <label className="flex h-9 items-center gap-1.5 text-[12.5px] text-muted">
          <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} />
          只看收藏與持股（{mine.size}）
        </label>
      </div>

      {groups.length === 0 ? (
        <EmptyState title="沒有符合的日程"
                    hint={onlyMine && mine.size === 0
                      ? '你還沒有收藏或配息持股。到台股清單按星號，或在配息試算加入持股。'
                      : '換個篩選條件試試。'}
                    icon="📅" />
      ) : (
        <div className="mt-3 rounded-xl border border-line bg-surface px-3.5 pb-1 sm:px-4">
          {groups.map(g => {
            const n = daysUntil(g.d, today);
            return (
              <div key={g.d}>
                <div className="sticky top-[env(safe-area-inset-top,0px)] z-10 -mx-3.5 border-b border-line/60
                                bg-surface/95 px-3.5 py-1.5 backdrop-blur sm:-mx-4 sm:px-4">
                  <span className="text-[12.5px] font-bold text-ink">{dayLabel(g.d)}</span>
                  <span className={`ml-2 text-[11.5px] ${n <= 1 ? 'font-semibold text-up' : 'text-faint'}`}>
                    {when(n)}
                  </span>
                  <span className="ml-1.5 font-mono text-[11px] text-faint">{g.items.length}</span>
                </div>
                <ul>{g.items.map((e, i) => <EventRow key={`${e.kind}-${e.code}-${i}`} e={e} />)}</ul>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 mb-2 text-[11.5px] leading-relaxed text-faint">
        除權息與股東會來源：{data?.meta.source ?? '臺灣證券交易所、證券櫃檯買賣中心'}，以公告為準，
        公司可能更改日期。財報與月營收是一般產業的<strong>法定最晚期限</strong>（證券交易法第 36 條），
        公司可以提早、金融保險業另有規定；期貨結算日是依「每月第三個星期三」推算，遇假日順延。
        法說會日程只在公開資訊觀測站舊版網站，該站禁止程式讀取，所以這裡沒有收錄。
      </p>
      </>)}
    </>
  );
}
