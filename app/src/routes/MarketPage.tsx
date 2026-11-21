/* 市場總覽（#/market，市場 → 總覽；2026-11-21 站主：簡潔說明市場（籌碼）狀況，快速知道現在該注意什麼）。
 * 規則在 lib/marketSummary.ts；資料＝chips.json（部署時產生）＋nextday.json（隔日漲跌）。 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { fetchChips } from '../api/chips';
import type { ChipsData } from '../lib/chips';
import { LEVEL_LABEL, headline, marketItems, type Level, type MarketItem, type NextdayLite } from '../lib/marketSummary';

// 燈號用琥珀／黃／灰：台股紅漲綠跌，紅綠會被看成方向
const LEVEL_COLOR: Record<Level, string> = { 2: '#d97706', 1: '#ca8a04', 0: '#9ca3af' };
const GROUPS: MarketItem['group'][] = ['信用交易', '波動與選擇權', '期貨籌碼', '市場廣度'];

export function MarketPage() {
  const [chips, setChips] = useState<ChipsData | null | undefined>(undefined);
  const [nd, setNd] = useState<NextdayLite | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetchChips(ac.signal).then(d => { if (!ac.signal.aborted) setChips(d); }).catch(() => { if (!ac.signal.aborted) setChips(null); });
    fetch(`${import.meta.env.BASE_URL}data/nextday.json`, { signal: ac.signal, cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null)).then(j => { if (!ac.signal.aborted && j?.bands) setNd(j as NextdayLite); }).catch(() => {});
    return () => ac.abort();
  }, []);
  const items = useMemo(() => (chips ? marketItems(chips, nd) : []), [chips, nd]);
  const hl = useMemo(() => headline(items), [items]);

  if (chips === undefined) return <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-muted">載入中…</p>;
  if (!chips) return <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-muted">籌碼資料暫時讀不到，請稍後再試。</p>;

  return (
    <div className="mx-auto max-w-2xl">
      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h1 className="text-base font-bold text-ink">市場總覽</h1>
          <span className="text-[11.5px] text-faint">{chips.meta.date} 收盤籌碼</span>
        </div>
        <p className="mt-1.5 text-[14px] font-semibold leading-snug text-ink">{hl.text}</p>
        <p className="mt-1 text-[12px] text-muted">
          <span style={{ color: LEVEL_COLOR[2] }} className="font-semibold">警戒 {hl.warn.length}</span>
          {' · '}<span style={{ color: LEVEL_COLOR[1] }} className="font-semibold">注意 {hl.watch.length}</span>
          {' · '}正常 {items.length - hl.warn.length - hl.watch.length}
        </p>
        {hl.warn.length > 0 && (
          <ul className="mt-2 space-y-1 rounded-lg border-l-4 bg-sunken/40 px-2.5 py-2 text-[12.5px] leading-snug text-ink"
              style={{ borderColor: LEVEL_COLOR[2] }}>
            {hl.warn.map(i => (
              <li key={i.key}><b>{i.label} {i.value}</b>：{i.text}</li>
            ))}
          </ul>
        )}
      </section>

      {GROUPS.map(g => {
        const list = items.filter(i => i.group === g);
        if (!list.length) return null;
        return (
          <section key={g} className="mt-3 rounded-xl border border-line bg-surface p-3 sm:p-4">
            <h2 className="text-[13px] font-bold text-ink">{g}</h2>
            <ul className="mt-1 divide-y divide-line">
              {list.map(i => (
                <li key={i.key}>
                  <Link to={i.to} className="block py-2 hover:bg-sunken/40">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-baseline gap-1.5 text-[13px] text-ink">
                        <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 translate-y-[1px] rounded-full" style={{ background: LEVEL_COLOR[i.level] }} />
                        <span className="truncate">{i.label}</span>
                        <span className="shrink-0 text-[10.5px] font-semibold" style={{ color: LEVEL_COLOR[i.level] }}>{LEVEL_LABEL[i.level]}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[14px] font-bold tabular-nums text-ink">{i.value}</span>
                    </div>
                    <div className="mt-0.5 pl-4 text-[12px] leading-snug text-muted">{i.text}</div>
                    {i.sub && <div className="pl-4 text-[11px] text-faint">{i.sub}</div>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="mt-3 px-1 text-[11px] leading-relaxed text-faint">
        燈號只標「現在少見、要多看一眼」的狀態，不是買賣建議。有長歷史的指標（維持率、漲跌家數、站上均線、正逆價差、融資）用歷史百分位或籌碼頁同一套門檻；
        臺指 VIX、外資、散戶、P/C 只有近幾個月資料，用絕對門檻或近幾個月的相對位置。點任一行看詳細。
      </p>
    </div>
  );
}
