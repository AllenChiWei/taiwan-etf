/* 可轉債：統計看板、價格區間分布、待發行、依產業整理、全部清單。
 *
 * 資料是櫃買中心的行情表＋資訊看板＋發行資料（scripts/fetch_cb.py），統計在 lib/cb.ts。
 * 看板的格式照使用者給的 XQ 範例（價格區間、累計比例、PR75／PR90、轉換價值與溢價率），
 * 差別是價格口徑：官方免費資料沒有委買價，用收市價、沒成交用參考價，畫面上講清楚。
 *
 * 點任一檔可轉債 → 標的公司的個股抽屜（營收、財報、籌碼），最上面加這一檔債的細節
 * 與站上新聞／重大訊息裡跟這家公司有關的幾則。
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchCb } from '../api/extras';
import { fetchNews } from '../api/news';
import {
  cbStats, byIndustry, filterBonds, outPct, yi, BUCKETS, HIGH_BUCKETS, CB_SORTS,
  type CbData, type CbBond, type CbSort, type CbStats,
} from '../lib/cb';
import type { NewsData } from '../lib/news';
import { relativeTime } from '../lib/news';
import { EmptyState } from '../components/EmptyState';
import { StockSheet } from '../components/StockSheet';
import { Section, Cell } from '../components/StockBoard';

const n1 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f1 = (v: number | null) => (v === null ? '—' : n1.format(v));
const f2 = (v: number | null) => (v === null ? '—' : n2.format(v));
const pct = (v: number | null) => (v === null ? '—' : `${n1.format(v)}%`);
const md = (d: string | null) => (d ? `${d.slice(0, 4)}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '—');

function Chip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
            className={`h-8 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
              active ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}>
      {children}
    </button>
  );
}

/* ── 統計看板（照 XQ 範例的格式） ─────────────────────────── */

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-line px-3 py-1.5 first:border-t-0">
      <span className={`text-[12.5px] ${strong ? 'font-bold text-ink' : 'text-muted'}`}>{label}</span>
      <span className={`font-mono tabular-nums ${strong ? 'text-[15px] font-bold text-ink' : 'text-[13px] text-ink'}`}>
        {value}
      </span>
    </div>
  );
}

function StatsBoard({ s, onBucket }: { s: CbStats; onBucket: (id: string) => void }) {
  const max = Math.max(1, ...s.buckets.map(b => b.count));
  return (
    <>
      {/* 區間表：手機上可以橫向滑，頁面本身不會被撐寬 */}
      <div className="mt-3 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[520px] text-center text-[12.5px] tabular-nums">
          <thead className="bg-sunken text-muted">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold">價格區間</th>
              {s.buckets.map(b => <th key={b.bucket.id} className="px-2 py-1.5 font-semibold">{b.bucket.label}</th>)}
              <th className="px-2 py-1.5 font-semibold">總數</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line">
              <td className="px-2 py-1.5 text-left text-muted">檔數</td>
              {s.buckets.map(b => (
                <td key={b.bucket.id} className="px-2 py-1.5">
                  <button type="button" onClick={() => onBucket(b.bucket.id)}
                          className="font-mono font-bold text-ink hover:text-accent hover:underline">
                    {b.count}
                  </button>
                </td>
              ))}
              <td className="px-2 py-1.5 font-mono font-bold text-ink" rowSpan={2}>{s.valid}</td>
            </tr>
            <tr className="border-t border-line">
              <td className="px-2 py-1.5 text-left text-muted">累計比例</td>
              {s.buckets.map(b => <td key={b.bucket.id} className="px-2 py-1.5 font-mono text-ink">{pct(b.cum)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-line bg-bg">
          <Row label="平均價格" value={f1(s.avgPx)} strong />
          <Row label="PR75 最高價" value={f1(s.pr75)} />
          <Row label="PR90 高高價" value={f1(s.pr90)} />
          {s.high.map(h => (
            <Row key={h.bucket.id} label={`價格 ${h.bucket.label} 檔數（比例）`}
                 value={`${h.count}（${pct(h.share)}）`} />
          ))}
          <Row label="平均轉換價值" value={f1(s.avgCv)} strong />
          <Row label="平均轉換溢價率" value={pct(s.avgPrem)} strong />
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-bg">
          <Row label="轉換價值 ≥ 100 時的平均溢價率" value={pct(s.avgPremItm)} strong />
          <Row label="轉換價值 ≥ 100 檔數" value={String(s.cvGe100)} />
          <Row label="轉換價值 ≥ 120 檔數" value={String(s.cvGe120)} />
          <Row label="溢價率 > 0% 檔數" value={String(s.premGt0)} />
          <Row label="溢價率 ≥ 50% 檔數" value={String(s.premGe50)} />
          <Row label="溢價率 ≥ 100% 檔數" value={String(s.premGe100)} />
        </div>
      </div>

      {/* 價格區間分布長條圖 */}
      <div className="mt-4">
        <h3 className="text-[12.5px] font-bold text-ink">價格區間分布</h3>
        <div className="mt-2 flex h-44 items-end gap-2 border-b border-line px-1 sm:gap-4">
          {s.buckets.map(b => (
            <button key={b.bucket.id} type="button" onClick={() => onBucket(b.bucket.id)}
                    aria-label={`${b.bucket.label}：${b.count} 檔`}
                    className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              <span className="mb-1 font-mono text-[12px] font-bold tabular-nums text-ink">{b.count}</span>
              <span className="w-full max-w-14 rounded-t bg-accent group-hover:opacity-80"
                    style={{ height: `${(b.count / max) * 82}%` }} />
            </button>
          ))}
        </div>
        <div className="flex gap-2 px-1 sm:gap-4">
          {s.buckets.map(b => (
            // 手機上一格只有 50px 寬，「100~105」放不下：在 ~ 後面允許換行，不要截成「100~1…」
            <span key={b.bucket.id} className="min-w-0 flex-1 pt-1 text-center text-[11px] leading-tight text-muted">
              {b.bucket.label.replace('~', '~​')}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

/* ── 點一檔之後：債的細節＋公司新聞 ──────────────────────── */

function BondDetail({ b, news }: { b: CbBond; news: NewsData | null | undefined }) {
  const items = news ? news.news.filter(x => x.all.includes(b.s) || x.codes.includes(b.s)).slice(0, 8) : [];
  const filings = news ? news.filings.filter(f => f.code === b.s).slice(0, 8) : [];
  return (
    <>
      <Section title={`${b.c} ${b.n}`} hint={`${b.close === null ? '今天沒成交，價格是參考價' : '收市價'}${b.exch ? '　交換債' : ''}`}>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Cell label="可轉債價格" value={f2(b.px)}
                tone={b.chg ? (b.chg > 0 ? 'text-up' : 'text-down') : undefined}
                sub={b.chg ? `${b.chg > 0 ? '+' : ''}${f2(b.chg)}` : undefined} />
          <Cell label="轉換價" value={f2(b.cp)} sub={b.cpEff ? `生效 ${md(b.cpEff)}` : undefined} />
          <Cell label="標的股價" value={f2(b.sp)} />
          <Cell label="轉換價值" value={f1(b.cv)} />
          <Cell label="溢價率" value={pct(b.prem)} />
          <Cell label="餘額／發行" value={yi(b.out)} sub={`${pct(outPct(b))}，原始 ${yi(b.tot)}`} />
          <Cell label="轉換期間" value={md(b.convS)} sub={`至 ${md(b.convE)}`} />
          <Cell label="到期日" value={md(b.mat)} sub={`發行 ${md(b.issue)}　${b.g ?? ''}`} />
          {b.putS && <Cell label="最近賣回" value={md(b.putS)} sub={`價格 ${f2(b.putP)}`} />}
          {b.callS && <Cell label="強制贖回" value={md(b.callS)} sub={`價格 ${f2(b.callP)}`} />}
          {b.vol !== null && <Cell label="今日成交" value={`${b.vol} 張`} sub={yi(b.val)} />}
          {b.coupon ? <Cell label="票面利率" value={`${b.coupon}%`} /> : null}
        </div>
        <p className="mt-2 text-[11.5px] text-faint">
          轉換價是櫃買資訊看板的「下次生效日之後」的轉換價；生效日還沒到時，今天適用的可能仍是舊的。
        </p>
      </Section>

      <Section title={`${b.sn || b.s} 近期新聞與公告`} hint="站上收錄的最近幾天">
        {news === undefined && <p className="mt-2 text-[12.5px] text-muted">載入新聞中…</p>}
        {news !== undefined && !items.length && !filings.length && (
          <p className="mt-2 text-[12.5px] text-muted">站上最近幾天的新聞與重大訊息沒有這家公司。</p>
        )}
        {filings.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {filings.map((f, i) => (
              <li key={`f${i}`} className="text-[13px] leading-snug">
                <span className="mr-1.5 rounded bg-sunken px-1.5 py-0.5 text-[10.5px] font-semibold text-muted">重訊</span>
                <a href={f.u} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-accent hover:underline">
                  {f.subject}
                </a>
                <span className="ml-1.5 text-[11px] text-faint">{relativeTime(f.at)}</span>
              </li>
            ))}
          </ul>
        )}
        {items.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {items.map((x, i) => (
              <li key={`n${i}`} className="text-[13px] leading-snug">
                <a href={x.u} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-accent hover:underline">
                  {x.t}
                </a>
                <span className="ml-1.5 text-[11px] text-faint">{x.s}・{relativeTime(x.at)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          <a href={`https://www.cnyes.com/twstock/${b.s}`} target="_blank" rel="noopener noreferrer"
             className="text-accent hover:underline">鉅亨網 {b.s} 個股新聞 ↗</a>
          <a href={`https://mopsov.twse.com.tw/mops/web/t05st01?firstin=1&co_id=${b.s}`} target="_blank"
             rel="noopener noreferrer" className="text-accent hover:underline">公開資訊觀測站重大訊息 ↗</a>
        </div>
      </Section>
    </>
  );
}

/* ── 頁面 ─────────────────────────────────────────────────── */

export function CbPage() {
  const [data, setData] = useState<CbData | null | undefined>(undefined);
  const [news, setNews] = useState<NewsData | null | undefined>(undefined);
  const [onlyTraded, setOnlyTraded] = useState(false);
  const [q, setQ] = useState('');
  const [bucket, setBucket] = useState<string | null>(null);
  const [ind, setInd] = useState<string | null>(null);
  const [sort, setSort] = useState<CbSort>('val');
  const [desc, setDesc] = useState(true);
  const [limit, setLimit] = useState(60);
  const [pick, setPick] = useState<CbBond | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchCb(ac.signal).then(d => { if (!ac.signal.aborted) setData(d); }).catch(() => setData(null));
    return () => ac.abort();
  }, []);

  // 新聞只在點開某一檔時才抓（約幾百 KB），沒點的人不用下載
  useEffect(() => {
    if (!pick || news !== undefined) return;
    fetchNews().then(d => setNews(d)).catch(() => setNews(null));
  }, [pick, news]);

  const stats = useMemo(() => (data ? cbStats(data.bonds, onlyTraded) : null), [data, onlyTraded]);
  const inds = useMemo(() => (data ? byIndustry(data.bonds, data.upcoming, data.meta.date) : []), [data]);
  const rows = useMemo(() => (data ? filterBonds(data.bonds, { q, bucket, ind, onlyTraded, sort, desc }) : []),
    [data, q, bucket, ind, onlyTraded, sort, desc]);

  if (data === undefined) return <p className="py-12 text-center text-[13px] text-muted">載入可轉債資料中…</p>;
  if (data === null || !stats) {
    return <EmptyState title="還沒有可轉債資料" hint="可轉債資料在每次部署時從櫃買中心整理，來源暫時無法連線時會是空的。" />;
  }

  const goList = (patch: () => void) => {
    patch();
    setLimit(60);
    document.getElementById('cb-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const bucketLabel = [...BUCKETS, ...HIGH_BUCKETS].find(b => b.id === bucket)?.label;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-4">
      <header>
        <h1 className="text-lg font-bold text-ink">可轉債</h1>
        <p className="mt-1 text-[12.5px] text-muted">
          資料日期 {md(data.meta.date)}　共 {data.meta.count} 檔，今天有成交 {data.meta.traded} 檔
          　轉換價取自 {md(data.meta.board)} 的櫃買資訊看板
        </p>
      </header>

      <Section title="統計看板" hint={onlyTraded ? `有效樣本 ${stats.valid}（只算今天有成交）` : `有效樣本 ${stats.valid}（沒成交的用參考價）`}>
        <div className="mt-2 flex flex-wrap gap-2">
          <Chip active={!onlyTraded} onClick={() => setOnlyTraded(false)}>全部（沒成交用參考價）</Chip>
          <Chip active={onlyTraded} onClick={() => setOnlyTraded(true)}>只算今天有成交</Chip>
        </div>
        <StatsBoard s={stats} onBucket={id => goList(() => setBucket(id))} />
        <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
          價格：當天有成交用收市價，沒成交用櫃買的參考價（官方免費資料沒有委買價，所以跟看盤軟體的「委買價」統計不是同一個數字）。
          轉換價值 ＝ 100 × 標的股價 ÷ 轉換價；溢價率 ＝ 可轉債價格 ÷ 轉換價值 − 1。點區間的數字或長條可以直接看那一區的清單。
        </p>
      </Section>

      <Section title="待發行" hint={`${data.upcoming.length} 檔　發行日或上櫃日在 ${md(data.meta.date)} 之後`}>
        {data.upcoming.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-muted">目前沒有排定發行的公開募集可轉債。</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12.5px] tabular-nums">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 pr-2 font-semibold">可轉債</th>
                  <th className="py-1 pr-2 font-semibold">產業</th>
                  <th className="py-1 pr-2 font-semibold">上櫃日</th>
                  <th className="py-1 pr-2 text-right font-semibold">發行額</th>
                  <th className="py-1 pr-2 text-right font-semibold">轉換價</th>
                  <th className="py-1 pr-2 font-semibold">年期・擔保</th>
                </tr>
              </thead>
              <tbody>
                {data.upcoming.map(u => (
                  <tr key={u.c || u.n} className="border-t border-line">
                    <td className="py-1.5 pr-2"><span className="font-mono text-muted">{u.c}</span> <span className="font-semibold text-ink">{u.n}</span></td>
                    <td className="py-1.5 pr-2 text-muted">{u.ind}</td>
                    <td className="py-1.5 pr-2">{md(u.list || u.issue)}</td>
                    <td className="py-1.5 pr-2 text-right">{yi(u.amt)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{f2(u.cp)}</td>
                    <td className="py-1.5 pr-2 text-muted">{u.y ? `${u.y} 年` : '—'}・{u.g}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11.5px] text-faint">
          來源是櫃買中心的發行資料，只列已排定發行日的公開募集；董事會剛決議、還在申報中的不會出現在這裡。私募可轉債不在櫃買交易，不列。
        </p>
      </Section>

      <Section title="發行公司依產業" hint="近 180 天新發行＋待發行多的排前面；點產業看清單">
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {inds.map(r => (
            <button key={r.ind} type="button" onClick={() => goList(() => setInd(r.ind))}
                    className={`rounded-lg border px-3 py-2 text-left hover:border-accent ${ind === r.ind ? 'border-accent' : 'border-line'} bg-bg`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-bold text-ink">{r.ind}</span>
                <span className="shrink-0 text-[11.5px] tabular-nums text-muted">
                  {r.issuers} 家・{r.bonds} 檔
                  {r.recent > 0 && <span className="ml-1.5 font-semibold text-accent">近期 {r.recent}</span>}
                  {r.upcoming > 0 && <span className="ml-1.5 font-semibold text-up">待發 {r.upcoming}</span>}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[11.5px] text-faint">
                餘額 {yi(r.outstanding)}　{r.names.map(x => x.sn).join('、')}
              </div>
            </button>
          ))}
        </div>
      </Section>

      <section id="cb-list" className="mt-3 scroll-mt-16 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-ink">全部可轉債</h2>
          <span className="text-[11.5px] text-faint">{rows.length} 檔</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={q} onChange={e => { setQ(e.target.value); setLimit(60); }}
                 placeholder="代號或名稱" aria-label="搜尋可轉債"
                 className="h-8 w-36 rounded-lg border border-line bg-bg px-2.5 text-[13px] text-ink" />
          <select value={sort} aria-label="排序"
                  onChange={e => { const s = e.target.value as CbSort; setSort(s); setDesc(CB_SORTS.find(x => x.id === s)!.desc); }}
                  className="h-8 rounded-lg border border-line bg-bg px-2 text-[12.5px] text-ink">
            {CB_SORTS.map(s => <option key={s.id} value={s.id}>依{s.label}</option>)}
          </select>
          <Chip active={desc} onClick={() => setDesc(v => !v)}>{desc ? '高→低' : '低→高'}</Chip>
          <Chip active={onlyTraded} onClick={() => setOnlyTraded(v => !v)}>今天有成交</Chip>
          {bucketLabel && <Chip active onClick={() => setBucket(null)}>價格 {bucketLabel} ✕</Chip>}
          {ind && <Chip active onClick={() => setInd(null)}>{ind} ✕</Chip>}
        </div>

        <div className="mt-2 divide-y divide-line">
          {rows.slice(0, limit).map(b => (
            <button key={b.c} type="button" onClick={() => setPick(b)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-2 text-left hover:bg-sunken/60
                               sm:grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))]">
              <div className="min-w-0">
                <span className="font-mono text-[12px] text-muted">{b.c}</span>
                <span className="ml-1.5 text-[13.5px] font-semibold text-ink">{b.n}</span>
                <div className="truncate text-[11px] text-faint">{b.ind}{b.putS ? `　賣回 ${md(b.putS)}` : ''}　到期 {md(b.mat)}</div>
              </div>
              <div className="text-right sm:order-none">
                <div className={`font-mono text-[14px] font-bold tabular-nums ${b.close === null ? 'text-muted' : 'text-ink'}`}>
                  {f2(b.px)}
                </div>
                <div className="text-[10.5px] text-faint">{b.close === null ? '參考價' : `${b.vol ?? 0} 張`}</div>
              </div>
              <div className="col-span-2 flex flex-wrap gap-x-3 text-[11.5px] tabular-nums text-muted sm:col-span-1 sm:block sm:text-right">
                <span className="sm:hidden">溢價 </span><span className="font-mono font-semibold text-ink">{pct(b.prem)}</span>
                <span className="hidden text-[10.5px] text-faint sm:block">溢價率</span>
              </div>
              <div className="hidden text-right sm:block">
                <div className="font-mono text-[12.5px] tabular-nums text-ink">{f1(b.cv)}</div>
                <div className="text-[10.5px] text-faint">轉換價值</div>
              </div>
              <div className="hidden text-right sm:block">
                <div className="font-mono text-[12.5px] tabular-nums text-ink">{f2(b.cp)}</div>
                <div className="text-[10.5px] text-faint">轉換價（股價 {f2(b.sp)}）</div>
              </div>
              <div className="hidden text-right sm:block">
                <div className="font-mono text-[12.5px] tabular-nums text-ink">{pct(outPct(b))}</div>
                <div className="text-[10.5px] text-faint">餘額比例</div>
              </div>
            </button>
          ))}
        </div>
        {rows.length > limit && (
          <button type="button" onClick={() => setLimit(l => l + 100)}
                  className="mt-2 h-9 w-full rounded-lg bg-sunken text-[12.5px] font-semibold text-muted hover:text-ink">
            再顯示 {Math.min(100, rows.length - limit)} 檔（還有 {rows.length - limit} 檔）
          </button>
        )}
        {rows.length === 0 && <p className="py-6 text-center text-[12.5px] text-muted">沒有符合條件的可轉債。</p>}
      </section>

      <p className="mt-4 text-[11.5px] leading-relaxed text-faint">
        資料來源：{data.meta.source}。更新時間 {data.meta.updated}。轉換價、賣回、贖回由發行公司輸入櫃買資訊看板，
        以公司公告為準。餘額是上月底的數字。
      </p>

      <StockSheet code={pick?.s ?? null} name={pick?.sn} onClose={() => setPick(null)}
                  extra={pick ? <BondDetail b={pick} news={news} /> : null} />
    </div>
  );
}
