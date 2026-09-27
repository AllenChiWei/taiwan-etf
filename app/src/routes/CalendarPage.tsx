/* 台股行事曆：接下來哪天有什麼事。
 *
 * 除權息與股東會是交易所的公告（scripts/fetch_calendar.py）；財報與月營收的法定期限、
 * 期貨月結算日是依規則推算（lib/calendar.ts），畫面上標「規則」以示區別。
 *
 * 「只看我的」＝收藏 ∪ 配息試算裡的持股。規則事件跟每一檔都有關，所以照樣顯示。
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { fetchCalendar } from '../api/extras';
import {
  allEvents, filterEvents, groupByDate, dayLabel, daysUntil, KIND_LABEL,
  type CalendarData, type EventKind, type CalEvent,
} from '../lib/calendar';
import { useFavoritesApi } from '../context/AppContext';
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

export function CalendarPage() {
  const fav = useFavoritesApi();
  const [data, setData] = useState<CalendarData | null>(null);
  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [kinds, setKinds] = useState<Set<EventKind>>(() => new Set(KINDS));
  const [query, setQuery] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);

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
          除權息、股東會、財報與月營收期限、期貨結算・{today} 起到 {until}
        </p>
      </div>

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
    </>
  );
}
