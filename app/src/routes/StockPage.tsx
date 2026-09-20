/* 個股：財報與籌碼。
 *
 * 選到的代號放在網址上（?code=2330），所以重新整理、分享連結、上一頁都還在
 * 同一檔 —— 與台股清單的篩選條件同一套做法。
 *
 * 數字的兩個坑由 lib/stock.ts 處理：季報是累計數（Q2 是上半年）、金額單位是千元。
 * 這一頁只負責標清楚「這是哪一段期間」與「這個數字是估的還是公佈的」。
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  fetchStockIndex, fetchStock, fetchRanking, fetchHighs,
} from '../api/stocks';
import {
  rankRevenue, filterHighs, rankReturns, moneyFromThousands, NEAR_PCT, RETURN_LABELS,
  type StockData, type StockIndex, type Ranking, type Highs,
  type RankKey, type HighView, type ReturnKey,
} from '../lib/stock';
import { netTone } from '../lib/chips';
import { TONE_CLASS } from '../lib/format';
import { SearchableSelect, type SelectOption } from '../components/SearchableSelect';
import { EmptyState } from '../components/EmptyState';
import { StockSheet } from '../components/StockSheet';
// 面板抽在 StockBoard，因為清單的抽屜要用同一組（見那個檔案的說明）
import {
  Chip, Cell, InfoSection, RevenueSection, FinancialSection, PositionSection,
  PercentileSection, ChipsVisual, InstDailySection, ChipsSection,
  nf0, nf2, signedPct,
} from '../components/StockBoard';

/* ── 營收排行 ───────────────────────────────────────────── */

const RANK_KEYS: Array<{ id: RankKey; label: string }> = [
  { id: 'yoy', label: '月營收年增' },
  { id: 'mom', label: '月營收月增' },
  { id: 'cumYoy', label: '累計年增' },
  { id: 'rev', label: '營收金額' },
];

/** 營收門檻（千元）。1 億 = 100,000 千元。 */
const MIN_REV_OPTIONS: Array<{ label: string; v: number }> = [
  { label: '1 億以上', v: 100_000 },
  { label: '10 億以上', v: 1_000_000 },
  { label: '不限', v: 0 },
];

function RankingTab() {
  // 點一列就把儀表板蓋在原地；關掉之後清單還停在同一行
  const [sheet, setSheet] = useState<string | null>(null);
  const [data, setData] = useState<Ranking | null>(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState<RankKey>('yoy');
  const [asc, setAsc] = useState(false);
  const [market, setMarket] = useState('');
  const [minRev, setMinRev] = useState(MIN_REV_OPTIONS[0].v);

  useEffect(() => {
    const ac = new AbortController();
    fetchRanking(ac.signal)
      .then(d => { if (!ac.signal.aborted) setData(d); })
      .catch(() => { if (!ac.signal.aborted) setData(null); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, []);

  const rows = useMemo(
    () => (data ? rankRevenue(data.rows, { key, asc, market, minRev, limit: 60 }) : []),
    [data, key, asc, market, minRev]);

  if (loading) {
    return <p className="py-12 text-center text-[13px] text-muted">載入營收排行中…</p>;
  }
  if (!data) {
    return <EmptyState title="還沒有營收排行"
                       hint="月營收在每次部署時整理，來源暫時無法連線時會是空的。"
                       icon="📈" />;
  }

  return (
    <>
      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="text-sm font-bold text-ink">營收排行</h2>
          <span className="text-[11.5px] text-faint">
            {data.meta.period}　{nf0.format(data.meta.count)} 檔
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {RANK_KEYS.map(k => (
            <Chip key={k.id} active={key === k.id} onClick={() => setKey(k.id)}>
              {k.label}
            </Chip>
          ))}
          <Chip active={asc} onClick={() => setAsc(v => !v)}>
            {asc ? '低→高' : '高→低'}
          </Chip>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {['', '上市', '上櫃'].map(m => (
            <Chip key={m || 'all'} active={market === m} onClick={() => setMarket(m)}>
              {m || '全部市場'}
            </Chip>
          ))}
          {MIN_REV_OPTIONS.map(o => (
            <Chip key={o.label} active={minRev === o.v} onClick={() => setMinRev(o.v)}>
              {o.label}
            </Chip>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-faint">
          營收門檻不是可有可無的：建設公司依完工比例認列，去年同月常常接近零，
          年增率會出現百萬 % 而把整張排行洗掉。
        </p>
      </section>

      <div className="mt-3 rounded-xl border border-line bg-surface px-3.5 py-2 sm:px-4">
        <ol>
          {rows.map((r, i) => (
            <li key={r.c}
                onClick={() => setSheet(r.c)}
                role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheet(r.c); } }}
                className="cursor-pointer hover:bg-sunken/50 grid grid-cols-[1.6em_1fr_auto] items-baseline gap-2
                           border-b border-line/60 py-1.5 last:border-0">
              <span className="font-mono text-[11.5px] text-faint">{i + 1}</span>
              <span className="min-w-0">
                <span className="font-mono text-[13px] font-bold text-ink">{r.c}</span>
                <span className="ml-1.5 text-[12.5px] text-muted">{r.n}</span>
                <span className="mt-0.5 block text-[11px] text-faint">
                  {r.m}　{r.i}　營收 {moneyFromThousands(r.rev)}
                </span>
              </span>
              <span className="text-right">
                <span className={`block font-mono text-[14px] font-bold tabular-nums ${
                  TONE_CLASS[netTone(r[key] ?? Number.NaN)]}`}>
                  {key === 'rev' ? moneyFromThousands(r.rev) : signedPct(r[key])}
                </span>
                <span className="block font-mono text-[11px] tabular-nums text-faint">
                  {key === 'rev' ? `年增 ${signedPct(r.yoy)}` : `累計 ${signedPct(r.cumYoy)}`}
                </span>
              </span>
            </li>
          ))}
        </ol>
        {rows.length === 0 && (
          <p className="py-6 text-center text-[12.5px] text-muted">沒有符合條件的個股。</p>
        )}
      </div>

      <p className="mt-3 text-[11px] text-faint">{data.meta.source}</p>
      <StockSheet code={sheet} onClose={() => setSheet(null)} />
    </>
  );
}

/* ── 創新高 ─────────────────────────────────────────────── */

const HIGH_VIEWS: Array<{ id: HighView; label: string }> = [
  { id: 'high', label: '創新高' },
  { id: 'near', label: `接近高點（${Math.abs(NEAR_PCT)}% 內）` },
  { id: 'low', label: '創新低' },
];

function HighsTab() {
  // 點一列就把儀表板蓋在原地；關掉之後清單還停在同一行
  const [sheet, setSheet] = useState<string | null>(null);
  const [data, setData] = useState<Highs | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<HighView>('high');
  const [kind, setKind] = useState('');
  const [win, setWin] = useState(200);

  useEffect(() => {
    const ac = new AbortController();
    fetchHighs(ac.signal)
      .then(d => { if (!ac.signal.aborted) setData(d); })
      .catch(() => { if (!ac.signal.aborted) setData(null); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, []);

  // 資料裡帶著它自己的預設窗口，所以新增窗口時前端不用跟著改
  useEffect(() => {
    if (data?.meta.defaultWindow) setWin(data.meta.defaultWindow);
  }, [data]);

  const rows = useMemo(
    () => (data ? filterHighs(data.rows, { view, window: win, kind, limit: 80 }) : []),
    [data, view, win, kind]);

  if (loading) {
    return <p className="py-12 text-center text-[13px] text-muted">載入創新高資料中…</p>;
  }
  if (!data) {
    return <EmptyState title="還沒有創新高資料"
                       hint="這份與績效曲線同一條路徑產生，FinLab 額度用完時會缺席，隔天補上。"
                       icon="📈" />;
  }

  return (
    <>
      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="text-sm font-bold text-ink">創 {win} 日新高</h2>
          <span className="text-[11.5px] text-faint">收盤 {data.meta.date}</span>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {data.meta.windows.map(w => (
            <Chip key={w} active={win === w} onClick={() => setWin(w)}>{w} 日</Chip>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2">
          <Cell label="創新高" value={`${nf0.format(data.meta.newHighs[String(win)] ?? 0)} 檔`}
                tone="text-up" />
          <Cell label="創新低" value={`${nf0.format(data.meta.newLows[String(win)] ?? 0)} 檔`}
                tone="text-down" />
          <Cell label="統計範圍" value={`${nf0.format(data.meta.count)} 檔`} sub="個股＋ETF" />
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {HIGH_VIEWS.map(v => (
            <Chip key={v.id} active={view === v.id} onClick={() => setView(v.id)}>
              {v.label}
            </Chip>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {['', '上市', '上櫃', 'ETF'].map(k => (
            <Chip key={k || 'all'} active={kind === k} onClick={() => setKind(k)}>
              {k || '全部'}
            </Chip>
          ))}
        </div>
      </section>

      <div className="mt-3 rounded-xl border border-line bg-surface px-3.5 py-2 sm:px-4">
        <ol>
          {rows.map(r => {
            const w = r.w[String(win)];
            return (
              <li key={r.c}
                  onClick={() => setSheet(r.c)}
                  role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheet(r.c); } }}
                  className="cursor-pointer hover:bg-sunken/50 grid grid-cols-[1fr_auto] items-baseline gap-2
                             border-b border-line/60 py-1.5 last:border-0">
                <span className="min-w-0">
                  <span className="font-mono text-[13px] font-bold text-ink">{r.c}</span>
                  <span className="ml-1.5 text-[12.5px] text-muted">{r.n}</span>
                  <span className="mt-0.5 block text-[11px] text-faint">
                    {r.k}　{win} 日區間 {w.l} ～ {w.h}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-mono text-[14px] font-bold tabular-nums text-ink">
                    {nf2.format(r.p)}
                  </span>
                  <span className={`block font-mono text-[11px] tabular-nums ${
                    view === 'low' ? 'text-down' : 'text-up'}`}>
                    {view === 'low' ? `距低點 ${signedPct(w.fl)}` : `距高點 ${signedPct(w.fh)}`}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        {rows.length === 0 && (
          <p className="py-6 text-center text-[12.5px] text-muted">今天沒有符合的標的。</p>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-faint">{data.meta.note}</p>
      <StockSheet code={sheet} onClose={() => setSheet(null)} />
    </>
  );
}

/* ── 漲跌幅排行 ─────────────────────────────────────────── */

const RETURN_KEYS: ReturnKey[] = ['r5', 'r20', 'r60', 'r120'];

/** 股價門檻（元）。銅板股的百分比跳動大，讓使用者自己決定要不要看。 */
const MIN_PRICE_OPTIONS: Array<{ label: string; v: number }> = [
  { label: '不限', v: 0 },
  { label: '10 元以上', v: 10 },
  { label: '50 元以上', v: 50 },
];

function ReturnsTab() {
  // 點一列就把儀表板蓋在原地；關掉之後清單還停在同一行
  const [sheet, setSheet] = useState<string | null>(null);
  const [data, setData] = useState<Highs | null>(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState<ReturnKey>('r20');
  const [asc, setAsc] = useState(false);
  const [kind, setKind] = useState('');
  const [minPrice, setMinPrice] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    fetchHighs(ac.signal)
      .then(d => { if (!ac.signal.aborted) setData(d); })
      .catch(() => { if (!ac.signal.aborted) setData(null); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, []);

  const rows = useMemo(
    () => (data ? rankReturns(data.rows, { key, asc, kind, minPrice, limit: 80 }) : []),
    [data, key, asc, kind, minPrice]);

  if (loading) {
    return <p className="py-12 text-center text-[13px] text-muted">載入漲跌幅中…</p>;
  }
  if (!data) {
    return <EmptyState title="還沒有漲跌幅資料"
                       hint="這份與創新高同一個來源，FinLab 額度用完時會缺席，隔天補上。"
                       icon="📈" />;
  }

  return (
    <>
      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="text-sm font-bold text-ink">
            {asc ? '跌幅' : '漲幅'}排行 · {RETURN_LABELS[key]}
          </h2>
          <span className="text-[11.5px] text-faint">收盤 {data.meta.date}</span>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {RETURN_KEYS.map(k => (
            <Chip key={k} active={key === k} onClick={() => setKey(k)}>
              {RETURN_LABELS[k]}
            </Chip>
          ))}
          <Chip active={asc} onClick={() => setAsc(v => !v)}>
            {asc ? '跌幅榜' : '漲幅榜'}
          </Chip>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {['', '上市', '上櫃', 'ETF'].map(k => (
            <Chip key={k || 'all'} active={kind === k} onClick={() => setKind(k)}>
              {k || '全部'}
            </Chip>
          ))}
          {MIN_PRICE_OPTIONS.map(o => (
            <Chip key={o.label} active={minPrice === o.v} onClick={() => setMinPrice(o.v)}>
              {o.label}
            </Chip>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-faint">
          以還原股價計算（含除權息），期間以交易日計：一週 5 日、一月 20 日、
          一季 60 日、半年 120 日。上市不足該期間的不列入。
        </p>
      </section>

      <div className="mt-3 rounded-xl border border-line bg-surface px-3.5 py-2 sm:px-4">
        <ol>
          {rows.map((r, i) => (
            <li key={r.c}
                onClick={() => setSheet(r.c)}
                role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheet(r.c); } }}
                className="cursor-pointer hover:bg-sunken/50 grid grid-cols-[1.6em_1fr_auto] items-baseline gap-2
                           border-b border-line/60 py-1.5 last:border-0">
              <span className="font-mono text-[11.5px] text-faint">{i + 1}</span>
              <span className="min-w-0">
                <span className="font-mono text-[13px] font-bold text-ink">{r.c}</span>
                <span className="ml-1.5 text-[12.5px] text-muted">{r.n}</span>
                <span className="mt-0.5 block text-[11px] text-faint">
                  {r.k}　收盤 {nf2.format(r.p)}
                </span>
              </span>
              <span className="text-right">
                <span className={`block font-mono text-[14px] font-bold tabular-nums ${
                  TONE_CLASS[netTone(r[key] ?? Number.NaN)]}`}>
                  {signedPct(r[key])}
                </span>
                <span className="block font-mono text-[11px] tabular-nums text-faint">
                  {RETURN_KEYS.filter(k => k !== key).slice(0, 2)
                    .map(k => `${RETURN_LABELS[k]} ${signedPct(r[k])}`).join('　')}
                </span>
              </span>
            </li>
          ))}
        </ol>
        {rows.length === 0 && (
          <p className="py-6 text-center text-[12.5px] text-muted">沒有符合條件的標的。</p>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-faint">{data.meta.note}</p>
      <StockSheet code={sheet} onClose={() => setSheet(null)} />
    </>
  );
}

/* ── 頁面 ───────────────────────────────────────────────── */

type Tab = 'search' | 'rank' | 'high' | 'ret';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'search', label: '查個股' },
  { id: 'rank', label: '營收排行' },
  { id: 'high', label: '創新高' },
  { id: 'ret', label: '漲跌幅' },
];

export function StockPage() {
  const search = useSearch({ from: '/stock' });
  const navigate = useNavigate({ from: '/stock' });
  const code = search.code;
  // 一進來如果網址帶了代號，就直接停在那一檔上，不要把人丟到排行榜
  const [tab, setTab] = useState<Tab>('search');

  const [index, setIndex] = useState<StockIndex | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [data, setData] = useState<StockData | null>(null);
  const [loadingStock, setLoadingStock] = useState(false);
  // 位階面板要用 highs.json 裡的那一列。fetchHighs 有模組層級快取，
  // 所以這裡再叫一次不會重抓 —— 排行榜分頁可能已經抓過了。
  const [highs, setHighs] = useState<Highs | null>(null);
  // 相對位置要用營收排行裡的產業別與全市場的年增率
  const [ranking, setRanking] = useState<Ranking | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchStockIndex(ac.signal)
      .then(d => {
        if (ac.signal.aborted) return;
        setIndex(d);
        setState(d ? 'ready' : 'missing');
      })
      .catch((e: Error) => {
        if (ac.signal.aborted) return;
        setMessage(e.message);
        setState('error');
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!code) return;                       // 沒選標的就不必為了位階抓 776 KB
    const ac = new AbortController();
    fetchHighs(ac.signal)
      .then(d => { if (!ac.signal.aborted) setHighs(d); })
      .catch(() => { if (!ac.signal.aborted) setHighs(null); });
    fetchRanking(ac.signal)
      .then(d => { if (!ac.signal.aborted) setRanking(d); })
      .catch(() => { if (!ac.signal.aborted) setRanking(null); });
    return () => ac.abort();
  }, [code]);

  const highRow = useMemo(
    () => (highs && code ? highs.rows.find(r => r.c === code) ?? null : null),
    [highs, code]);
  const rankRow = useMemo(
    () => (ranking && code ? ranking.rows.find(r => r.c === code) ?? null : null),
    [ranking, code]);

  useEffect(() => {
    if (!code) { setData(null); return; }
    const ac = new AbortController();
    setLoadingStock(true);
    fetchStock(code, ac.signal)
      .then(d => { if (!ac.signal.aborted) setData(d); })
      .catch(() => { if (!ac.signal.aborted) setData(null); })
      .finally(() => { if (!ac.signal.aborted) setLoadingStock(false); });
    return () => ac.abort();
  }, [code]);

  const options = useMemo<SelectOption[]>(
    () => (index?.stocks ?? []).map(s => ({
      value: s.c, label: s.c, hint: `${s.n}　${s.i}`, group: s.m,
    })), [index]);

  const tabBar = (
    <div className="mt-4 flex gap-1.5 rounded-lg bg-sunken p-1">
      {TABS.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTab(t.id)}
          aria-pressed={tab === t.id}
          className={`h-9 flex-1 rounded-md text-[13px] font-semibold transition-colors ${
            tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  // 排行與創新高各自抓自己的資料，所以個股清單還在載入或缺席時，它們照樣能用
  if (tab !== 'search') {
    return (
      <>
        <h1 className="sr-only">個股</h1>
        {tabBar}
        {tab === 'rank' && <RankingTab />}
        {tab === 'high' && <HighsTab />}
        {tab === 'ret' && <ReturnsTab />}
      </>
    );
  }

  if (state === 'loading') {
    return (
      <>
        {tabBar}
        <p className="py-16 text-center text-[13px] text-muted">載入個股清單中…</p>
      </>
    );
  }
  if (state === 'missing') {
    return (
      <>
        {tabBar}
        <EmptyState title="還沒有個股資料"
                    hint="個股財報與籌碼在每次部署時產生，來源暫時無法連線時會是空的。"
                    icon="🏭" />
      </>
    );
  }
  if (state === 'error' || !index) {
    return (
      <>
        {tabBar}
        <EmptyState title="個股資料載入失敗" hint={message} icon="🏭" />
      </>
    );
  }

  return (
    <>
      <h1 className="sr-only">個股</h1>
      {tabBar}

      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <h2 className="text-sm font-bold text-ink">搜尋個股</h2>
        <div className="mt-2">
          <SearchableSelect
            options={options}
            value={code}
            onChange={next => {
              // 代號放網址上，重新整理與分享連結都還在同一檔
              void navigate({ search: { code: next }, replace: true, resetScroll: false });
            }}
            placeholder="輸入代號或公司名稱…"
          />
        </div>
        <p className="mt-1 text-[11px] text-faint">
          上市與上櫃共 {nf0.format(index.meta.stocks)} 家。
          財報 {index.meta.quarters.join('、') || '—'}、
          月營收 {index.meta.months.join('、') || '—'}。
        </p>
      </section>

      {!code && (
        <EmptyState title="還沒有選標的" hint="在上面搜尋代號或公司名稱，例如 2330、台積電。"
                    icon="🏭" />
      )}

      {code && loadingStock && (
        <p className="py-10 text-center text-[13px] text-muted">載入 {code} 中…</p>
      )}

      {code && !loadingStock && !data && (
        <EmptyState title={`找不到 ${code}`}
                    hint="這個代號可能還沒有資料，或不在上市櫃公司清單裡。" icon="🏭" />
      )}

      {data && (
        <>
          <InfoSection data={data} />
          <PositionSection row={highRow} />
          <PercentileSection row={highRow} allHighs={highs?.rows ?? []}
                             rank={rankRow} allRanks={ranking?.rows ?? []} />
          <ChipsVisual data={data} />
          <InstDailySection data={data} />
          <RevenueSection data={data} />
          <FinancialSection data={data} />
          <ChipsSection data={data} />
        </>
      )}

      <p className="mt-4 mb-2 text-[11.5px] leading-relaxed text-faint">
        {index.meta.note} 來源：{index.meta.source}。
        本頁僅供參考，不構成投資建議。
      </p>
    </>
  );
}
