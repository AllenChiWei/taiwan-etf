/* 隔日加權指數漲跌幅（#/nextday 獨立頁；2026-11-21 使用者：做選擇權用，知道隔天最多漲／跌到哪，去賣嚴重偏離的履約價）。
 * 數字由 scripts/fetch_nextday.py 每天算好放 nextday.json；方法與驗證見 lib/nextday.ts、腳本檔頭。 */

import { useEffect, useState } from 'react';
import {
  REGIME_LABEL, breached, callStrikeAbove, levelOf, putStrikeBelow, type NextdayData,
} from '../lib/nextday';
import { WEEKDAY_LABEL, weekdayOf } from '../lib/atm';
import { NextDayChannel } from './NextDayChannel';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const pct = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(d)}%`;
const prob = (p: number) => `${(p * 100).toFixed(p >= 0.995 ? 1 : 0)}%`;

function dayLabel(iso: string): string {
  const wd = weekdayOf(iso);
  return `${iso.slice(5).replace('-', '/')}${wd === null ? '' : `（${WEEKDAY_LABEL[wd]}）`}`;
}

export function NextDaySection() {
  const [d, setD] = useState<NextdayData | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/nextday.json`, { signal: ac.signal, cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!ac.signal.aborted && j?.bands) setD(j as NextdayData); })
      .catch(() => {});
    return () => ac.abort();
  }, []);
  if (!d) return null;
  const m = d.meta;
  const close = m.close;
  const c95 = d.check.find(c => c.p === 0.95);
  const c99 = d.check.find(c => c.p === 0.99);

  return (
    <section id="sec-nextday" className="mt-3 scroll-mt-16 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1 className="text-base font-bold text-ink">隔日漲跌幅：明天加權指數可能到哪</h1>
        <span className="text-[11.5px] text-faint">{m.date} 收盤</span>
      </div>
      <p className="mt-1 text-[12px] text-muted">
        以 {dayLabel(m.date)} 收盤 <b className="font-mono text-ink">{nf0.format(close)}</b> 為基準，
        看下一個交易日 <b className="text-ink">{dayLabel(m.next)}</b>
        {m.regime !== 'normal' && <span className="ml-1 rounded bg-sunken px-1.5 py-0.5 text-[11px] text-ink">{REGIME_LABEL[m.regime]}，波動通常比較大</span>}
        。日波動取 <b className="font-mono text-ink">{(m.sigma * 100).toFixed(2)}%</b>
        {m.sigmaE !== undefined && <>（近期實際 EWMA {(m.sigmaE * 100).toFixed(2)}%、選擇權隱含 {m.sigmaIv ? `${(m.sigmaIv * 100).toFixed(2)}%` : '—'}，取較大）</>}。
        {m.sigmaIv && m.sigmaE !== undefined && m.sigmaIv > m.sigmaE * 1.1 && <b className="ml-1 text-ink">選擇權報價比實際波動貴（市場恐慌），通道已跟著放寬。</b>}
      </p>

      {m && d.maint && d.maint.value != null && <MaintBox d={d} />}

      <table className="mt-2 w-full text-[12px]">
        <thead>
          <tr className="text-right text-[11px] text-faint">
            <th className="py-1 pr-2 text-left font-medium">機率</th>
            <th className="py-1 pr-2 font-medium">最高不超過<br />（賣買權 ≥）</th>
            <th className="py-1 font-medium">最低不跌破<br />（賣賣權 ≤）</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {d.bands.map(b => {
            const hi = levelOf(close, b.up), lo = levelOf(close, b.dn);
            const capHi = b.up >= m.limit - 1e-9, capLo = b.dn <= -m.limit + 1e-9;
            return (
              <tr key={b.p} className="text-right font-mono tabular-nums">
                <td className="py-1.5 pr-2 text-left font-sans font-semibold text-ink">{prob(b.p)}</td>
                <td className="py-1.5 pr-2">
                  <div className="text-up">{nf0.format(hi)} <span className="text-[11px]">{pct(b.up)}</span></div>
                  <div className="text-[11px] text-muted">{capHi ? '到漲停上限' : `買權 ${nf0.format(callStrikeAbove(hi))} 以上`}</div>
                </td>
                <td className="py-1.5">
                  <div className="text-down">{nf0.format(lo)} <span className="text-[11px]">{pct(b.dn)}</span></div>
                  <div className="text-[11px] text-muted">{capLo ? '到跌停下限' : `賣權 ${nf0.format(putStrikeBelow(lo))} 以下`}</div>
                </td>
              </tr>
            );
          })}
          {/* 2026-11-21 使用者：加上前收 ×1.1／×0.9（漲跌停價）—— 指數一天不可能超過，賣在這之外理論上碰不到 */}
          <tr className="bg-sunken/50 text-right font-mono tabular-nums">
            <td className="py-1.5 pr-2 text-left font-sans font-semibold text-ink">
              漲跌停<div className="text-[10.5px] font-normal text-muted">前收 ×1.1／×0.9</div>
            </td>
            <td className="py-1.5 pr-2">
              <div className="font-semibold text-up">{nf0.format(levelOf(close, m.limit))} <span className="text-[11px]">{pct(m.limit, 0)}</span></div>
              <div className="text-[11px] text-muted">買權 {nf0.format(callStrikeAbove(levelOf(close, m.limit)))} 以上</div>
            </td>
            <td className="py-1.5">
              <div className="font-semibold text-down">{nf0.format(levelOf(close, -m.limit))} <span className="text-[11px]">{pct(-m.limit, 0)}</span></div>
              <div className="text-[11px] text-muted">賣權 {nf0.format(putStrikeBelow(levelOf(close, -m.limit)))} 以下</div>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[11px] leading-snug text-faint">
        「99%」＝依過去同類型的日子，明天盤中最高有 99% 機會不超過這個數（最低同理）。
        「漲跌停」＝個股漲跌停 ±{(m.limit * 100).toFixed(0)}%，加權指數一天不會超過（實際上要所有權值股同時漲停／跌停才會碰到）。
        歷史最大：隔日最高 {pct(d.extremes.H.v)}（{d.extremes.H.d1}）、最低 {pct(d.extremes.L.v)}（{d.extremes.L.d1}）。
      </p>

      {d.iv && d.iv.check.length > 0 && (() => {
        const g95 = d.iv!.check.find(c => c.p === 0.95), g99 = d.iv!.check.find(c => c.p === 0.99);
        const p1 = (v: number) => `${(v * 100).toFixed(1)}%`;
        return g95 && g99 ? (
          <p className="mt-1.5 rounded-lg bg-sunken/60 px-2.5 py-1.5 text-[11.5px] text-muted">
            <b className="text-ink">加入選擇權隱含波動</b>（恐慌指數的同一種東西：價平和反推的預期波動）：{d.iv!.from} 起 {d.iv!.days} 天，
            95% 區間被突破 只用實際波動 上 {p1(g95.upE)}／下 {p1(g95.dnE)} → 取大 上 {p1(g95.up)}／下 {p1(g95.dn)}；
            99% {p1(g99.upE)}／{p1(g99.dnE)} → {p1(g99.up)}／{p1(g99.dn)}（應各 5%、1%）。預測隔日振幅的解釋力 R² 0.40，只用實際波動 0.16。
          </p>
        ) : null;
      })()}

      {c95 && c99 && (
        <p className="mt-1.5 rounded-lg bg-sunken/60 px-2.5 py-1.5 text-[11.5px] text-muted">
          <b className="text-ink">準不準</b>：用 {m.checkFrom} 以後 {m.checkDays} 天做樣本外驗證（只用當時以前的資料算），
          95% 區間實際被突破 上 {prob(c95.up)}／下 {prob(c95.dn)}（應各 5%），
          99% 區間 上 {prob(c99.up)}／下 {prob(c99.dn)}（應各 1%）—— 極端行情比歷史稍多，賣得太近要留餘裕。
        </p>
      )}

      {d.series && d.series.length > 2 && (
        <>
          <h2 className="mt-3 text-[13px] font-bold text-ink">通道推移</h2>
          <NextDayChannel series={d.series} />
        </>
      )}

      <h3 className="mt-3 text-[12.5px] font-bold text-ink">最近 10 天：實際 vs 當時的 95% 區間</h3>
      <table className="mt-1 w-full text-[12px]">
        <thead>
          <tr className="text-right text-[11px] text-faint">
            <th className="py-0.5 pr-2 text-left font-medium">隔日</th>
            <th className="py-0.5 pr-2 font-medium">實際 高／低</th>
            <th className="py-0.5 pr-2 font-medium">95% 區間</th>
            <th className="py-0.5 font-medium">結果</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {[...d.recent].reverse().map(r => {
            const b95 = breached(r, 95), b99 = breached(r, 99);
            return (
              <tr key={r.d} className="text-right font-mono tabular-nums">
                <td className="py-1 pr-2 text-left font-sans text-ink">{dayLabel(r.d1)}</td>
                <td className="py-1 pr-2"><span className="text-up">{pct(r.H)}</span>／<span className="text-down">{pct(r.L)}</span></td>
                <td className="py-1 pr-2 text-muted">{pct(r.up95)}／{pct(r.dn95)}</td>
                <td className="py-1 font-sans text-[11.5px]">
                  {b99 ? <b className="text-ink">破 99%</b> : b95 ? <b className="text-ink">破 95%</b> : <span className="text-muted">在內</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-2 text-[11px] leading-snug text-faint">
        方法：{m.since.slice(0, 4)} 年起每一天「隔日最高、最低 ÷ 今收」除以當天的 EWMA 日標準差（λ 0.94）取分位數，再乘上今天的日波動（EWMA 和選擇權隱含取大；布林通道寬度＝20 日標準差，研究時比 EWMA 不準所以不用；美國 VIX 也比較差）；一般交易日、跨週末、連假後各用自己那一組（99% 倍數 一般 {m.mult99.normal[0]}／{m.mult99.normal[1]}、
        跨週末 {m.mult99.weekend[0]}／{m.mult99.weekend[1]}、連假 {m.mult99.holiday[0]}／{m.mult99.holiday[1]} 倍標準差；連假樣本只有 {m.counts.holiday} 天）。
        週選到期結算看的是結算價（13:00～13:30 平均），盤中最高最低影響的是保證金與停損。履約價以 50 點取整，實際掛牌以期交所為準。僅供參考，不構成投資建議。
      </p>
    </section>
  );
}

/** 融資維持率：低於門檻時通道已放寬多少，以及近 3 年低維持率日的實際突破率（比名目高很多，要照實講） */
function MaintBox({ d }: { d: NextdayData }) {
  const mt = d.maint!;
  const b95 = d.bands.find(b => b.p === 0.95);
  const c95 = d.check.find(c => c.p === 0.95), c99 = d.check.find(c => c.p === 0.99);
  const f95 = mt.factors['0.95'];
  const p1 = (v: number) => `${(v * 100).toFixed(1)}%`;
  return (
    // 警示用琥珀色（台股紅漲綠跌，用綠色會被看成「沒事」）
    <div className="mt-2 rounded-lg border border-line bg-sunken/40 px-2.5 py-2 text-[11.5px] leading-snug text-muted"
         style={mt.low ? { borderColor: '#d97706', borderLeftWidth: 4 } : undefined}>
      <div className="text-[12.5px] text-ink">
        融資維持率 <b className="font-mono" style={mt.low ? { color: '#d97706' } : undefined}>{mt.value!.toFixed(1)}%</b>
        <span className="ml-1 text-[11px] text-faint">（{mt.date}）</span>
        {mt.low ? <b className="ml-1.5" style={{ color: '#d97706' }}>低於 {mt.thr}：斷頭賣壓可能加速破低</b> : <span className="ml-1.5">高於 {mt.thr}，不調整</span>}
      </div>
      {mt.low && b95 && b95.dn0 !== undefined && (
        <p className="mt-1">
          通道已依維持率放寬：95% 上緣 ×{f95[0].toFixed(2)}、下緣 ×{f95[1].toFixed(2)}
          （下緣 {pct(b95.dn0)} → <b className="text-ink">{pct(b95.dn)}</b>；係數＝2009 年起維持率低於 {mt.thr} 的 {nf0.format(mt.lowDays)} 天和全部日子的倍數比）。
        </p>
      )}
      {c95?.lowUp0 !== undefined && c99?.lowUp0 !== undefined && (
        <p className="mt-1">
          <b className="text-ink">要留意</b>：最近 3 年維持率低於 {mt.thr} 的日子，95% 區間實際被突破 上 {p1(c95.lowUp0!)}／下 {p1(c95.lowDn0!)}、
          99% 區間 上 {p1(c99.lowUp0!)}／下 {p1(c99.lowDn0!)}（正常應各 5%、1%）—— <b className="text-ink">上下都比平常猛</b>（破底之後常急彈）。
          維持率低時把 95% 當 90% 看，賣在 99% 之外比較保險。
        </p>
      )}
      <p className="mt-1 text-[11px] text-faint">
        維持率低於 140 的日子 2009 年起只有 {mt.below140.days} 天，隔日收盤平均 {pct(mt.below140.avgC, 2)}（斷頭賣完常反彈），樣本太少不另外調整。
      </p>
    </div>
  );
}
