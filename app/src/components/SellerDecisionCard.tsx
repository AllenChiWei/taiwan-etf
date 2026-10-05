/* 籌碼頁：選擇權賣方決策卡（規則與回測數字見 lib/sellerCard.ts） */

import { useEffect, useState } from 'react';
import { fetchAtm } from '../api/atm';
import { BACKTEST, RULE, latestDecision, pastEntries, type Decision } from '../lib/sellerCard';

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });

export function SellerDecisionCard() {
  const [d, setD] = useState<Decision | null>(null);
  const [hist, setHist] = useState<Decision[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading');

  useEffect(() => {
    const ac = new AbortController();
    fetchAtm(ac.signal).then(data => {
      if (ac.signal.aborted) return;
      const cur = data ? latestDecision(data) : null;
      setD(cur);
      setHist(data ? pastEntries(data, 8) : []);
      setState(cur ? 'ready' : 'none');
    }).catch(() => { if (!ac.signal.aborted) setState('none'); });
    return () => ac.abort();
  }, []);

  if (state !== 'ready' || !d) return null;
  const ok = d.favorable;
  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4" aria-label="選擇權賣方決策卡">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-bold text-ink">選擇權賣方決策卡</h2>
        <span className="text-[11.5px] text-faint">{d.date} 收盤・週三序列 {d.row.c}（{d.row.e} 到期）</span>
      </div>

      <div className={`mt-2 rounded-lg border px-3 py-2 text-[13px] font-semibold
                       ${ok ? 'border-accent bg-accent-soft text-ink' : 'border-line bg-sunken text-muted'}`}>
        {d.ratio === null ? '實際波動資料不足，暫不判斷'
          : ok ? `賣方有利：預期波動是近 ${RULE.rvDays} 日實際波動的 ${d.ratio.toFixed(2)} 倍（> ${RULE.ratioMin}）`
               : `不建議：預期波動只有近 ${RULE.rvDays} 日實際波動的 ${d.ratio.toFixed(2)} 倍（門檻 ${RULE.ratioMin}）`}
        <span className="mt-0.5 block text-[11.5px] font-normal text-muted">
          {d.entryDay ? '今天是週三序列結算日 = 回測的進場日。'
                      : `回測只在週三序列結算日進場；下一個進場日是 ${d.nextEntry ?? '—'}，以當天收盤的數字為準。`}
        </span>
      </div>

      <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px] sm:grid-cols-4">
        <div><dt className="text-[11px] text-faint">價平和</dt><dd className="font-mono font-semibold text-ink">{nf.format(d.row.sum)} 點</dd></div>
        <div><dt className="text-[11px] text-faint">預期波動（年化）</dt><dd className="font-mono font-semibold text-ink">{pct(d.iv)}</dd></div>
        <div><dt className="text-[11px] text-faint">近 {RULE.rvDays} 日實際波動</dt><dd className="font-mono font-semibold text-ink">{pct(d.rv)}</dd></div>
        <div><dt className="text-[11px] text-faint">預期 ÷ 實際</dt><dd className={`font-mono font-semibold ${ok ? 'text-up' : 'text-ink'}`}>{d.ratio?.toFixed(2) ?? '—'}</dd></div>
        <div><dt className="text-[11px] text-faint">標的（平價推算）</dt><dd className="font-mono text-ink">{nf.format(d.forward)}</dd></div>
        <div><dt className="text-[11px] text-faint">剩餘交易日</dt><dd className="font-mono text-ink">{d.days} 天</dd></div>
        <div><dt className="text-[11px] text-faint">建議賣出買權</dt><dd className="font-mono font-semibold text-ink">{nf.format(d.callStrike)}</dd></div>
        <div><dt className="text-[11px] text-faint">建議賣出賣權</dt><dd className="font-mono font-semibold text-ink">{nf.format(d.putStrike)}</dd></div>
      </dl>
      <p className="mt-1.5 text-[11.5px] text-muted">
        履約價 = 標的 ± {RULE.strikeMult} 倍價平和，取 {RULE.strikeStep} 點往外。各腳權利金漲到進場的 {RULE.stopMult} 倍停損、
        跌到 {RULE.takeProfit * 100}% 停利。
      </p>

      {hist.length > 0 && (
        <div className="mt-2.5 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-faint">
                <th className="py-1 pr-2 font-normal">最近的進場日</th><th className="pr-2 font-normal">賣出序列</th>
                <th className="pr-2 text-right font-normal">價平和</th><th className="pr-2 text-right font-normal">預期／實際</th>
                <th className="text-right font-normal">判斷</th>
              </tr>
            </thead>
            <tbody>
              {hist.map(h => (
                <tr key={h.date} className="border-t border-line/60">
                  <td className="py-1 pr-2 font-mono">{h.date}</td>
                  <td className="pr-2 font-mono text-muted">{h.row.c}</td>
                  <td className="pr-2 text-right font-mono">{nf.format(h.row.sum)}</td>
                  <td className="pr-2 text-right font-mono">{h.ratio?.toFixed(2) ?? '—'}</td>
                  <td className={`text-right ${h.favorable ? 'font-semibold text-up' : 'text-muted'}`}>{h.favorable ? '賣' : '不做'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 rounded-lg bg-sunken px-3 py-2 text-[11.5px] text-muted">
        回測（{BACKTEST.period}，每期 1 組 1 口、扣手續費稅與滑價）：{BACKTEST.trades} 次、勝率 {Math.round(BACKTEST.winRate * 100)}%、
        總損益 {nf.format(BACKTEST.total)} 元、最大回撤 {nf.format(BACKTEST.maxDrawdown)} 元（淨利÷回撤 {BACKTEST.netOverDd}）、
        虧損年 {BACKTEST.losingYears}；前半段 {nf.format(BACKTEST.firstHalf)} 元、後半段 {nf.format(BACKTEST.secondHalf)} 元。
        優勢很小，成本或跳空稍差就可能歸零；只有每日資料，盤中急漲急跌的停損會比回測差。僅供參考，不構成投資建議。
      </p>
    </section>
  );
}
