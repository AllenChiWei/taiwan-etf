import { useEffect, useMemo, useState } from 'react';
import { useEtfData, useFavoritesApi } from '../context/AppContext';
import { useUsDataset } from '../hooks/useUsDataset';
import { fetchCalendar, fetchSeries, type Market } from '../api/series';
import { alignSeries, periodStart, type AlignedResult, type SeriesInput } from '../lib/series';
import { returnTone, TONE_CLASS, yieldClass } from '../lib/format';
import { toNumber } from '../lib/filters';
import { PerformanceChart, lineColor } from '../components/PerformanceChart';
import { EmptyState } from '../components/EmptyState';
import { PasswordGate } from '../components/PasswordGate';

/** 一次比較太多條線會糊成一團，也讓圖例擠不下。 */
const MAX_COMPARE = 8;

const PERIODS: Array<{ value: string; label: string }> = [
  { value: '6m', label: '近6月' },
  { value: '1y', label: '近1年' },
  { value: '3y', label: '近3年' },
  { value: '5y', label: '近5年' },
  { value: 'max', label: '全部' },
];

interface Item {
  code: string;
  name: string;
  market: Market;
  /** 美股沒有殖利率（資料來源缺配息），以 null 表示「不適用」而非 0 */
  yield: string | null;
  r3: string;
  r6: string;
  r12: string;
  r36: string;
  r60: string;
}

/** 收藏清單可排序的欄位。美股沒有殖利率，排序時那些會沉底。 */
const SORT_FIELDS = [
  { key: 'yield', label: '殖利率' },
  { key: 'r3', label: '近3月' },
  { key: 'r6', label: '近6月' },
  { key: 'r12', label: '近1年' },
  { key: 'r36', label: '近3年' },
  { key: 'r60', label: '近5年' },
] as const;

type SortField = (typeof SORT_FIELDS)[number]['key'];

export function FavoritesPage() {
  const tw = useEtfData();
  const favorites = useFavoritesApi();

  // 收藏可能混著美股代號。只有在確實有台股清單認不得的代號時才去載美股資料 ——
  // 那份有 554 KB，純台股使用者不該為它付代價。
  const twMap = useMemo(
    () => new Map(tw.etfs.map(e => [e.code, e])), [tw.etfs]);
  const unknown = favorites.codes.filter(c => !twMap.has(c));
  // 美股清單是公開的，不需要解鎖；只有績效曲線要密碼
  const needUs = unknown.length > 0;
  const usState = useUsDataset0(needUs);

  const items: Item[] = useMemo(() => {
    const usMap = usState?.status === 'ready'
      ? new Map(usState.data.etfs.map(e => [e.code, e]))
      : new Map();
    const out: Item[] = [];
    for (const code of favorites.codes) {
      const t = twMap.get(code);
      if (t) {
        out.push({ code, name: t.name, market: 'tw', yield: t.yield,
                   r3: t.r3, r6: t.r6, r12: t.r12, r36: t.r36, r60: t.r60 });
        continue;
      }
      const u = usMap.get(code);
      if (u) {
        out.push({ code, name: u.name, market: 'us', yield: null,
                   r3: u.r3, r6: u.r6, r12: u.r12, r36: u.r36, r60: u.r60 });
      }
    }
    return out;
  }, [favorites.codes, twMap, usState]);

  const [selected, setSelected] = useState<string[]>([]);
  const [period, setPeriod] = useState('1y');
  const [sortBy, setSortBy] = useState<SortField | ''>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // 排序只影響清單的顯示順序，不影響勾選內容，也不影響圖表的線條顏色對應
  const shown = useMemo(() => {
    if (!sortBy) return items;
    const sign = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const x = toNumber(a[sortBy]);
      const y = toNumber(b[sortBy]);
      if (x === null && y === null) return a.code.localeCompare(b.code);
      if (x === null) return 1;            // N/A 與不適用一律沉底
      if (y === null) return -1;
      if (x !== y) return (x - y) * sign;
      return a.code.localeCompare(b.code);
    });
  }, [items, sortBy, sortDir]);

  // 取消收藏後要跟著移出比較清單
  useEffect(() => {
    setSelected(prev => prev.filter(c => favorites.codes.includes(c)));
  }, [favorites.codes]);

  // 第一次進來自動勾選前幾檔，省得面對一張空圖
  useEffect(() => {
    if (selected.length === 0 && items.length > 0) {
      setSelected(items.slice(0, Math.min(3, items.length)).map(i => i.code));
    }
    // 只在項目第一次出現時做
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  if (favorites.count === 0) {
    return (
      <div className="pt-4">
        <EmptyState icon="☆" title="還沒有收藏"
          hint="在台股或美股清單中點任一列的 ☆ 就會加入這裡。收藏只存在這台裝置的瀏覽器，不會上傳。" />
      </div>
    );
  }

  if (needUs && usState?.status === 'loading') {
    return <p className="py-16 text-center text-muted">載入美股資料中…</p>;
  }

  const toggle = (code: string) => {
    setSelected(prev => prev.includes(code)
      ? prev.filter(c => c !== code)
      : prev.length >= MAX_COMPARE ? prev : [...prev, code]);
  };

  // 勾選順序決定顏色，與圖表用的順序一致
  const colorOf = (code: string) => {
    const i = items.filter(it => selected.includes(it.code)).findIndex(it => it.code === code);
    return i >= 0 ? lineColor(i) : undefined;
  };

  return (
    <div className="pt-4">
      <h2 className="mb-1 text-base font-bold text-ink">績效比較</h2>
      <p className="mb-3 text-[13px] text-muted">
        勾選要比較的 ETF（最多 {MAX_COMPARE} 檔）。
        起點會自動取<strong className="text-ink">最晚上市那一檔的上市日</strong>，
        所有曲線在該點都歸零成 100，之後的差距才是真正的績效差。
        台股曲線用的是<strong className="text-ink">還原股價，已含配息再投入</strong>；
        美股則因資料來源沒有配息資訊，畫的是<strong className="text-up">價格走勢、不含配息</strong> ——
        比較 QYLD、JEPI 這類高配息的美股標的時要記得這點。
      </p>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {PERIODS.map(p => (
          <button key={p.value} type="button" aria-pressed={period === p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors
                    ${period === p.value
                      ? 'border-accent bg-accent text-accent-ink'
                      : 'border-line bg-surface text-accent hover:bg-hover'}`}>
            {p.label}
          </button>
        ))}
      </div>

      <PasswordGate what="績效曲線">
        <ChartPanel items={items} selected={selected} period={period} />
      </PasswordGate>

      <h2 className="mt-6 mb-2 text-base font-bold text-ink">
        我的收藏 <span className="tabular font-mono text-[13px] font-semibold text-muted">{items.length} 檔</span>
      </h2>

      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted">排序</span>
        {SORT_FIELDS.map(f => {
          const active = sortBy === f.key;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (sortBy !== f.key) { setSortBy(f.key); setSortDir('desc'); return; }
                if (sortDir === 'desc') { setSortDir('asc'); return; }
                setSortBy(''); setSortDir('desc');   // 第三次還原成收藏順序
              }}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors
                ${active ? 'border-accent bg-accent text-accent-ink'
                         : 'border-line bg-surface text-accent hover:bg-hover'}`}
            >
              {f.label}
              <span aria-hidden="true" className="ml-0.5">
                {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
              </span>
            </button>
          );
        })}
        {sortBy && (
          <button type="button" onClick={() => { setSortBy(''); setSortDir('desc'); }}
                  className="text-xs text-muted underline hover:text-ink">
            還原順序
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-1.5">
        {shown.map(it => {
          const checked = selected.includes(it.code);
          const color = checked ? colorOf(it.code) : undefined;
          const full = !checked && selected.length >= MAX_COMPARE;
          return (
            <li key={it.code}>
              <label className={`flex items-center gap-3 rounded-t-lg border border-b-0 px-3 py-2.5 transition-colors
                ${checked ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}
                ${full ? 'opacity-50' : 'cursor-pointer hover:bg-hover'}`}>
                <input type="checkbox" checked={checked} disabled={full}
                       onChange={() => toggle(it.code)}
                       className="h-4 w-4 shrink-0 accent-[var(--c-accent)]" />
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: color ?? 'transparent',
                               border: color ? undefined : '1px solid var(--c-border)' }} />
                <span className="font-mono text-sm font-bold text-accent">{it.code}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{it.name}</span>
                <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                  {it.market === 'tw' ? '台股' : '美股'}
                </span>
                <button type="button" aria-label={`移除收藏 ${it.code}`}
                        onClick={e => { e.preventDefault(); favorites.toggle(it.code); }}
                        className="shrink-0 rounded px-1 text-sm text-faint hover:text-ink">✕</button>
              </label>

              {/* 指標。放在第二排而不是擠進上面那行 —— 六個數字在手機上排不下。 */}
              <dl className={`grid grid-cols-3 gap-x-2 gap-y-1.5 rounded-b-lg border border-t-0 px-3 py-2
                              sm:grid-cols-6 ${checked ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
                {SORT_FIELDS.map(f => {
                  const v = it[f.key];
                  const isYield = f.key === 'yield';
                  const text = v === null ? '—' : v;
                  const cls = v === null ? 'text-faint'
                            : isYield ? yieldClass(v) : TONE_CLASS[returnTone(v)];
                  return (
                    <div key={f.key}>
                      <dt className={`text-[10px] font-semibold whitespace-nowrap
                                      ${sortBy === f.key ? 'text-accent' : 'text-faint'}`}>
                        {f.label}
                      </dt>
                      <dd className={`tabular font-mono text-[13px] ${cls}`}
                          title={v === null ? '美股清單沒有殖利率（資料來源缺配息）' : undefined}>
                        {text}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </li>
          );
        })}
      </ul>

      {unknown.length > 0 && items.length < favorites.count && (
        <p className="mt-3 text-[12px] text-faint">
          有 {favorites.count - items.length} 個收藏的代號已不在目前的清單中（可能已下市或不在涵蓋範圍）。
        </p>
      )}
    </div>
  );
}

/**
 * 圖表區。刻意獨立成一個元件並放在 PasswordGate 之內：
 * 曲線檔是加密的，未解鎖時抓取一定失敗，而 effect 的依賴不會因為「解鎖了」而改變，
 * 所以放在閘外就再也不會重試。掛載時機等於解鎖時機，問題自然消失。
 */
function ChartPanel({ items, selected, period }:
  { items: Item[]; selected: string[]; period: string }) {
  const chart = useChartData(items, selected, period);

  if (chart.loading) {
    return (
      <div className="grid h-[200px] place-items-center rounded-xl border border-line bg-surface text-sm text-muted">
        載入曲線資料中…
      </div>
    );
  }
  if (chart.error) {
    return (
      <div className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
        {chart.error}
      </div>
    );
  }
  if (!chart.result) return null;

  return (
    <>
      <PerformanceChart result={chart.result} />
      <p className="mt-1.5 text-[12px] text-faint">
        起點 {chart.result.startDate}　·　共同期間 {chart.result.dates.length} 個交易日
        {chart.result.dropped.length > 0 && `　·　${chart.result.dropped.join('、')} 缺曲線資料`}
      </p>
    </>
  );
}

/** 只有在需要時才啟動美股資料載入。hooks 不能有條件呼叫，所以包一層。 */
function useUsDataset0(enabled: boolean) {
  const state = useUsDataset();
  return enabled ? state : null;
}

interface ChartState {
  loading: boolean;
  error: string | null;
  result: AlignedResult | null;
}

/** 抓取被勾選標的的曲線，對齊後回傳。 */
function useChartData(items: Item[], selected: string[], period: string): ChartState {
  const [state, setState] = useState<ChartState>({ loading: false, error: null, result: null });

  const picked = useMemo(
    () => items.filter(i => selected.includes(i.code)),
    [items, selected],
  );
  const key = picked.map(p => `${p.market}/${p.code}`).join(',');

  useEffect(() => {
    if (picked.length === 0) {
      setState({ loading: false, error: '勾選至少一檔 ETF 來比較績效。', result: null });
      return;
    }
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));

    const markets = [...new Set(picked.map(p => p.market))];
    Promise.all([
      Promise.all(markets.map(m => fetchCalendar(m).then(dates => [m, dates] as const))),
      Promise.all(picked.map(p => fetchSeries(p.market, p.code)
        .then(raw => ({ p, raw }))
        .catch(() => ({ p, raw: null })))),
    ]).then(([cals, loaded]) => {
      if (cancelled) return;
      const calMap = new Map(cals);
      const inputs: SeriesInput[] = [];
      for (const { p, raw } of loaded) {
        const calendar = calMap.get(p.market);
        if (!raw || !calendar) continue;
        inputs.push({ code: p.code, label: p.name, market: p.market, raw, calendar });
      }
      if (inputs.length === 0) {
        setState({ loading: false, error: '選取的 ETF 都沒有曲線資料。', result: null });
        return;
      }
      const latest = inputs
        .map(i => i.calendar[i.calendar.length - 1])
        .sort()
        .pop()!;
      const minStart = periodStart(period, latest) ?? undefined;
      setState({ loading: false, error: null, result: alignSeries(inputs, minStart) });
    }).catch((err: unknown) => {
      if (cancelled) return;
      setState({ loading: false, error: (err as Error).message, result: null });
    });

    return () => { cancelled = true; };
  }, [key, period, picked]);

  return state;
}
