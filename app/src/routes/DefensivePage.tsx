/* 民生必需股（#/defensive，商品 → 民生股；2026-11-21 站主：「增加一些民生必需品的股票，看建議持有價等條件，例如中華電／遠傳／台哥大」）。
 * 資料 defensive.json（scripts/fetch_defensive.py，每日更新）；規則在 lib/defensive.ts。
 * 2026-11-26：卡片補融資維持率、距 250 日高點、持有該股的 ETF 數與個股快覽（StockSheet），
 * 並新增「自選存股」（localStorage 存代號，瀏覽器直打 api/finmind.ts 套用同一套 10 年區間算法）。 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { fetchMarginState, type MarginState } from '../api/market';
import { fetchHighs, fetchStockIndex } from '../api/stocks';
import { fetchStockDividends } from '../api/extras';
import { fetchDataset } from '../api/etfs';
import { clearDefensiveInputCache, fetchDefensiveInputs } from '../api/finmind';
import { useEtfExtras } from '../components/EtfExtras';
import { StockSheet } from '../components/StockSheet';
import {
  ZONE_HINT, ZONE_LABEL, ZONE_ORDER, computeDefensiveRow, currentEtfHolders, distortionWarnings,
  normalizeStockCode, scale, sortRows, todayTaipei, zoneOf,
  type Band, type DefData, type DefRow, type Zone,
} from '../lib/defensive';
import {
  MAX_DEFENSIVE_CUSTOM, loadDefensiveCache, loadDefensiveCustom, saveDefensiveCache, saveDefensiveCustom,
  type CachedDefensiveRow,
} from '../lib/storage';
import type { HighRow, Highs, StockIndex } from '../lib/stock';
import type { StockDividendData } from '../lib/dividend';
import type { Holder } from '../lib/holders';

// 區的顏色：便宜用網站主色（藍），昂貴用琥珀；不用紅綠（台股紅漲綠跌）
const ZONE_COLOR: Record<Zone, string> = { cheap: '#2563eb', fairLow: '#60a5fa', fairHigh: '#f59e0b', rich: '#d97706' };
const px = (v: number | null | undefined) => (v == null ? '—' : v >= 1000 ? Math.round(v).toLocaleString('zh-TW') : v.toFixed(v >= 100 ? 1 : 2));
const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface StockMeta {
  n: string;
  m?: string | null;
  i?: string | null;
}

interface CustomEntry {
  status: 'loading' | 'ready' | 'error';
  row?: DefRow;
  fetched?: string;
  stale?: boolean;
  error?: string;
}

interface CrossMetrics {
  /** 融資維持率（%，自算） */
  margin: number | null;
  marginDate: string | null;
  /** margin_state.json 是否載入成功（區分「缺檔」與「此股無融資資料」） */
  marginAvailable: boolean;
  /** 250 日高點資料（還原股價，來自 highs.json） */
  high250: { fh: number; nh: 0 | 1 } | null;
  highsDate: string | null;
  highsAvailable: boolean;
  /** 目前持有這檔股票的 ETF（null＝尚未載入完畢） */
  holders: Holder[] | null;
}

function Bar({ r, b }: { r: DefRow; b: Band }) {
  const s = scale(r.price, b);
  const seg = (a: number, z: number, c: string) => (
    <div className="absolute top-0 h-full" style={{ left: `${s.at(a) * 100}%`, width: `${(s.at(z) - s.at(a)) * 100}%`, background: c, opacity: 0.35 }} />
  );
  return (
    <div className="mt-2">
      <div className="relative h-3 overflow-hidden rounded-full bg-sunken">
        {seg(s.lo, b.cheap, ZONE_COLOR.cheap)}
        {seg(b.cheap, b.fair, ZONE_COLOR.fairLow)}
        {seg(b.fair, b.rich, ZONE_COLOR.fairHigh)}
        {seg(b.rich, s.hi, ZONE_COLOR.rich)}
        <div className="absolute top-[-2px] h-[16px] w-[3px] rounded bg-ink" style={{ left: `calc(${s.at(r.price) * 100}% - 1.5px)` }} />
      </div>
      <div className="mt-1 grid grid-cols-3 text-[11px] tabular-nums">
        <span className="text-left"><span className="text-faint">便宜 </span><b className="font-mono" style={{ color: ZONE_COLOR.cheap }}>{px(b.cheap)}</b></span>
        <span className="text-center"><span className="text-faint">合理 </span><b className="font-mono text-ink">{px(b.fair)}</b></span>
        <span className="text-right"><span className="text-faint">昂貴 </span><b className="font-mono" style={{ color: ZONE_COLOR.rich }}>{px(b.rich)}</b></span>
      </div>
    </div>
  );
}

function CrossStrip({ m }: { m: CrossMetrics }) {
  const marginTone = m.margin === null
    ? 'text-faint'
    : m.margin < 150
      ? 'text-yield'
      : 'text-ink';
  const marginSub = m.margin !== null
    ? (m.margin < 130 ? '低於追繳線' : m.margin < 150 ? '接近追繳' : (m.marginDate ? m.marginDate.slice(5) : '自算估'))
    : (m.marginAvailable ? '無融資' : '暫無');

  const fhTone = m.high250 === null
    ? 'text-faint'
    : (m.high250.nh === 1 || m.high250.fh >= 0 ? 'text-up' : 'text-down');
  const fhVal = m.high250 === null
    ? '—'
    : (m.high250.nh === 1 ? '0.0%' : `${m.high250.fh > 0 ? '+' : ''}${m.high250.fh.toFixed(1)}%`);
  const fhSub = m.high250 !== null
    ? (m.high250.nh === 1 ? '250日新高' : (m.highsDate ? m.highsDate.slice(5) : '還原價'))
    : (m.highsAvailable ? '未滿250日' : '暫無');

  const dailyCnt = m.holders ? m.holders.filter(h => h.kind === 'daily').length : 0;
  const etfVal = m.holders === null ? '—' : `${m.holders.length} 檔`;
  const etfSub = m.holders === null
    ? '載入中'
    : m.holders.length === 0
      ? '未列前十大'
      : (dailyCnt > 0 ? `含主動 ${dailyCnt}` : '月報前十大');

  return (
    <div className="mt-2 grid grid-cols-3 gap-1.5 rounded-lg border border-line/70 bg-bg px-2 py-1.5 text-center">
      <div className="min-w-0">
        <div className="truncate text-[10.5px] text-muted">融資維持率</div>
        <div className={`font-mono text-[12.5px] font-bold tabular-nums ${marginTone}`}>
          {m.margin === null ? '—' : `${m.margin.toFixed(1)}%`}
        </div>
        <div className="truncate text-[10px] text-faint">{marginSub}</div>
      </div>
      <div className="min-w-0 border-x border-line/60 px-1">
        <div className="truncate text-[10.5px] text-muted">距 250 日高</div>
        <div className={`font-mono text-[12.5px] font-bold tabular-nums ${fhTone}`}>{fhVal}</div>
        <div className="truncate text-[10px] text-faint">{fhSub}</div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-[10.5px] text-muted">持有 ETF</div>
        <div className={`font-mono text-[12.5px] font-bold tabular-nums ${m.holders && m.holders.length > 0 ? 'text-ink' : 'text-muted'}`}>
          {etfVal}
        </div>
        <div className="truncate text-[10px] text-faint">{etfSub}</div>
      </div>
    </div>
  );
}

function Card({
  r, metrics, isCustom = false, staleNotice, onOpenSheet, onRefresh, onRemove, refreshing = false,
}: {
  r: DefRow;
  metrics: CrossMetrics;
  isCustom?: boolean;
  staleNotice?: string;
  onOpenSheet: (code: string, name?: string) => void;
  onRefresh?: () => void;
  onRemove?: () => void;
  refreshing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [allHolders, setAllHolders] = useState(false);
  const z = zoneOf(r.price, r.byYield);
  const warnings = useMemo(() => distortionWarnings(r, { custom: isCustom }), [r, isCustom]);

  const ref = (lab: string, b: Band | null, note: string) => {
    if (!b) return null;
    const zz = zoneOf(r.price, b);
    return (
      <tr className="border-t border-line/60">
        <td className="py-1 pr-2 text-left">{lab}<div className="text-[10.5px] text-faint">{note}</div></td>
        <td className="py-1 pr-2 text-right font-mono">{px(b.cheap)}</td>
        <td className="py-1 pr-2 text-right font-mono">{px(b.fair)}</td>
        <td className="py-1 pr-2 text-right font-mono">{px(b.rich)}</td>
        <td className="py-1 text-right" style={zz ? { color: ZONE_COLOR[zz] } : undefined}>{zz ? ZONE_LABEL[zz] : '—'}</td>
      </tr>
    );
  };

  const holders = metrics.holders ?? [];
  const shownHolders = allHolders ? holders : holders.slice(0, 6);

  return (
    <li className="min-w-0 rounded-xl border border-line bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <Link to="/stock" search={{ code: r.c }} className="min-w-0 truncate text-[14px] font-bold text-ink hover:text-accent">
            {r.n} <span className="font-mono text-[12px] font-normal text-faint">{r.c}</span>
          </Link>
          {isCustom && (
            <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">自選</span>
          )}
        </div>
        <span className="shrink-0 font-mono text-[16px] font-bold tabular-nums text-ink">{px(r.price)}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-2 text-[11.5px] text-muted">
        <span>{r.cat}{r.i ? `・${r.i}` : ''}{!r.i && r.m ? `・${r.m}` : ''}</span>
        <span>
          殖利率 <b className="font-mono text-ink">{r.yield != null ? `${r.yield.toFixed(2)}%` : '—'}</b>
          {r.yieldRank != null && <>（10 年第 {Math.round(r.yieldRank * 100)} 百分位）</>}
        </span>
      </div>
      {z ? (
        <div className="mt-1.5 text-[12.5px] font-semibold" style={{ color: ZONE_COLOR[z] }}>
          {ZONE_LABEL[z]}<span className="ml-1.5 font-normal text-muted">{ZONE_HINT[z]}</span>
        </div>
      ) : (
        <div className="mt-1.5 text-[12px] text-muted">
          無殖利率區間{r.byPb || r.byPe ? '（可展開下方參考淨值比／本益比區間）' : ''}
        </div>
      )}
      {r.byYield && <Bar r={r} b={r.byYield} />}
      <CrossStrip m={metrics} />

      {warnings.length > 0 && (
        <div className="mt-2 rounded-lg border border-yield/40 bg-sunken/70 px-2.5 py-1.5 text-[11.5px] leading-snug text-ink">
          <span className="font-semibold text-yield">區間可能失真：</span>
          {warnings.join('；')}。
        </div>
      )}

      {staleNotice && (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[11px] text-muted">
          <span className="min-w-0 break-words">{staleNotice}</span>
          {onRefresh && (
            <button type="button" onClick={onRefresh} disabled={refreshing}
                    className="shrink-0 font-semibold text-accent hover:underline disabled:opacity-50">
              {refreshing ? '重試中…' : '重試'}
            </button>
          )}
        </div>
      )}

      <div className="mt-1.5 text-[11.5px] leading-snug text-muted">
        {r.div != null && r.divYear ? (
          <>
            股利 {r.divYear} 年 <b className="font-mono text-ink">{r.div.toFixed(2)}</b> 元
            {r.avg5 != null && <>・近 5 年平均 {r.avg5.toFixed(2)}</>}
            {r.streak > 0 ? <>・近 {r.streak}{r.streakMin ? '+' : ''} 年每年配息</> : <>・近兩年未配息</>}
          </>
        ) : (
          <>近年查無現金股利紀錄</>
        )}
        {r.chg1y != null && <>・一年 {r.chg1y >= 0 ? '+' : '−'}{Math.abs(r.chg1y * 100).toFixed(1)}%</>}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <button type="button" onClick={() => setOpen(v => !v)} className="text-[12px] font-semibold text-accent hover:underline">
          {open ? '收起' : '其他估價方法與持股 ETF'}
        </button>
        <div className="flex items-center gap-2.5 text-[11.5px]">
          <button type="button" onClick={() => onOpenSheet(r.c, r.n)} className="font-semibold text-muted hover:text-accent">
            個股快覽
          </button>
          {isCustom && onRefresh && (
            <button type="button" onClick={onRefresh} disabled={refreshing}
                    className="text-muted hover:text-accent disabled:opacity-50">
              {refreshing ? '更新中…' : '重抓'}
            </button>
          )}
          {isCustom && onRemove && (
            <button type="button" onClick={onRemove} aria-label={`移除自選 ${r.c}`}
                    className="text-faint hover:text-ink">
              移除
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-2 space-y-2 border-t border-line/60 pt-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[270px] text-[11.5px] tabular-nums">
              <thead>
                <tr className="text-right text-[10.5px] text-faint">
                  <th className="py-0.5 pr-2 text-left font-medium">方法</th>
                  <th className="py-0.5 pr-2 font-medium">便宜</th><th className="py-0.5 pr-2 font-medium">合理</th>
                  <th className="py-0.5 pr-2 font-medium">昂貴</th><th className="py-0.5 font-medium">現在</th>
                </tr>
              </thead>
              <tbody>
                {ref('殖利率區間', r.byYield, `近 10 年殖利率 ${r.byYield?.q?.join('／') ?? ''}%`)}
                {ref('本益比區間', r.byPe, `目前 ${r.pe?.toFixed(1) ?? '—'} 倍、第 ${r.peRank != null ? Math.round(r.peRank * 100) : '—'} 百分位`)}
                {ref('淨值比區間', r.byPb, `目前 ${r.pb?.toFixed(2) ?? '—'} 倍、第 ${r.pbRank != null ? Math.round(r.pbRank * 100) : '—'} 百分位`)}
                {ref('傳統股利法', r.byClassic, '近 5 年平均股利 ×16／20／32')}
              </tbody>
            </table>
          </div>

          {metrics.holders !== null && (
            <div className="rounded-lg bg-bg px-2.5 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px]">
                <span className="font-semibold text-ink">持有這檔的 ETF（{holders.length} 檔）</span>
                <span className="text-[10.5px] text-faint">投信每日完整持股／公會季報與月報前十大</span>
              </div>
              {holders.length === 0 ? (
                <p className="mt-1 text-[11px] text-muted">目前不在投信每日持股或公會持股明細內。</p>
              ) : (
                <>
                  <ul className="mt-1 space-y-0.5 text-[11.5px]">
                    {shownHolders.map(h => (
                      <li key={h.etf} className="flex items-baseline justify-between gap-2">
                        <Link to="/etf" search={{ code: h.etf }}
                              className="min-w-0 truncate text-ink hover:text-accent hover:underline">
                          <span className="font-mono text-accent">{h.etf}</span> {h.name}
                          <span className="ml-1 text-[10px] text-faint">
                            {h.kind === 'daily' ? '每日' : h.kind === 'pcf' ? '清單' : h.kind === 'quarterly' ? '季報' : '月報'}
                          </span>
                        </Link>
                        <span className="shrink-0 font-mono tabular-nums text-muted">
                          {h.weight == null ? '—' : `${nf2.format(h.weight)}%`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {holders.length > 6 && (
                    <button type="button" onClick={() => setAllHolders(v => !v)}
                            className="mt-1 text-[11px] font-semibold text-accent hover:underline">
                      {allHolders ? '收起 ETF 清單' : `顯示全部 ${holders.length} 檔`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          <div className="text-[11px] text-muted">
            歷年現金股利：{r.divs.length ? r.divs.map(([y, v]) => `${y} ${v.toFixed(2)}`).join('・') : '查無紀錄'}
          </div>
          <div className="text-[11px] text-faint">
            52 週 {px(r.lo52)}～{px(r.hi52)}・股價 {r.pdate}・歷史自 {r.since}
          </div>
        </div>
      )}
    </li>
  );
}

export function DefensivePage() {
  const [d, setD] = useState<DefData | null | undefined>(undefined);
  const [marginState, setMarginState] = useState<MarginState | null | undefined>(undefined);
  const [highs, setHighs] = useState<Highs | null | undefined>(undefined);
  const [etfNames, setEtfNames] = useState<Record<string, string>>({});
  const [stockIndex, setStockIndex] = useState<StockIndex | null>(null);
  const [stockDivs, setStockDivs] = useState<StockDividendData | null>(null);
  const extras = useEtfExtras();

  const [cat, setCat] = useState('全部');
  const [zone, setZone] = useState<Zone | null>(null);
  const [sheet, setSheet] = useState<{ code: string; name?: string } | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const openSheet = useCallback((code: string, name?: string) => setSheet({ code, name }), []);

  // 自選存股：代號存 localStorage，瀏覽器直打 api/finmind.ts 套同一套 10 年區間算法
  const [customCodes, setCustomCodes] = useState<string[]>(loadDefensiveCustom);
  const [customItems, setCustomItems] = useState<Record<string, CustomEntry>>({});
  const [input, setInput] = useState('');
  const [inputMsg, setInputMsg] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const cacheRef = useRef<Record<string, CachedDefensiveRow>>(loadDefensiveCache());
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const loadedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const ac = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/defensive.json`, { signal: ac.signal, cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!ac.signal.aborted) setD(j?.rows ? (j as DefData) : null); })
      .catch(() => { if (!ac.signal.aborted) setD(null); });
    fetchMarginState()
      .then(s => { if (!ac.signal.aborted) setMarginState(s); })
      .catch(() => { if (!ac.signal.aborted) setMarginState(null); });
    fetchHighs(ac.signal)
      .then(h => { if (!ac.signal.aborted) setHighs(h); })
      .catch(() => { if (!ac.signal.aborted) setHighs(null); });
    fetchDataset(ac.signal)
      .then(ds => { if (!ac.signal.aborted) setEtfNames(Object.fromEntries(ds.etfs.map(e => [e.code, e.name]))); })
      .catch(() => {});
    fetchStockIndex(ac.signal)
      .then(idx => { if (!ac.signal.aborted) setStockIndex(idx); })
      .catch(() => {});
    fetchStockDividends(ac.signal)
      .then(sd => { if (!ac.signal.aborted) setStockDivs(sd); })
      .catch(() => {});
    return () => ac.abort();
  }, []);

  const stockCatalog = useMemo(() => {
    const m = new Map<string, StockMeta>();
    if (stockDivs?.stocks) {
      for (const [code, s] of Object.entries(stockDivs.stocks)) {
        m.set(code, { n: s.n, m: s.m === 'twse' ? '上市' : '上櫃', i: null });
      }
    }
    if (stockIndex?.stocks) {
      for (const s of stockIndex.stocks) {
        m.set(s.c, { n: s.n, m: s.m, i: s.i });
      }
    }
    if (d?.rows) {
      for (const r of d.rows) {
        const prev = m.get(r.c);
        m.set(r.c, { n: r.n || prev?.n || r.c, m: r.m ?? prev?.m ?? null, i: r.i ?? prev?.i ?? null });
      }
    }
    return m;
  }, [stockDivs, stockIndex, d]);

  const catalogRef = useRef(stockCatalog);
  catalogRef.current = stockCatalog;

  const loadCustomCode = useCallback((code: string, force = false) => {
    const today = todayTaipei();
    const existing = controllersRef.current.get(code);
    if (existing) {
      if (!force) return;
      existing.abort();
      controllersRef.current.delete(code);
    }
    const cached = cacheRef.current[code];
    if (!force && cached && cached.fetched === today) {
      setCustomItems(prev => ({
        ...prev,
        [code]: { status: 'ready', row: cached.row, fetched: cached.fetched, stale: false },
      }));
      return;
    }
    const ac = new AbortController();
    controllersRef.current.set(code, ac);
    if (force) clearDefensiveInputCache(code);
    setCustomItems(prev => ({
      ...prev,
      [code]: {
        status: 'loading',
        row: prev[code]?.row ?? cached?.row,
        fetched: prev[code]?.fetched ?? cached?.fetched,
      },
    }));
    fetchDefensiveInputs(code, ac.signal)
      .then(res => {
        if (ac.signal.aborted) return;
        const meta = catalogRef.current.get(code);
        const row = computeDefensiveRow({
          code,
          name: meta?.n,
          cat: '自選',
          market: meta?.m ?? null,
          industry: meta?.i ?? null,
          today,
          per: res.per,
          px: res.price,
          dv: res.dividend,
        });
        if (!row) {
          const msg = 'FinMind 查無股價或本益比資料（ETF、存託憑證或剛上市個股不適用此 10 年區間算法）';
          setCustomItems(prev => ({
            ...prev,
            [code]: cached
              ? { status: 'ready', row: cached.row, fetched: cached.fetched, stale: true, error: msg }
              : { status: 'error', error: msg },
          }));
          return;
        }
        cacheRef.current = { ...cacheRef.current, [code]: { fetched: today, row } };
        saveDefensiveCache(cacheRef.current);
        setCustomItems(prev => ({
          ...prev,
          [code]: { status: 'ready', row, fetched: today, stale: false },
        }));
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        const msg = err instanceof Error ? err.message : 'FinMind 暫時無法連線，請稍後再試';
        setCustomItems(prev => ({
          ...prev,
          [code]: cached
            ? { status: 'ready', row: cached.row, fetched: cached.fetched, stale: true, error: msg }
            : { status: 'error', error: msg },
        }));
      })
      .finally(() => {
        if (controllersRef.current.get(code) === ac) controllersRef.current.delete(code);
      });
  }, []);

  useEffect(() => {
    saveDefensiveCustom(customCodes);
    const allowed = new Set(customCodes);
    for (const [c, ac] of controllersRef.current) {
      if (!allowed.has(c)) {
        ac.abort();
        controllersRef.current.delete(c);
      }
    }
    const nextCache: Record<string, CachedDefensiveRow> = {};
    let pruned = false;
    for (const [c, v] of Object.entries(cacheRef.current)) {
      if (allowed.has(c)) nextCache[c] = v;
      else pruned = true;
    }
    if (pruned) {
      cacheRef.current = nextCache;
      saveDefensiveCache(nextCache);
    }
    setCustomItems(prev => {
      let changed = false;
      const next: Record<string, CustomEntry> = {};
      for (const [c, v] of Object.entries(prev)) {
        if (allowed.has(c)) next[c] = v;
        else changed = true;
      }
      return changed ? next : prev;
    });
    for (const c of customCodes) {
      if (!loadedRef.current.has(c)) {
        loadedRef.current.add(c);
        loadCustomCode(c, false);
      }
    }
    for (const c of [...loadedRef.current]) {
      if (!allowed.has(c)) loadedRef.current.delete(c);
    }
  }, [customCodes, loadCustomCode]);

  useEffect(() => () => {
    for (const ac of controllersRef.current.values()) ac.abort();
    controllersRef.current.clear();
    loadedRef.current.clear();
  }, []);

  const rows = useMemo(() => (d ? sortRows(d.rows) : []), [d]);
  const builtinSet = useMemo(() => new Set(rows.map(r => r.c)), [rows]);
  const cats = useMemo(() => ['全部', ...Array.from(new Set(rows.map(r => r.cat)))], [rows]);

  const highsByCode = useMemo(() => {
    const m = new Map<string, HighRow>();
    for (const r of highs?.rows ?? []) m.set(r.c, r);
    return m;
  }, [highs]);

  const top10 = extras?.[0] ?? null;
  const active = extras?.[1] ?? null;
  const full = extras?.[3] ?? null;

  const allCodes = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.c);
    for (const c of customCodes) s.add(c);
    return [...s];
  }, [rows, customCodes]);

  const holdersByCode = useMemo(() => {
    if (!extras) return null;
    const m = new Map<string, Holder[]>();
    for (const c of allCodes) m.set(c, currentEtfHolders(c, top10, active, etfNames, full));
    return m;
  }, [extras, allCodes, top10, active, full, etfNames]);

  const metricsOf = (code: string): CrossMetrics => {
    const hr = highsByCode.get(code);
    const w250 = hr?.w?.['250'];
    const mv = marginState?.m?.[code];
    return {
      margin: mv !== undefined && Number.isFinite(mv) ? mv : null,
      marginDate: marginState?.d ?? null,
      marginAvailable: Boolean(marginState),
      high250: w250 ? { fh: w250.fh, nh: w250.nh } : null,
      highsDate: highs?.meta?.date ?? null,
      highsAvailable: Boolean(highs),
      holders: holdersByCode ? (holdersByCode.get(code) ?? []) : null,
    };
  };

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q || stockCatalog.size === 0) return [];
    const starts: Array<{ c: string; n: string; i?: string | null }> = [];
    const rest: Array<{ c: string; n: string; i?: string | null }> = [];
    for (const [c, meta] of stockCatalog) {
      if (builtinSet.has(c) || customCodes.includes(c)) continue;
      const cl = c.toLowerCase();
      const nl = meta.n.toLowerCase();
      if (cl.startsWith(q)) starts.push({ c, n: meta.n, i: meta.i });
      else if (cl.includes(q) || nl.includes(q)) rest.push({ c, n: meta.n, i: meta.i });
    }
    return [...starts, ...rest].slice(0, 6);
  }, [input, stockCatalog, builtinSet, customCodes]);

  const addCode = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    let code = normalizeStockCode(trimmed);
    if (!code) {
      // 允許直接打完整中文股名或唯一候選
      for (const [c, meta] of stockCatalog) {
        if (meta.n === trimmed) { code = c; break; }
      }
      if (!code && suggestions.length === 1) code = suggestions[0].c;
    }
    if (!code) {
      setInputMsg('請輸入 4～6 碼台股代號（例如 2886、9911）或點選候選股名');
      return;
    }
    if (/^00/.test(code)) {
      setInputMsg(`${code} 為 ETF，交易所無本益比資料；此 10 年區間算法僅適用上市櫃個股`);
      return;
    }
    if (builtinSet.has(code)) {
      const name = stockCatalog.get(code)?.n ?? '';
      setInputMsg(`${code}${name ? ` ${name}` : ''} 已在下方內建民生股清單中`);
      return;
    }
    if (customCodes.includes(code)) {
      setInputMsg(`${code} 已在自選存股清單中`);
      return;
    }
    if (customCodes.length >= MAX_DEFENSIVE_CUSTOM) {
      setInputMsg(`最多可加入 ${MAX_DEFENSIVE_CUSTOM} 檔自選存股，請先移除部分標的再新增`);
      return;
    }
    setCustomCodes(prev => [...prev, code]);
    setInput('');
    setInputMsg(null);
    setSuggestOpen(false);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    addCode(input);
  };

  const removeCustom = (code: string) => {
    setCustomCodes(prev => prev.filter(c => c !== code));
  };

  const enrichCustomRow = (row: DefRow): DefRow => {
    const meta = stockCatalog.get(row.c);
    if (!meta) return row;
    return {
      ...row,
      n: row.n === row.c && meta.n ? meta.n : row.n,
      m: row.m ?? meta.m ?? null,
      i: row.i ?? meta.i ?? null,
    };
  };

  if (d === undefined) return <p className="mt-6 text-center text-sm text-muted">載入中…</p>;

  const byCat = rows.filter(r => cat === '全部' || r.cat === cat);
  const shown = zone ? byCat.filter(r => zoneOf(r.price, r.byYield) === zone) : byCat;
  const cnt = (z: Zone) => byCat.filter(r => zoneOf(r.price, r.byYield) === z).length;

  const activeDate = active ? Object.values(active.etfs).map(e => e.asof).filter(Boolean).sort().pop() ?? null : null;
  const top10Ym = top10?.meta?.ym ? `${top10.meta.ym.slice(0, 4)}/${top10.meta.ym.slice(4)}` : null;

  return (
    <div>
      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h1 className="text-base font-bold text-ink">民生必需股：建議持有價</h1>
          {d && <span className="text-[11.5px] text-faint">{d.meta.date} 收盤</span>}
        </div>
        <p className="mt-1 max-w-[78ch] text-[12px] leading-snug text-muted">
          電信、食品、超商、燃氣、保全、高鐵這類「景氣差也要用」的股票。便宜／合理／昂貴價用<b className="text-ink">這檔自己近 {d?.meta.years ?? 10} 年的殖利率分布</b>換算
          （便宜＝最近全年股利 ÷ 歷史第 80 百分位殖利率，合理 ÷ 第 50，昂貴 ÷ 第 20），比傳統「股利 ×16／20／32」更貼近每檔自己的行情。
          每張卡片一併對照融資維持率（估）、距 250 日高點（還原價）與持有該股的 ETF 數。
        </p>
        {d && (
          <>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ZONE_ORDER.map(z => {
                const activeZone = zone === z;
                const c = ZONE_COLOR[z];
                return (
                  <button
                    key={z}
                    type="button"
                    aria-pressed={activeZone}
                    onClick={() => setZone(cur => (cur === z ? null : z))}
                    style={activeZone ? { color: c, borderColor: c, backgroundColor: `${c}22` } : { color: c }}
                    className={`h-7 rounded-lg border px-2.5 text-[12px] font-semibold tabular-nums ${activeZone ? '' : 'border-transparent bg-sunken hover:bg-hover'}`}
                  >
                    {ZONE_LABEL[z]} {cnt(z)}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cats.map(c => (
                <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}
                        className={`h-7 rounded-lg px-2.5 text-[12px] font-semibold ${cat === c ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}>
                  {c}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-bold text-ink">
            自選存股
            {customCodes.length > 0 && (
              <span className="ml-1.5 font-mono text-[12px] font-normal text-muted">{customCodes.length} 檔</span>
            )}
          </h2>
          <span className="text-[11px] text-faint">存於本機瀏覽器・由瀏覽器直查 FinMind（同套 10 年區間算法）</span>
        </div>

        <form onSubmit={handleSubmit} className="relative mt-2 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              type="text"
              value={input}
              onChange={e => { setInput(e.target.value); setInputMsg(null); setSuggestOpen(true); }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => { setTimeout(() => setSuggestOpen(false), 150); }}
              placeholder="輸入台股代號或名稱，例如 2886、9911、6803"
              aria-label="加入自選存股代號"
              className="h-9 w-full rounded-lg border border-line bg-bg px-2.5 text-[14px] text-ink placeholder:text-faint sm:text-[13px]"
            />
            {suggestOpen && suggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-10 z-20 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
                {suggestions.map(s => (
                  <li key={s.c}>
                    <button
                      type="button"
                      onMouseDown={e => { e.preventDefault(); addCode(s.c); }}
                      className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-hover"
                    >
                      <span className="min-w-0 truncate text-ink">
                        <span className="font-mono font-semibold text-accent">{s.c}</span> {s.n}
                      </span>
                      {s.i && <span className="shrink-0 text-[11px] text-faint">{s.i}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="submit"
            className="h-9 shrink-0 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-accent-ink hover:opacity-90"
          >
            加入
          </button>
          {customCodes.length > 0 && (
            <button
              type="button"
              onClick={() => customCodes.forEach(c => loadCustomCode(c, true))}
              className="h-9 shrink-0 rounded-lg bg-sunken px-2.5 text-[12px] font-semibold text-muted hover:text-ink"
            >
              全部重抓
            </button>
          )}
        </form>

        {inputMsg && <p className="mt-1.5 text-[12px] text-yield">{inputMsg}</p>}
        <p className="mt-1.5 text-[11px] leading-snug text-faint">
          每次新增查詢 3 個 FinMind 端點（免費層每網路每小時 300 次），當日結果會暫存於本機避免重抓；遇虧損、配息不穩或景氣循環股將自動標示可能失真。
        </p>

        {customCodes.length > 0 && (
          <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start xl:grid-cols-3">
            {customCodes.map(code => {
              const item = customItems[code];
              const meta = stockCatalog.get(code);
              if (item?.row) {
                const enriched = enrichCustomRow(item.row);
                const staleNotice = item.stale && item.error
                  ? `FinMind 更新失敗（${item.error}），目前顯示 ${item.fetched ?? '先前'} 快取`
                  : undefined;
                return (
                  <Card
                    key={code}
                    r={enriched}
                    metrics={metricsOf(code)}
                    isCustom
                    staleNotice={staleNotice}
                    refreshing={item.status === 'loading'}
                    onOpenSheet={openSheet}
                    onRefresh={() => loadCustomCode(code, true)}
                    onRemove={() => removeCustom(code)}
                  />
                );
              }
              return (
                <li key={code} className="min-w-0 rounded-xl border border-line bg-bg p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-[14px] font-bold text-ink">
                      {meta?.n ?? code}{' '}
                      <span className="font-mono text-[12px] font-normal text-faint">{code}</span>
                    </span>
                    <button type="button" onClick={() => removeCustom(code)} aria-label={`移除自選 ${code}`}
                            className="shrink-0 text-[11.5px] text-faint hover:text-ink">
                      移除
                    </button>
                  </div>
                  {item?.status === 'error' ? (
                    <div className="mt-2 space-y-1.5">
                      <p className="break-words text-[12px] leading-snug text-muted">
                        讀取失敗：{item.error ?? 'FinMind 暫時無法回應'}
                      </p>
                      <button type="button" onClick={() => loadCustomCode(code, true)}
                              className="h-7 rounded-lg bg-sunken px-2.5 text-[12px] font-semibold text-accent hover:bg-hover">
                        重新嘗試
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-[12px] text-muted">正在向 FinMind 查詢近 10 年資料…</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!d ? (
        <p className="mt-3 rounded-xl border border-line bg-surface px-4 py-6 text-center text-[13px] text-muted">
          內建民生股資料暫時讀不到，請稍後再試（上方自選存股仍可獨立使用）。
        </p>
      ) : shown.length > 0 ? (
        <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start xl:grid-cols-3">
          {shown.map(r => (
            <Card key={r.c} r={r} metrics={metricsOf(r.c)} onOpenSheet={openSheet} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-xl border border-line bg-surface px-4 py-6 text-center text-[13px] text-muted">
          這個條件下目前沒有股票
        </p>
      )}

      <p className="mt-3 max-w-[78ch] px-1 text-[11px] leading-relaxed text-faint">
        僅呈現「目前價位在歷史區間的位置」與站內公開指標對照，不是買賣建議。公司基本面改變（電信降價戰、燃氣調價、通路展店、景氣反轉）時，歷史區間不一定適用；
        殖利率以最近一次全年現金股利計算，除息前後會跳動。
        資料日期：{d ? `民生股 ${d.meta.date}` : '民生股暫無'}
        ｜融資維持率（XQ 平均成本公式自算，非個人整戶維持率）{marginState ? marginState.d : '暫時讀不到'}
        ｜250 日高點（還原股價）{highs ? highs.meta.date : '暫時讀不到'}
        ｜ETF 持股{activeDate || top10Ym ? `（主動 ${activeDate ?? '—'}／月報前十大 ${top10Ym ?? '—'}，非主動式十名外未計入）` : '載入中'}。
        {d && <> 來源：{d.meta.source}。</>}點股票名稱看完整個股頁，或點「個股快覽」原地開啟儀表板。
      </p>

      <StockSheet code={sheet?.code ?? null} name={sheet?.name} onClose={closeSheet} />
    </div>
  );
}
