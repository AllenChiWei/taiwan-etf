import { useEffect, useMemo, useState } from 'react';
import { useEtfData, useFavoritesApi } from '../context/AppContext';
import { useUsDataset } from '../hooks/useUsDataset';
import { fetchCalendar, fetchSeries, type Market } from '../api/series';
import { alignSeries, periodStart, type AlignedResult, type SeriesInput } from '../lib/series';
import { returnTone, TONE_CLASS } from '../lib/format';
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
  r12: string;
}

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
      if (t) { out.push({ code, name: t.name, market: 'tw', r12: t.r12 }); continue; }
      const u = usMap.get(code);
      if (u) out.push({ code, name: u.name, market: 'us', r12: u.r12 });
    }
    return out;
  }, [favorites.codes, twMap, usState]);

  const [selected, setSelected] = useState<string[]>([]);
  const [period, setPeriod] = useState('1y');

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
        曲線畫的是<strong className="text-up">價格走勢，不含配息</strong> ——
        比較高配息標的（例如 QYLD、JEPI）時要記得這點。
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

      <ul className="flex flex-col gap-1.5">
        {items.map(it => {
          const checked = selected.includes(it.code);
          const color = checked ? colorOf(it.code) : undefined;
          const full = !checked && selected.length >= MAX_COMPARE;
          return (
            <li key={it.code}>
              <label className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors
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
                <span className={`tabular w-16 text-right font-mono text-sm ${TONE_CLASS[returnTone(it.r12)]}`}>
                  {it.r12}
                </span>
                <button type="button" aria-label={`移除收藏 ${it.code}`}
                        onClick={e => { e.preventDefault(); favorites.toggle(it.code); }}
                        className="shrink-0 rounded px-1 text-sm text-faint hover:text-ink">✕</button>
              </label>
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
