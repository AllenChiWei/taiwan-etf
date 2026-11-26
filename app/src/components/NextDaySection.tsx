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
      <Hero d={d} />
      <p className="mt-2 max-w-[85ch] text-[12px] text-muted">
        以 {dayLabel(m.date)} 收盤 <b className="font-mono text-ink">{nf0.format(close)}</b> 為基準，
        看下一個交易日 <b className="text-ink">{dayLabel(m.next)}</b>
        {m.regime !== 'normal' && <span className="ml-1 rounded bg-sunken px-1.5 py-0.5 text-[11px] text-ink">{REGIME_LABEL[m.regime]}，波動通常比較大</span>}
        。日波動取 <b className="font-mono text-ink">{(m.sigma * 100).toFixed(2)}%</b>
        {m.sigmaE !== undefined && <>（近期實際 EWMA {(m.sigmaE * 100).toFixed(2)}%、選擇權隱含 {m.sigmaIv ? `${(m.sigmaIv * 100).toFixed(2)}%` : '—'}，取較大）</>}。
        {m.sigmaIv && m.sigmaE !== undefined && m.sigmaIv > m.sigmaE * 1.1 && <b className="ml-1 text-ink">選擇權報價比實際波動貴（市場恐慌），通道已跟著放寬。</b>}
      </p>

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-5">
        <div className="min-w-0">
          <table className="w-full text-[12px]">
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
          <p className="mt-1.5 text-[11px] leading-snug text-faint">
            「99%」＝依過去同類型的日子，明天盤中最高有 99% 機會不超過這個數（最低同理）。
            「漲跌停」＝個股漲跌停 ±{(m.limit * 100).toFixed(0)}%，加權指數一天不會超過（實際上要所有權值股同時漲停／跌停才會碰到）。
            歷史最大：隔日最高 {pct(d.extremes.H.v)}（{d.extremes.H.d1}）、最低 {pct(d.extremes.L.v)}（{d.extremes.L.d1}）。
          </p>
        </div>

        <div className="min-w-0 space-y-2 [&>*]:mt-0">
          {m && d.maint && d.maint.value != null && <MaintBox d={d} />}

          {d.iv && d.iv.check.length > 0 && (() => {
            const g95 = d.iv!.check.find(c => c.p === 0.95), g99 = d.iv!.check.find(c => c.p === 0.99);
            const p1 = (v: number) => `${(v * 100).toFixed(1)}%`;
            return g95 && g99 ? (
              <p className="rounded-lg bg-sunken/60 px-2.5 py-1.5 text-[11.5px] text-muted">
                <b className="text-ink">加入選擇權隱含波動</b>（恐慌指數的同一種東西：價平和反推的預期波動）：{d.iv!.from} 起 {d.iv!.days} 天，
                95% 區間被突破 只用實際波動 上 {p1(g95.upE)}／下 {p1(g95.dnE)} → 取大 上 {p1(g95.up)}／下 {p1(g95.dn)}；
                99% {p1(g99.upE)}／{p1(g99.dnE)} → {p1(g99.up)}／{p1(g99.dn)}（應各 5%、1%）。預測隔日振幅的解釋力 R² 0.40，只用實際波動 0.16。
              </p>
            ) : null;
          })()}

          {c95 && c99 && (
            <p className="rounded-lg bg-sunken/60 px-2.5 py-1.5 text-[11.5px] text-muted">
              <b className="text-ink">準不準</b>：用 {m.checkFrom} 以後 {m.checkDays} 天做樣本外驗證（只用當時以前的資料算），
              95% 區間實際被突破 上 {prob(c95.up)}／下 {prob(c95.dn)}（應各 5%），
              99% 區間 上 {prob(c99.up)}／下 {prob(c99.dn)}（應各 1%）—— 極端行情比歷史稍多，賣得太近要留餘裕。
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:items-start xl:gap-5">
        {d.series && d.series.length > 2 && (
          <div className="min-w-0">
            <h2 className="text-[13px] font-bold text-ink">通道推移</h2>
            <NextDayChannel series={d.series} />
          </div>
        )}

        <div className="min-w-0">
          <h3 className="text-[12.5px] font-bold text-ink">最近 10 天：實際 vs 當時的 95% 區間</h3>
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
        </div>
      </div>

      <p className="mt-3 max-w-[85ch] text-[11px] leading-snug text-faint">
        方法：{m.since.slice(0, 4)} 年起每一天「隔日最高、最低 ÷ 今收」除以當天的 EWMA 日標準差（λ 0.94）取分位數，再乘上今天的日波動（EWMA 和選擇權隱含取大；布林通道寬度＝20 日標準差，研究時比 EWMA 不準所以不用；美國 VIX 也比較差）；一般交易日、跨週末、連假後各用自己那一組（99% 倍數 一般 {m.mult99.normal[0]}／{m.mult99.normal[1]}、
        跨週末 {m.mult99.weekend[0]}／{m.mult99.weekend[1]}、連假 {m.mult99.holiday[0]}／{m.mult99.holiday[1]} 倍標準差；連假樣本只有 {m.counts.holiday} 天）。
        週選到期結算看的是結算價（13:00～13:30 平均），盤中最高最低影響的是保證金與停損。履約價以 50 點取整，實際掛牌以期交所為準。僅供參考，不構成投資建議。
      </p>
    </section>
  );
}

/** 明天的預測點位，大字放最上面（2026-11-21 使用者：預測點位太不明顯）。
 * 主數字＝95%；下面小字 90%／99%。頂到漲跌停時各機率會變同一個數，另列「未加狀態調整」的 95% 讓人看得出差別。 */
function Hero({ d }: { d: NextdayData }) {
  const m = d.meta, close = m.close;
  const band = (p: number) => d.bands.find(b => b.p === p);
  const b90 = band(0.9), b95 = band(0.95), b99 = band(0.99);
  if (!b95) return null;
  const card = (side: 'dn' | 'up') => {
    const isDn = side === 'dn';
    const v = (b: NonNullable<typeof b95>) => (isDn ? b.dn : b.up);
    const capped = (x: number) => (isDn ? x <= -m.limit + 1e-9 : x >= m.limit - 1e-9);
    const lv = (x: number) => levelOf(close, x);
    const strike = (x: number) => (isDn ? `賣權 ${nf0.format(putStrikeBelow(lv(x)))} 以下` : `買權 ${nf0.format(callStrikeAbove(lv(x)))} 以上`);
    const main = v(b95);
    const raw = isDn ? b95.dn0 : b95.up0;
    const color = isDn ? 'text-down' : 'text-up';
    const small = (lab: string, b?: typeof b95) => b && (
      <span className="whitespace-nowrap">{lab} <b className={`font-mono ${color}`}>{nf0.format(lv(v(b)))}</b>{capped(v(b)) && <span className="text-faint">（{isDn ? '跌停' : '漲停'}）</span>}</span>
    );
    return (
      <div className="min-w-0 rounded-lg border border-line bg-sunken/40 px-2 py-2 sm:px-2.5">
        <div className="text-[12px] font-semibold text-muted">{isDn ? '預測最低' : '預測最高'}<span className="ml-1 font-normal text-faint">95% 機率守住</span></div>
        <div className={`mt-0.5 font-mono text-[32px] font-extrabold leading-none tabular-nums sm:text-[38px] ${color}`}>{nf0.format(lv(main))}</div>
        <div className="font-mono text-[12px] tabular-nums text-muted">
          {pct(main)}{capped(main) && <span className="ml-1 font-sans text-faint">＝{isDn ? '跌停' : '漲停'}價</span>}
        </div>
        <div className="mt-1 text-[12.5px] font-semibold tracking-tight text-ink sm:tracking-normal">{isDn ? '賣 Put：' : '賣 Call：'}{strike(main)}</div>
        <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11.5px] text-muted">
          {small('90%', b90)}
          {small('99%', b99)}
        </div>
        {raw !== undefined && Math.abs(raw - main) > 1e-6 && (
          <div className="mt-0.5 text-[11px] text-faint">未加狀態調整 95%：<span className="font-mono">{nf0.format(lv(raw))}</span>（{pct(raw)}）</div>
        )}
      </div>
    );
  };
  // 2026-11-21 使用者：「我要看加權指數漲跌停價格」（昨收 ×1.1／×0.9）→ 最上面單獨一塊大字，一天不可能超過的硬上下限
  const limUp = levelOf(close, m.limit), limDn = levelOf(close, -m.limit);
  return (
    <div className="mt-2">
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:gap-3">
        <div className="min-w-0 rounded-lg border-2 border-line bg-sunken/40 px-2.5 py-2">
          <div className="text-[12px] font-semibold text-muted">
            {dayLabel(m.next)} 加權指數漲跌停<span className="ml-1 font-normal text-faint">昨收 {nf0.format(close)} ×1.1／×0.9</span>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <div className="min-w-0">
              <div className="text-[12px] text-muted">跌停價（最低）</div>
              <div className="font-mono text-[32px] font-extrabold leading-none tabular-nums text-down sm:text-[38px]">{nf0.format(limDn)}</div>
              <div className="mt-0.5 text-[11.5px] text-muted">賣權 {nf0.format(putStrikeBelow(limDn))} 以下碰不到</div>
            </div>
            <div className="min-w-0">
              <div className="text-[12px] text-muted">漲停價（最高）</div>
              <div className="font-mono text-[32px] font-extrabold leading-none tabular-nums text-up sm:text-[38px]">{nf0.format(limUp)}</div>
              <div className="mt-0.5 text-[11.5px] text-muted">買權 {nf0.format(callStrikeAbove(limUp))} 以上碰不到</div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
          {card('dn')}
          {card('up')}
        </div>
      </div>
      <p className="mt-1 max-w-[85ch] text-[11px] text-faint">
        {dayLabel(m.next)}盤中，依過去同類日子有 95% 機會守在這兩個數之間；履約價取 50 點整數往外。
        {b95.dn <= -m.limit + 1e-9 && b95.up >= m.limit - 1e-9 && ' 今天波動極大，95% 已經頂到漲跌停 —— 參考「未加狀態調整」與 90%，並把部位縮小。'}
      </p>
    </div>
  );
}

/** 今天的狀態調整（2026-11-21 IC 研究）：上下緣各放寬多少、主要原因；融資維持率；壓力日的樣本外突破率（照實講） */
function MaintBox({ d }: { d: NextdayData }) {
  const mt = d.maint!;
  const st = d.state;
  const b95 = d.bands.find(b => b.p === 0.95);
  const c95 = d.check.find(c => c.p === 0.95);
  const p1 = (v: number) => `${(v * 100).toFixed(1)}%`;
  const wide = !!st && (st.fu > 1.05 || st.fd > 1.05);
  const reasons = (list: NonNullable<NextdayData['state']>['whyUp']) =>
    list.filter(w => w.c > 0.03).slice(0, 3).map(w => `${w.label} ${fmtX(w.k, w.x)}`).join('、');
  return (
    // 警示用琥珀色（台股紅漲綠跌，用綠色會被看成「沒事」）
    <div className="mt-2 rounded-lg border border-line bg-sunken/40 px-2.5 py-2 text-[11.5px] leading-snug text-muted"
         style={wide || mt.low ? { borderColor: '#d97706', borderLeftWidth: 4 } : undefined}>
      {st && (
        <div className="text-[12.5px] text-ink">
          今天的狀態調整：
          <b className="font-mono" style={st.fd > 1.05 ? { color: '#d97706' } : undefined}>下緣 ×{st.fd.toFixed(2)}</b>、
          <b className="font-mono" style={st.fu > 1.05 ? { color: '#d97706' } : undefined}>上緣 ×{st.fu.toFixed(2)}</b>
          {!wide && <span className="ml-1 text-muted">（平常狀態，不調整）</span>}
        </div>
      )}
      {st && st.fd > 1.05 && <p className="mt-1">下緣放寬的原因：{reasons(st.whyDn) || '多項小幅加總'}（大跌、全面殺盤、維持率急降的隔天，下檔常比波動預期更深）</p>}
      {st && st.fu > 1.05 && <p className="mt-1">上緣放寬的原因：{reasons(st.whyUp) || '多項小幅加總'}（連跌、維持率連降、收在低檔的隔天，常有急彈 —— sell call 也要留餘裕）</p>}
      {b95 && b95.dn0 !== undefined && wide && (
        <p className="mt-1">95% 區間：調整前 {pct(b95.dn0)}／{pct(b95.up0!)} → <b className="text-ink">{pct(b95.dn)}／{pct(b95.up)}</b>（最多到漲跌停 ±10%）。</p>
      )}
      <p className="mt-1">
        融資維持率 <b className="font-mono" style={mt.low ? { color: '#d97706' } : undefined}>{mt.value!.toFixed(1)}%</b>
        <span className="text-[11px] text-faint">（{mt.date}，證交所口徑）</span>
        {mt.low ? `：低於 ${mt.thr}，斷頭賣壓可能加速破低；維持率的「變化」已經算進上面的調整。` : `：高於 ${mt.thr}。`}
      </p>
      {c95?.stressDn0 != null && c95.stressDn != null && (
        <p className="mt-1">
          <b className="text-ink">要留意</b>：最近 3 年的壓力日（大跌 2% 以上或維持率一天掉 2 點，{d.meta.stressDays} 天），95% 區間被突破
          下 {p1(c95.stressDn0)} → 調整後 {p1(c95.stressDn)}、上 {p1(c95.stressUp0!)} → {p1(c95.stressUp!)}（應 5%）——
          調整補了一部分，<b className="text-ink">壓力日仍是平常的 2～3 倍</b>。這種日子把 95% 當 90% 看，賣在 99% 之外比較保險。
        </p>
      )}
      <p className="mt-1 text-[11px] text-faint">
        {mt.below140.days > 0
          ? <>維持率低於 {mt.call ?? 139}（斷頭區）的日子 2009 年起只有 {mt.below140.days} 天，隔日收盤平均 {pct(mt.below140.avgC, 2)}（斷頭賣完常反彈）。</>
          : <>維持率（證交所口徑）2009 年起從沒跌破 {mt.call ?? 139}（斷頭區），真的跌破就是沒有歷史可參考的狀態。</>}
      </p>
    </div>
  );
}

function fmtX(k: string, x: number): string {
  if (k === 'dkeep1' || k === 'dkeep5') return `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)} 點`;
  if (k === 'dnshare' || k === 'clv') return `${(x * 100).toFixed(0)}%`;
  if (k === 'lsig' || k === 'wk') return '';
  return pct(x);
}
