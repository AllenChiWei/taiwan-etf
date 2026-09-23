/* 散戶多空比驗收：依多空比分五組，看之後指數怎麼走。
 *
 * 跟 AtmSection 一樣自己抓資料（retail.json，進版控），所以籌碼那份缺席時
 * 這一區照樣出現。計算都在 lib/retail.ts。
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchRetail } from '../api/retail';
import { retailPoints, backtest, type RetailData } from '../lib/retail';
import { netTone } from '../lib/chips';
import { TONE_CLASS } from '../lib/format';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pct = (v: number, f = nf2) => `${v > 0 ? '+' : ''}${f.format(v)}%`;

const CONTRACTS = [
  { id: 'MTX', label: '小台' },
  { id: 'TMF', label: '微台' },
] as const;
const HORIZONS = [5, 20] as const;
const GROUP_LABEL = ['最偏空', '偏空', '中間', '偏多', '最偏多'];

function Chip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
        active ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
    >
      {children}
    </button>
  );
}

export function RetailSection() {
  const [data, setData] = useState<RetailData | null>(null);
  const [cid, setCid] = useState<string>('MTX');
  const [h, setH] = useState<number>(5);

  useEffect(() => {
    const ac = new AbortController();
    fetchRetail(ac.signal)
      .then(d => { if (!ac.signal.aborted) setData(d); })
      .catch(() => { if (!ac.signal.aborted) setData(null); });
    return () => ac.abort();
  }, []);

  const points = useMemo(() => (data ? retailPoints(data, cid) : []), [data, cid]);
  const bt = useMemo(() => (data ? backtest(points, data.taiex, h) : null), [data, points, h]);

  if (!data || !bt) return null;               // 沒有資料或樣本不夠就整區不出現
  const { groups, base, latest, latestGroup, latestPct } = bt;

  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-bold text-ink">散戶多空比準不準</h2>
        <span className="text-[11.5px] text-faint">
          {points[0]?.d} 起 · {nf0.format(points.length)} 個交易日
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {CONTRACTS.map(c => (
          <Chip key={c.id} active={cid === c.id} onClick={() => setCid(c.id)}>{c.label}</Chip>
        ))}
        <span className="mx-1 self-center text-line">|</span>
        {HORIZONS.map(n => (
          <Chip key={n} active={h === n} onClick={() => setH(n)}>之後 {n} 日</Chip>
        ))}
      </div>

      {latest && latestPct !== null && latestGroup !== null && (
        <p className="mt-2 text-[12.5px] text-muted">
          {latest.d} 散戶多空比
          <strong className={`mx-1 font-mono tabular-nums ${TONE_CLASS[netTone(latest.ratio)]}`}>
            {pct(latest.ratio)}
          </strong>
          ，比過去 <strong className="text-ink">{nf0.format(latestPct)}%</strong> 的日子偏多，
          落在「<strong className="text-ink">{GROUP_LABEL[latestGroup]}</strong>」那一組。
        </p>
      )}

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[320px] text-[12px]">
          <thead>
            <tr className="text-left text-[11px] text-faint">
              <th className="py-1 pr-2 font-medium">多空比分組</th>
              <th className="py-1 pr-2 text-right font-medium">天數</th>
              <th className="py-1 pr-2 text-right font-medium">之後 {h} 日平均</th>
              <th className="py-1 text-right font-medium">上漲機率</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, i) => (
              <tr key={i} className={`border-t border-line/60 ${
                i === latestGroup ? 'bg-accent/10' : ''}`}>
                <td className="py-1 pr-2">
                  <span className="text-ink">{GROUP_LABEL[i]}</span>
                  {i === latestGroup && (
                    <span className="ml-1 text-[10.5px] font-semibold text-accent">← 現在</span>
                  )}
                  <span className="block font-mono text-[10.5px] tabular-nums text-faint">
                    {nf1.format(g.lo)}% ～ {nf1.format(g.hi)}%
                  </span>
                </td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums text-muted">{g.n}</td>
                {/* 數字本身不上色：+0.76% 塗成綠色會被讀成下跌。
                    紅綠只用在下面那行「比基準」，那才是這張表要比的東西 */}
                <td className="py-1 pr-2 text-right font-mono tabular-nums text-ink">
                  {pct(g.avg)}
                  <span className={`block text-[10.5px] ${TONE_CLASS[netTone(g.avg - base.avg)]}`}>
                    比基準 {g.avg - base.avg > 0 ? '+' : ''}{nf2.format(g.avg - base.avg)}
                  </span>
                </td>
                <td className="py-1 text-right font-mono tabular-nums text-ink">
                  {nf0.format(g.up * 100)}%
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-line font-semibold">
              <td className="py-1 pr-2 text-ink">全部日子（基準）</td>
              <td className="py-1 pr-2 text-right font-mono tabular-nums text-muted">{base.n}</td>
              <td className="py-1 pr-2 text-right font-mono tabular-nums text-ink">{pct(base.avg)}</td>
              <td className="py-1 text-right font-mono tabular-nums text-ink">
                {nf0.format(base.up * 100)}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        每一天依散戶多空比由低到高排序、切成五組，看各組之後 {h} 個交易日加權指數的漲跌。
        要跟最後一列的基準比：這段期間指數漲很多，每一組平均都可能是正的；
        「比基準」紅色是之後表現比平常好、綠色是比平常差。
        如果「最偏多」那組明顯比基準差，散戶多空比才算得上反向指標。
        相鄰日子的「之後 {h} 日」大部分是同一段行情，實際獨立的樣本比天數少很多，
        看方向就好。散戶是推算的：全市場未平倉扣掉三大法人。
      </p>
    </section>
  );
}
