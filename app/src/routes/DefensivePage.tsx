/* 民生必需股（#/defensive，商品 → 民生股；2026-11-21 站主：「增加一些民生必需品的股票，看建議持有價等條件，例如中華電／遠傳／台哥大」）。
 * 資料 defensive.json（scripts/fetch_defensive.py，每日更新）；規則在 lib/defensive.ts。 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  ZONE_HINT, ZONE_LABEL, ZONE_ORDER, scale, sortRows, zoneOf, type Band, type DefData, type DefRow, type Zone,
} from '../lib/defensive';

// 區的顏色：便宜用網站主色（藍），昂貴用琥珀；不用紅綠（台股紅漲綠跌）
const ZONE_COLOR: Record<Zone, string> = { cheap: '#2563eb', fairLow: '#60a5fa', fairHigh: '#f59e0b', rich: '#d97706' };
const px = (v: number | null | undefined) => (v == null ? '—' : v >= 1000 ? Math.round(v).toLocaleString('zh-TW') : v.toFixed(v >= 100 ? 1 : 2));

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

function Card({ r }: { r: DefRow }) {
  const [open, setOpen] = useState(false);
  const z = zoneOf(r.price, r.byYield);
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
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Link to="/stock" search={{ code: r.c }} className="min-w-0 truncate text-[14px] font-bold text-ink hover:text-accent">
          {r.n} <span className="font-mono text-[12px] font-normal text-faint">{r.c}</span>
        </Link>
        <span className="shrink-0 font-mono text-[16px] font-bold tabular-nums text-ink">{px(r.price)}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-2 text-[11.5px] text-muted">
        <span>{r.cat}{r.i ? `・${r.i}` : ''}</span>
        <span>殖利率 <b className="font-mono text-ink">{r.yield?.toFixed(2) ?? '—'}%</b>
          {r.yieldRank != null && <>（10 年第 {Math.round(r.yieldRank * 100)} 百分位）</>}</span>
      </div>
      {z && (
        <div className="mt-1.5 text-[12.5px] font-semibold" style={{ color: ZONE_COLOR[z] }}>
          {ZONE_LABEL[z]}<span className="ml-1.5 font-normal text-muted">{ZONE_HINT[z]}</span>
        </div>
      )}
      {r.byYield && <Bar r={r} b={r.byYield} />}
      <div className="mt-1.5 text-[11.5px] leading-snug text-muted">
        股利 {r.divYear} 年 <b className="font-mono text-ink">{r.div?.toFixed(2) ?? '—'}</b> 元・近 5 年平均 {r.avg5?.toFixed(2) ?? '—'}・近 {r.streak} 年每年都有配息
        {r.chg1y != null && <>・一年 {r.chg1y >= 0 ? '+' : '−'}{Math.abs(r.chg1y * 100).toFixed(1)}%</>}
      </div>
      <button type="button" onClick={() => setOpen(v => !v)} className="mt-1 text-[12px] font-semibold text-accent">
        {open ? '收起' : '其他估價方法與歷年股利'}
      </button>
      {open && (
        <div className="mt-1.5">
          <table className="w-full text-[11.5px] tabular-nums">
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
          <div className="mt-1.5 text-[11px] text-muted">
            歷年現金股利：{r.divs.map(([y, v]) => `${y} ${v.toFixed(2)}`).join('・')}
          </div>
          <div className="text-[11px] text-faint">52 週 {px(r.lo52)}～{px(r.hi52)}・股價 {r.pdate}</div>
        </div>
      )}
    </li>
  );
}

export function DefensivePage() {
  const [d, setD] = useState<DefData | null | undefined>(undefined);
  const [cat, setCat] = useState('全部');
  useEffect(() => {
    const ac = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/defensive.json`, { signal: ac.signal, cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null)).then(j => { if (!ac.signal.aborted) setD(j?.rows ? (j as DefData) : null); })
      .catch(() => { if (!ac.signal.aborted) setD(null); });
    return () => ac.abort();
  }, []);
  const rows = useMemo(() => (d ? sortRows(d.rows) : []), [d]);
  const cats = useMemo(() => ['全部', ...Array.from(new Set(rows.map(r => r.cat)))], [rows]);
  if (d === undefined) return <p className="mt-6 text-center text-sm text-muted">載入中…</p>;
  if (!d) return <p className="mt-6 text-center text-sm text-muted">民生股資料暫時讀不到，請稍後再試。</p>;
  const shown = rows.filter(r => cat === '全部' || r.cat === cat);
  const cnt = (z: Zone) => rows.filter(r => zoneOf(r.price, r.byYield) === z).length;
  return (
    <div>
      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h1 className="text-base font-bold text-ink">民生必需股：建議持有價</h1>
          <span className="text-[11.5px] text-faint">{d.meta.date} 收盤</span>
        </div>
        <p className="mt-1 max-w-[78ch] text-[12px] leading-snug text-muted">
          電信、食品、超商、燃氣、保全、高鐵這類「景氣差也要用」的股票。便宜／合理／昂貴價用<b className="text-ink">這檔自己近 {d.meta.years} 年的殖利率分布</b>換算
          （便宜＝最近全年股利 ÷ 歷史第 80 百分位殖利率，合理 ÷ 第 50，昂貴 ÷ 第 20），比傳統「股利 ×16／20／32」更貼近每檔自己的行情。
        </p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
          {ZONE_ORDER.map(z => <span key={z} style={{ color: ZONE_COLOR[z] }} className="font-semibold">{ZONE_LABEL[z]} {cnt(z)}</span>)}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cats.map(c => (
            <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}
                    className={`h-7 rounded-lg px-2.5 text-[12px] font-semibold ${cat === c ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}>
              {c}
            </button>
          ))}
        </div>
      </section>
      <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start xl:grid-cols-3">
        {shown.map(r => <Card key={r.c} r={r} />)}
      </ul>
      <p className="mt-3 max-w-[78ch] px-1 text-[11px] leading-relaxed text-faint">
        只是「現在價格在這檔自己歷史區間的哪裡」，不是買賣建議。公司基本面變了（電信降價戰、燃氣調價、通路展店），歷史區間就不一定適用；
        殖利率用最近一次全年現金股利，除息前後會跳動。資料：{d.meta.source}。點股票名稱看個股頁（財報、本益比河流圖、籌碼）。
      </p>
    </div>
  );
}
