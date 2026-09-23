/* 還沒上市的 ETF。已上市的不列（站主指定）。
 *
 * 計算都在 lib/upcoming.ts。畫面要講清楚資料的性質：官方沒有「募集中」的清單，
 * 代號與日期是從新聞推的；上市前一天證交所簡介出來後才有官方的完整規格。
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchUpcoming } from '../api/extras';
import {
  stillUpcoming, taipeiToday, daysUntil, pick, STAGE_LABEL,
  type UpcomingData, type Stage,
} from '../lib/upcoming';

const STAGE_TONE: Record<Stage, string> = {
  raising: 'bg-sunken text-muted',
  listing: 'bg-accent text-accent-ink',
  tomorrow: 'bg-up text-white',
};

export function UpcomingEtfs() {
  const [data, setData] = useState<UpcomingData | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const today = useMemo(() => taipeiToday(), []);

  useEffect(() => {
    const ac = new AbortController();
    fetchUpcoming(ac.signal).then(d => { if (!ac.signal.aborted) setData(d); })
      .catch(() => { if (!ac.signal.aborted) setData(null); });
    return () => ac.abort();
  }, []);

  const items = data ? stillUpcoming(data.items, today) : [];

  return (
    <div className="pt-4">
      <section className="rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="text-sm font-bold text-ink">還沒上市的 ETF</h2>
          {data && <span className="text-[11.5px] text-faint">更新 {data.meta.updated}</span>}
        </div>

        {data === undefined && <p className="py-8 text-center text-[13px] text-muted">載入中…</p>}
        {data === null && <p className="py-8 text-center text-[13px] text-muted">還沒有資料。</p>}
        {data && items.length === 0 && (
          <p className="py-8 text-center text-[13px] text-muted">目前沒有查到募集中或待上市的 ETF。</p>
        )}

        {items.length > 0 && (
          <ul className="mt-2 space-y-2">
            {items.map(it => {
              const expanded = open === it.code;
              const left = daysUntil(it.listing, today);
              const target = pick(it.fields, '追蹤指數名稱', '績效指標', '標的指數');
              const freq = pick(it.fields, '配息頻率');
              const fee = pick(it.fields, '管理費');
              return (
                <li key={it.code} className="rounded-lg border border-line bg-bg p-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="min-w-0 text-[14px] font-semibold text-ink">
                      <span className="font-mono text-[12.5px] text-muted">{it.code}</span>{' '}
                      {it.name ?? <span className="font-normal text-faint">名稱待確認</span>}
                    </span>
                    <span className={`shrink-0 rounded px-1.5 py-px text-[11px] font-bold ${STAGE_TONE[it.stage]}`}>
                      {STAGE_LABEL[it.stage]}
                    </span>
                  </div>
                  <dl className="mt-1 grid gap-x-3 gap-y-0.5 text-[12px] sm:grid-cols-3">
                    <div><dt className="inline text-faint">投信 </dt><dd className="inline text-muted">{it.issuer ?? '—'}</dd></div>
                    <div><dt className="inline text-faint">開募 </dt><dd className="inline text-muted">{it.raise ?? '—'}</dd></div>
                    <div>
                      <dt className="inline text-faint">上市 </dt>
                      <dd className="inline text-muted">
                        {it.listing ? `${it.listing}${left !== null ? `（${left} 天後）` : ''}` : '尚未公布'}
                      </dd>
                    </div>
                    {freq && <div><dt className="inline text-faint">配息 </dt><dd className="inline text-muted">{freq}</dd></div>}
                    {target && <div className="min-w-0 sm:col-span-3"><dt className="inline text-faint">指數／指標 </dt><dd className="inline text-muted">{target}</dd></div>}
                    {fee && <div className="min-w-0 sm:col-span-3"><dt className="inline text-faint">管理費 </dt><dd className="inline text-muted">{fee}</dd></div>}
                  </dl>
                  <p className="mt-0.5 text-[10.5px] text-faint">
                    {it.source === 'twse' ? '資料：證交所新上市簡介（官方）' : '資料：從新聞推得，以投信公告為準'}
                  </p>

                  {it.news.length > 0 && (
                    <ul className="mt-1.5 border-t border-line/60 pt-1">
                      {it.news.slice(0, 3).map(([t, u, d]) => (
                        <li key={u} className="py-0.5 text-[12px]">
                          <a href={u} target="_blank" rel="noopener noreferrer"
                             className="text-ink hover:text-accent hover:underline">{t}</a>
                          <span className="ml-1.5 text-[10.5px] text-faint">{d.slice(5)}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {it.fields.length > 0 && (
                    <div className="mt-1 flex gap-3 text-[12px]">
                      <button type="button" onClick={() => setOpen(expanded ? null : it.code)}
                              aria-expanded={expanded} className="font-semibold text-accent">
                        {expanded ? '收起規格' : '完整規格'}
                      </button>
                      {it.url && (
                        <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                          證交所簡介 ↗
                        </a>
                      )}
                    </div>
                  )}
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

      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        官方沒有「已核准、募集中」ETF 的清單（查過證交所、集保、投信投顧公會），所以這份清單是
        從鉅亨網近兩個多月的新聞裡找出還沒上市的代號，再從新聞推出名稱、投信與日期 ——
        推不出來的就留空，一切以投信公告為準。上市前一天證交所會發布新上市簡介，那時會換成
        官方的完整規格。已上市的不列，請到「ETF 清單」看。新聞只放標題與連結。
      </p>
    </div>
  );
}
