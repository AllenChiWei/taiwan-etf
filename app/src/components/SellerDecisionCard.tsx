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

      <div className={hist.length > 0 ? 'mt-2 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-5' : 'mt-2'}>
        <div className="min-w-0">
          <div className={`rounded-lg border px-3 py-2 text-[13px] font-semibold
                           ${ok ? 'border-line-strong bg-bg text-ink' : 'border-line bg-sunken text-muted'}`}>
            {d.ratio === null ? '實際波動資料不足，暫不比較'
              : ok ? `選擇權相對貴：預期波動是近 ${RULE.rvDays} 日實際波動的 ${d.ratio.toFixed(2)} 倍（> ${RULE.ratioMin}）`
                   : `選擇權相對便宜：預期波動是近 ${RULE.rvDays} 日實際波動的 ${d.ratio.toFixed(2)} 倍（≤ ${RULE.ratioMin}）`}
            <span className="mt-0.5 block text-[11.5px] font-normal text-muted">
              {d.entryDay ? '今天是週三序列結算日（舊回測的觀察進場日）。'
                          : `舊回測只在週三序列結算日進場；下一個結算日是 ${d.nextEntry ?? '—'}，以當天收盤的數字為準。`}
            </span>
          </div>

          {/* 2026-11-26：使用者同意保留卡片但加註新回測結果，改用中性色與琥珀提醒（不用紅／綠暗示進場） */}
          <div role="note" className="mt-2 rounded-lg border border-yield/40 border-l-4 border-l-yield bg-yield/10 px-3 py-2 text-[12px] leading-relaxed text-ink">
            <b className="font-semibold text-yield">真實成本回測提醒：</b>
            2026-11 用真實成本（每口每邊 50 元手續費、期交稅、買賣價差、夜盤與開盤跳空）重新回測，這條規則 16 組參數都虧損；
            「選擇權相對貴」只代表預期波動高於近期實際波動，不代表賣方有優勢，請只當參考。
          </div>

          <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px] sm:grid-cols-4">
            <div><dt className="text-[11px] text-faint">價平和</dt><dd className="font-mono font-semibold text-ink">{nf.format(d.row.sum)} 點</dd></div>
            <div><dt className="text-[11px] text-faint">預期波動（年化）</dt><dd className="font-mono font-semibold text-ink">{pct(d.iv)}</dd></div>
            <div><dt className="text-[11px] text-faint">近 {RULE.rvDays} 日實際波動</dt><dd className="font-mono font-semibold text-ink">{pct(d.rv)}</dd></div>
            <div><dt className="text-[11px] text-faint">預期 ÷ 實際</dt><dd className="font-mono font-semibold text-ink">{d.ratio?.toFixed(2) ?? '—'}</dd></div>
            <div><dt className="text-[11px] text-faint">標的（平價推算）</dt><dd className="font-mono text-ink">{nf.format(d.forward)}</dd></div>
            <div><dt className="text-[11px] text-faint">剩餘交易日</dt><dd className="font-mono text-ink">{d.days} 天</dd></div>
            <div><dt className="text-[11px] text-faint">規則買權履約價</dt><dd className="font-mono font-semibold text-ink">{nf.format(d.callStrike)}</dd></div>
            <div><dt className="text-[11px] text-faint">規則賣權履約價</dt><dd className="font-mono font-semibold text-ink">{nf.format(d.putStrike)}</dd></div>
          </dl>
          <p className="mt-1.5 text-[11.5px] text-muted">
            履約價 = 標的 ± {RULE.strikeMult} 倍價平和，取 {RULE.strikeStep} 點往外。原規則為各腳權利金漲到進場的 {RULE.stopMult} 倍停損、
            跌到 {RULE.takeProfit * 100}% 停利。
          </p>

          <p className="mt-2.5 rounded-lg bg-sunken px-3 py-2 text-[11.5px] text-muted">
            舊版回測（{BACKTEST.period}，手續費 20 元、未含夜盤與開盤跳空，每期 1 組 1 口）：{BACKTEST.trades} 次、勝率 {Math.round(BACKTEST.winRate * 100)}%、
            總損益 {nf.format(BACKTEST.total)} 元、最大回撤 {nf.format(BACKTEST.maxDrawdown)} 元（淨利÷回撤 {BACKTEST.netOverDd}）、
            虧損年 {BACKTEST.losingYears}；前半段 {nf.format(BACKTEST.firstHalf)} 元、後半段 {nf.format(BACKTEST.secondHalf)} 元。
            補齊真實成本與夜盤跳空後 16 組參數皆虧損，原結果不具實盤優勢。僅供參考，不構成投資建議。
          </p>
        </div>

        {hist.length > 0 && (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[11px] text-faint">
                  <th className="py-1 pr-2 font-normal">最近結算日</th><th className="pr-2 font-normal">次週序列</th>
                  <th className="pr-2 text-right font-normal">價平和</th><th className="pr-2 text-right font-normal">預期／實際</th>
                  <th className="text-right font-normal">定價</th>
                </tr>
              </thead>
              <tbody>
                {hist.map(h => (
                  <tr key={h.date} className="border-t border-line/60">
                    <td className="py-1 pr-2 font-mono">{h.date}</td>
                    <td className="pr-2 font-mono text-muted">{h.row.c}</td>
                    <td className="pr-2 text-right font-mono">{nf.format(h.row.sum)}</td>
                    <td className="pr-2 text-right font-mono">{h.ratio?.toFixed(2) ?? '—'}</td>
                    <td className={`whitespace-nowrap text-right ${h.favorable ? 'font-semibold text-ink' : 'text-muted'}`}>
                      {h.ratio === null ? '—' : h.favorable ? '相對貴' : '相對便宜'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
