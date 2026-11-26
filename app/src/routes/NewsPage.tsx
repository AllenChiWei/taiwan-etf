/* 新聞與公告。
 *
 * 這一頁只做索引與導流：標題、時間、來源、外連。內文永遠在原站 ——
 * 資料端（scripts/fetch_news.py）就沒有把內文存下來，不是靠畫面不顯示。
 *
 * 兩條流刻意分開：媒體新聞是編輯選過的，重大訊息是公司自己依法公告的原始文件。
 * 混在一起會讓人以為公告也是「有人判斷過重要」的東西。
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchNews } from '../api/news';
import { loadCbFavs } from '../lib/cb';
import { useFavoritesApi } from '../context/AppContext';
import {
  relativeTime, timeOfDay, groupByDay, filterNews, filterFilings, sourcesOf,
  type NewsData, type NewsItem, type Filing,
} from '../lib/news';
import { EmptyState } from '../components/EmptyState';

type Tab = 'news' | 'filings';

/** 配息試算的台股持股。資料不存在或損毀時，篩選仍可正常顯示。 */
function holdingCodes(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('twetf.holdings') ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(x => x && typeof x.code === 'string' && x.m !== 'us')
      .map(x => x.code as string);
  } catch {
    return [];
  }
}

/* ── 共用 ────────────────────────────────────────────────── */

function Chip({ active, onClick, children }: {
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

function DayHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="sticky top-0 z-10 -mx-3.5 mb-1 rounded-t-xl border-b border-line/60 bg-surface/95
                    px-3.5 py-1.5 text-[11.5px] font-semibold text-muted backdrop-blur sm:-mx-4 sm:px-4">
      {label}
      <span className="ml-1.5 font-mono text-[11px] text-faint">{count}</span>
    </div>
  );
}

/* ── 新聞 ────────────────────────────────────────────────── */

function NewsRow({ item, now, multi }: { item: NewsItem; now: number; multi?: boolean }) {
  return (
    <li className={`border-b border-line/60 py-2 last:border-0 ${multi ? 'lg:last:border-b' : ''}`}>
      <a href={item.u} target="_blank" rel="noopener noreferrer"
         className="block hover:opacity-80">
        <span className="text-[13.5px] leading-snug font-semibold text-ink">
          {item.t}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1
                         text-[11.5px] text-faint">
          <span className="rounded bg-sunken px-1.5 py-0.5 font-semibold text-muted">
            {item.s}
          </span>
          <span>{relativeTime(item.at, now)}</span>
          {item.codes.map(c => (
            <span key={c}
                  className="rounded bg-accent-soft px-1.5 py-0.5 font-mono
                             text-[11px] font-bold text-accent">
              {c}
            </span>
          ))}
        </span>
      </a>
    </li>
  );
}

function NewsTab({ data, mine }: { data: NewsData; mine: ReadonlySet<string> }) {
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const [onlyTracked, setOnlyTracked] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  // 相對時間要固定在這一次渲染，不然同一份列表裡的「幾分鐘前」會互相矛盾
  const now = useMemo(() => Date.now(), [data]);

  const sources = useMemo(() => sourcesOf(data.news), [data.news]);
  const rows = useMemo(
    () => filterNews(data.news, { source, query, onlyTracked, mine: onlyMine ? mine : null }),
    [data.news, source, query, onlyTracked, onlyMine, mine]);
  const groups = useMemo(() => groupByDay(rows), [rows]);

  return (
    <>
      <div className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜尋標題或代號…"
            aria-label="搜尋新聞"
            className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-base
                       text-ink focus:border-accent focus:ring-3 focus:ring-accent-soft
                       focus:outline-none lg:h-10 lg:w-80 lg:shrink-0 lg:text-[14.5px]"
          />
          <div className="flex flex-wrap gap-1.5">
            <Chip active={source === ''} onClick={() => setSource('')}>全部來源</Chip>
            {sources.map(s => (
              <Chip key={s} active={source === s} onClick={() => setSource(s)}>{s}</Chip>
            ))}
            <Chip active={onlyTracked} onClick={() => setOnlyTracked(v => !v)}>
              只看清單標的
            </Chip>
            <Chip active={onlyMine} onClick={() => setOnlyMine(v => !v)}>
              只看我的收藏與持股（{mine.size}）
            </Chip>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="沒有符合的新聞"
                    hint={onlyMine && mine.size === 0
                      ? '目前沒有可用的收藏或持股代號；可到 ETF 清單收藏，或在配息試算加入持股。'
                      : '換個關鍵字，或把來源改成全部。'} />
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-2 lg:gap-3 2xl:grid-cols-3">
          {groups.map(g => {
            const multi = g.rows.length >= 3;
            return (
              <section key={g.key || 'unknown'}
                       className={`min-w-0 rounded-xl border border-line bg-surface px-3.5 pb-1 sm:px-4 ${
                         multi ? 'lg:col-span-2 2xl:col-span-3' : ''}`}>
                <DayHeading label={g.label} count={g.rows.length} />
                <ul className={multi ? 'grid grid-cols-1 lg:grid-cols-2 lg:gap-x-6 2xl:grid-cols-3' : ''}>
                  {g.rows.map(r => <NewsRow key={r.u} item={r} now={now} multi={multi} />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ── 重大訊息 ────────────────────────────────────────────── */

const MARKETS = ['', '上市', '上櫃'];

function FilingRow({ item, multi }: { item: Filing; multi?: boolean }) {
  return (
    <li className={`border-b border-line/60 py-2 last:border-0 ${multi ? 'lg:last:border-b' : ''}`}>
      <a href={item.u} target="_blank" rel="noopener noreferrer"
         className="block hover:opacity-80">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-[13px] font-bold text-ink">{item.code}</span>
          <span className="text-[12.5px] font-semibold text-ink">{item.name}</span>
          {item.known && (
            <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10.5px]
                             font-bold text-accent">清單內</span>
          )}
          <span className="text-[11px] text-faint">{timeOfDay(item.at)}</span>
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">
          {item.subject}
        </span>
      </a>
    </li>
  );
}

function FilingsTab({ data, mine }: { data: NewsData; mine: ReadonlySet<string> }) {
  const [market, setMarket] = useState('');
  const [query, setQuery] = useState('');
  const [onlyKnown, setOnlyKnown] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);

  const rows = useMemo(
    () => filterFilings(data.filings, { market, query, onlyKnown, mine: onlyMine ? mine : null }),
    [data.filings, market, query, onlyKnown, onlyMine, mine]);
  const groups = useMemo(() => groupByDay(rows), [rows]);
  const knownCount = useMemo(
    () => data.filings.filter(r => r.known).length, [data.filings]);

  return (
    <>
      <div className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜尋公司、代號或主旨…"
            aria-label="搜尋重大訊息"
            className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-base
                       text-ink focus:border-accent focus:ring-3 focus:ring-accent-soft
                       focus:outline-none lg:h-10 lg:w-80 lg:shrink-0 lg:text-[14.5px]"
          />
          <div className="flex flex-wrap gap-1.5">
            {MARKETS.map(m => (
              <Chip key={m || 'all'} active={market === m} onClick={() => setMarket(m)}>
                {m || '上市＋上櫃'}
              </Chip>
            ))}
            <Chip active={onlyKnown} onClick={() => setOnlyKnown(v => !v)}>
              只看清單標的（{knownCount}）
            </Chip>
            <Chip active={onlyMine} onClick={() => setOnlyMine(v => !v)}>
              只看我的收藏與持股（{mine.size}）
            </Chip>
          </div>
        </div>
        <p className="mt-1.5 max-w-[78ch] text-[11px] text-faint">
          公司依法公告的原始重大訊息，沒有經過任何編輯判斷。點開是公開資訊觀測站該公司的公告頁。
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="沒有符合的公告"
                    hint={onlyMine && mine.size === 0
                      ? '目前沒有可用的收藏或持股代號；可到 ETF 清單收藏，或在配息試算加入持股。'
                      : onlyKnown && knownCount === 0
                        ? '今天沒有清單內標的的公告，把這個篩選關掉可以看全部。'
                        : '換個關鍵字，或把市場改成上市＋上櫃。'} />
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-2 lg:gap-3 2xl:grid-cols-3">
          {groups.map(g => {
            const multi = g.rows.length >= 3;
            return (
              <section key={g.key || 'unknown'}
                       className={`min-w-0 rounded-xl border border-line bg-surface px-3.5 pb-1 sm:px-4 ${
                         multi ? 'lg:col-span-2 2xl:col-span-3' : ''}`}>
                <DayHeading label={g.label} count={g.rows.length} />
                <ul className={multi ? 'grid grid-cols-1 lg:grid-cols-2 lg:gap-x-6 2xl:grid-cols-3' : ''}>
                  {g.rows.map((r, i) => (
                    <FilingRow key={`${r.code}-${r.at ?? ''}-${i}`} item={r} multi={multi} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ── 頁面 ────────────────────────────────────────────────── */

export function NewsPage() {
  const favorites = useFavoritesApi();
  const mine = useMemo(
    () => new Set([...favorites.codes, ...holdingCodes(), ...loadCbFavs()]),
    [favorites.codes]);
  const [tab, setTab] = useState<Tab>('news');
  const [data, setData] = useState<NewsData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const ac = new AbortController();
    fetchNews(ac.signal)
      .then(d => {
        if (ac.signal.aborted) return;
        setData(d);
        setState(d ? 'ready' : 'missing');
      })
      .catch((e: Error) => {
        if (ac.signal.aborted) return;
        setMessage(e.message);
        setState('error');
      });
    return () => ac.abort();
  }, []);

  if (state === 'loading') {
    return <p className="py-16 text-center text-[13px] text-muted">載入新聞中…</p>;
  }
  if (state === 'missing') {
    return <EmptyState title="還沒有新聞資料"
                       hint="新聞在每次部署時抓取，來源暫時無法連線時會是空的。" icon="📰" />;
  }
  if (state === 'error' || !data) {
    return <EmptyState title="新聞載入失敗" hint={message} icon="📰" />;
  }

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'news', label: `新聞 ${data.meta.news}` },
    { id: 'filings', label: `重大訊息 ${data.meta.filings}` },
  ];

  return (
    <>
      <h1 className="sr-only">新聞</h1>

      <div className="mt-4 flex gap-1.5 rounded-lg bg-sunken p-1 sm:inline-flex">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`h-9 flex-1 rounded-md px-3 text-[13px] font-semibold transition-colors sm:flex-initial sm:px-5 ${
              tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'news' ? <NewsTab data={data} mine={mine} /> : <FilingsTab data={data} mine={mine} />}

      <p className="mt-4 mb-2 max-w-[78ch] text-[11.5px] leading-relaxed text-faint">
        {data.meta.note} 來源：{data.meta.sources.join('、')}。
        標題與連結屬原始媒體與發佈公司所有，本頁僅供索引，不構成投資建議。
      </p>
    </>
  );
}
