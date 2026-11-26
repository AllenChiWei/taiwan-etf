import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { FillCodeSummary, FillEvent, FillSummaryData } from '../lib/fill';

const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf3 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 3 });

function EventRows({ events }: { events: FillEvent[] }) {
  return (
    <ul className="mt-2 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
      {[...events].reverse().map(event => (
        <li key={event.date} className="flex min-w-0 items-center justify-between gap-2 border-b border-line/60 py-1.5 text-[12px]">
          <span className="shrink-0 font-mono text-muted">{event.date}</span>
          <span className="truncate text-right text-ink">
            配息 {nf3.format(event.amount)} 元 ·{' '}
            {event.filled ? `已填息 ${event.days ?? 0} 個交易日` : `尚差 ${nf2.format(event.gapPct ?? 0)}%`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Card({ code, row }: { code: string; row: FillCodeSummary }) {
  const latest = row.events[row.events.length - 1];
  return (
    <details className="rounded-lg border border-line/70 px-3 py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12.5px]">
        <span className="min-w-0">
          <Link to="/etf" search={{ code }} className="font-mono font-semibold text-accent" onClick={e => e.stopPropagation()}>{code}</Link>
          <span className="ml-1.5 text-ink">{row.name}</span>
        </span>
        <span className="text-muted">
          {latest ? latest.filled ? `最近一次：${latest.days ?? 0} 個交易日填息` : `最近一次尚差 ${nf2.format(latest.gapPct ?? 0)}%` : '沒有可用紀錄'}
          <span className="ml-2">配息變異 {row.payoutCv3y === null ? '資料不足' : `${nf2.format(row.payoutCv3y)}%`}</span>
        </span>
      </summary>
      {row.events.length > 0 && <EventRows events={row.events} />}
    </details>
  );
}

export function EtfFillSummary({ code, data }: { code: string; data: FillSummaryData | null }) {
  const row = data?.codes[code];
  if (!data || !row || !row.events.length) return null;
  return (
    <section className="mt-3 min-w-0 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">填息紀錄</h2>
        <span className="text-[11px] text-faint">資料截至 {data.asof} · 最近 {row.events.length} 次除息</span>
      </div>
      <p className="mt-1 text-[11.5px] text-muted">
        近三年單次配息變異係數：{row.payoutCv3y === null ? '資料不足' : `${nf2.format(row.payoutCv3y)}%`}
      </p>
      <EventRows events={row.events} />
      <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
        填息以除息前收盤價（已換算分割）為基準；未填息不等於總報酬為負，這裡未計入配息與再投入。配息變異係數以近三年分割還原後的單次配息計算。
      </p>
    </section>
  );
}

export function FillBrowser({ data }: { data: FillSummaryData | null }) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLocaleLowerCase();
    return Object.entries(data.codes)
      .filter(([code, row]) => !q || code.toLocaleLowerCase().includes(q) || row.name.toLocaleLowerCase().includes(q))
      .sort(([a], [b]) => a.localeCompare(b, 'zh-Hant'));
  }, [data, query]);
  if (!data) return null;

  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">ETF 填息紀錄</h2>
        <span className="text-[11px] text-faint">資料截至 {data.asof} · 每檔最多列最近 12 次除息</span>
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
        以除息前收盤價（已換算分割）為填息基準；未填息不等於總報酬為負，摘要未計入配息與再投入。配息變異係數為近三年分割還原後單次配息的標準差 ÷ 平均數。
      </p>
      <label className="mt-3 block">
        <span className="sr-only">搜尋 ETF 填息紀錄</span>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋代號或名稱"
          className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink placeholder:text-faint sm:max-w-xs" />
      </label>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{rows.map(([code, row]) => <Card key={code} code={code} row={row} />)}</div>
      {!rows.length && <p className="py-5 text-center text-[13px] text-muted">找不到符合的 ETF。</p>}
    </section>
  );
}
