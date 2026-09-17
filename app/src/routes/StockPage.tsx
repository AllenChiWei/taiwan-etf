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
import { fetchStockIndex, fetchStock } from '../api/stocks';
import {
  periodLabel, singleQuarter, ratios, sumInst, instTotals, toLots,
  moneyFromThousands, moneyFromYuan, isoDate,
  type StockData, type StockIndex, type Quarter,
} from '../lib/stock';
import { linePoints, linePath, zeroY, netTone } from '../lib/chips';
import { TONE_CLASS } from '../lib/format';
import { SearchableSelect, type SelectOption } from '../components/SearchableSelect';
import { EmptyState } from '../components/EmptyState';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });

const pctText = (v: number | null) => (v === null ? '—' : `${nf2.format(v)}%`);
const signedPct = (v: number | null | undefined) =>
  (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${nf2.format(v)}%`);
const lotsText = (shares: number | null) => {
  const l = toLots(shares);
  return l === null ? '—' : `${l > 0 ? '+' : ''}${nf0.format(Math.round(l))} 張`;
};

function Section({ title, hint, children }: {
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

function Cell({ label, value, tone, sub }: {
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

function InfoSection({ data }: { data: StockData }) {
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

function RevenueSection({ data }: { data: StockData }) {
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

function FinancialSection({ data }: { data: StockData }) {
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

function ChipsSection({ data }: { data: StockData }) {
  const c = data.chips;
  const d1 = sumInst(c, 1);
  const d5 = sumInst(c, 5);
  const d20 = sumInst(c, 20);
  const totals = instTotals(c);

  const W = 320;
  const H = 46;
  const pts = linePoints(totals, W, H);
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

      {pts.length > 1 && (
        <div className="mt-2 rounded-lg border border-line bg-bg p-2.5">
          <div className="text-[11.5px] text-muted">三大法人每日合計（張）</div>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="presentation"
               className="mt-1 h-12 w-full">
            {z !== null && (
              <line x1="0" x2={W} y1={z} y2={z} stroke="currentColor"
                    className="text-line" strokeWidth="1" strokeDasharray="3 3" />
            )}
            <path d={linePath(pts)} fill="none" stroke="#1f6feb" strokeWidth="1.6"
                  strokeLinejoin="round" strokeLinecap="round" />
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

/* ── 頁面 ───────────────────────────────────────────────── */

export function StockPage() {
  const search = useSearch({ from: '/stock' });
  const navigate = useNavigate({ from: '/stock' });
  const code = search.code;

  const [index, setIndex] = useState<StockIndex | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [data, setData] = useState<StockData | null>(null);
  const [loadingStock, setLoadingStock] = useState(false);

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

  if (state === 'loading') {
    return <p className="py-16 text-center text-[13px] text-muted">載入個股清單中…</p>;
  }
  if (state === 'missing') {
    return <EmptyState title="還沒有個股資料"
                       hint="個股財報與籌碼在每次部署時產生，來源暫時無法連線時會是空的。"
                       icon="🏭" />;
  }
  if (state === 'error' || !index) {
    return <EmptyState title="個股資料載入失敗" hint={message} icon="🏭" />;
  }

  return (
    <>
      <h1 className="sr-only">個股</h1>

      <section className="mt-4 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
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
