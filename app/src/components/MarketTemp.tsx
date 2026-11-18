/* 首頁的市場溫度（2026-11-18 站主：首頁上方放三個數字，點了到籌碼頁）。
 * 大盤維持率（證交所口徑）、維持率 < 130% 的股票家數、站上 20 日線的股票比例。資料是部署時產生的 market_temp.json（幾百位元組）。
 * 數字標紅：大盤維持率 < 156（籌碼頁 MAINT_T 的加速區上緣）、< 130% 家數比 90% 歷史日子多、站上 20 日線 ≤ 15%。 */
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { fetchMarketTemp, type MarketTemp as Temp } from '../api/market';
import { MAINT_T } from '../lib/chips';

export function MarketTemp() {
  const [t, setT] = useState<Temp | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetchMarketTemp(ac.signal).then(setT).catch(() => {});
    return () => ac.abort();
  }, []);
  if (!t || (!t.keep && !t.dist && !t.ma)) return null;
  const cells: Array<{ label: string; value: string; sub: string; hot: boolean }> = [];
  if (t.keep) {
    cells.push({ label: '大盤維持率', value: `${t.keep[1].toFixed(1)}%`, sub: t.keep[0].slice(5), hot: t.keep[1] < MAINT_T.accel });
  }
  if (t.dist) {
    cells.push({ label: '維持率 < 130% 的股票', value: `${t.dist[2].toLocaleString('zh-TW')} 檔`,
                 sub: `占 ${t.dist[3].toFixed(0)}%・${t.dist[0].slice(5)}`, hot: t.dist[4] >= 90 });
  }
  if (t.ma) {
    cells.push({ label: '站上 20 日線的股票', value: `${t.ma[1].toFixed(0)}%`, sub: t.ma[0].slice(5), hot: t.ma[1] <= 15 });
  }
  return (
    <Link to="/chips" aria-label="市場溫度，點了看籌碼頁"
          className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-line bg-surface p-2.5 hover:border-accent/50">
      {cells.map(c => (
        <div key={c.label} className="min-w-0">
          <div className="truncate text-[11px] text-muted">{c.label}</div>
          <div className={`font-mono text-[16px] font-bold tabular-nums ${c.hot ? 'text-up' : 'text-ink'}`}>{c.value}</div>
          <div className="truncate text-[10.5px] text-faint">{c.sub}</div>
        </div>
      ))}
    </Link>
  );
}
