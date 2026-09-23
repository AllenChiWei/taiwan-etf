/* 即將上市／近期新上市的 ETF，加上「募集、核准」的新聞雷達。
 *
 * 計算都在 lib/upcoming.ts。畫面要講清楚這份清單的限制：證交所的簡介通常在上市前
 * 一天才發布，更早的「已核准、募集中」只有新聞 —— 官方沒有結構化的清單。
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchUpcoming } from '../api/extras';
import { fetchNews } from '../api/news';
import {
  listingStatus, taipeiToday, pick, newsRadar, STATUS_LABEL,
  type UpcomingData, type ListingStatus,
} from '../lib/upcoming';
import type { NewsItem } from '../lib/news';

const STATUS_TONE: Record<ListingStatus, string> = {
  upcoming: 'bg-accent text-accent-ink',
  today: 'bg-up text-white',
  listed: 'bg-sunken text-muted',
};

export function UpcomingEtfs() {
  const [data, setData] = useState<UpcomingData | null | undefined>(undefined);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const today = useMemo(() => taipeiToday(), []);

  useEffect(() => {
    const ac = new AbortController();
    fetchUpcoming(ac.signal).then(d => { if (!ac.signal.aborted) setData(d); })
      .catch(() => { if (!ac.signal.aborted) setData(null); });
    fetchNews(ac.signal).then(d => { if (!ac.signal.aborted && d) setNews(newsRadar(d.news)); })
      .catch(() => { /* 新聞缺席時雷達就空著，不影響上面的清單 */ });
    return () => ac.abort();
  }, []);

  return (
    <div className="pt-4">
      <section className="rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="text-sm font-bold text-ink">即將上市與近期新上市</h2>
          {data && <span className="text-[11.5px] text-faint">更新 {data.meta.updated}</span>}
        </div>

        {data === undefined && <p className="py-8 text-center text-[13px] text-muted">載入中…</p>}
        {data === null && <p className="py-8 text-center text-[13px] text-muted">還沒有新上市 ETF 的資料。</p>}

        {data && (
          <ul className="mt-2 space-y-2">
            {data.items.map(it => {
              const st = listingStatus(it.listing, today);
              const key = it.code || it.url;
              const expanded = open === key;
              const issuer = pick(it.fields, '投信公司', '經理公司');
              const target = pick(it.fields, '追蹤指數名稱', '績效指標', '標的指數');
              const freq = pick(it.fields, '配息頻率');
              const fee = pick(it.fields, '管理費');
              return (
                <li key={key} className="rounded-lg border border-line bg-bg p-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="min-w-0 text-[14px] font-semibold text-ink">
                      <span className="font-mono text-[12.5px] text-muted">{it.code}</span> {it.name}
                    </span>
                    <span className={`shrink-0 rounded px-1.5 py-px text-[11px] font-bold ${STATUS_TONE[st]}`}>
                      {STATUS_LABEL[st]} {it.listing ?? ''}
                    </span>
                  </div>
                  <dl className="mt-1 grid gap-x-3 gap-y-0.5 text-[12px] sm:grid-cols-2">
                    {issuer && <div className="min-w-0 truncate"><dt className="inline text-faint">投信 </dt><dd className="inline text-muted">{issuer.replace(/股份有限公司|證券投資信託/g, '')}</dd></div>}
                    {freq && <div><dt className="inline text-faint">配息 </dt><dd className="inline text-muted">{freq}</dd></div>}
                    {target && <div className="min-w-0 sm:col-span-2"><dt className="inline text-faint">指數／指標 </dt><dd className="inline text-muted">{target}</dd></div>}
                    {fee && <div className="min-w-0 sm:col-span-2"><dt className="inline text-faint">管理費 </dt><dd className="inline text-muted">{fee}</dd></div>}
                  </dl>
                  <div className="mt-1 flex gap-3 text-[12px]">
                    <button type="button" onClick={() => setOpen(expanded ? null : key)}
                            aria-expanded={expanded} className="font-semibold text-accent">
                      {expanded ? '收起規格' : '完整規格'}
                    </button>
                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                      證交所簡介 ↗
                    </a>
                  </div>
                  {expanded && (
                    <table className="mt-1.5 w-full text-[12px]">
                      <tbody>
                        {it.fields.map(([k, v], i) => (
                          <tr key={i} className="border-t border-line/60 align-top">
                            <th className="w-[38%] py-1 pr-2 text-left font-normal text-faint">{k}</th>
                            <td className="py-1 text-ink">{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="text-sm font-bold text-ink">募集與核准新聞</h2>
          <span className="text-[11.5px] text-faint">標題含 ETF 與募集／核准／掛牌等字</span>
        </div>
        {news.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-muted">最近的新聞裡沒有相關標題。</p>
        ) : (
          <ul className="mt-1.5">
            {news.slice(0, 15).map(n => (
              <li key={n.u} className="border-b border-line/60 py-1.5 last:border-0">
                <a href={n.u} target="_blank" rel="noopener noreferrer"
                   className="text-[13px] text-ink hover:text-accent hover:underline">{n.t}</a>
                <div className="text-[11px] text-faint">{n.s}{n.at ? ` · ${n.at.slice(0, 10)}` : ''}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        上面的清單來自證交所 ETF e添富的「新上市ETF 相關簡介」，通常在上市前一天發布，
        只有上市（證交所），不含上櫃。金管會核准、還在募集中的 ETF 目前沒有官方的結構化清單，
        所以只能從新聞標題看 —— 那一欄只放標題與連結，內文請到原站閱讀。
      </p>
    </div>
  );
}
