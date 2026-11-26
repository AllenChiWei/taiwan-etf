/* 配息組成明細：/calc 月領試算與 /etf 單檔頁共用（資料來自集保 ETF 觀測站 div_mix.json）。
 *
 * 項次順序與健保課稅判斷在 lib/monthlyIncome.ts；這裡只負責呈現條狀圖、各項占比與提醒。
 */

import type { ReactNode } from 'react';
import { divMixParts, divMixTaxPct, type DivMix } from '../lib/monthlyIncome';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface DivMixDetailProps {
  mix: DivMix | null;
  /** 每次配息估算金額（月領試算頁傳入；單檔頁省略，避免缺少目標張數脈絡） */
  perPayment?: number;
  /** div_mix.json 本身載入失敗或缺檔時為 true，與「集保尚未公告」區分 */
  unavailable?: boolean;
  /** 單檔頁在下方補上簡要二代健保口徑（月領試算頁底部已有整段說明，不必重複） */
  showNote?: boolean;
  /** 尾端額外連結或元素（例如月領試算頁的「完整頁面 →」） */
  footer?: ReactNode;
  className?: string;
}

export function DivMixDetail({
  mix,
  perPayment,
  unavailable = false,
  showNote = false,
  footer,
  className = '',
}: DivMixDetailProps) {
  const parts = divMixParts(mix);
  const taxPct = divMixTaxPct(mix);

  return (
    <div className={`rounded-lg bg-sunken px-3 py-2 text-[12px] ${className}`.trim()}>
      {parts.length > 0 && mix ? (
        <>
          <div className="mb-1.5 text-[11px] text-faint">
            配息組成（集保 ETF 觀測站，{mix.date} 除息預估占比）
          </div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-line/40" role="img"
               aria-label={parts.map(p => `${p.label} ${nf0.format(p.pct)}%`).join('、')}>
            {parts.map(p => <span key={p.label} className={p.color} style={{ width: `${p.pct}%` }} />)}
          </div>
          <ul className={`mt-1.5 grid gap-x-4 gap-y-0.5 ${perPayment !== undefined ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2'}`}>
            {parts.map(p => (
              <li key={p.label} className="flex min-w-0 items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${p.color}`} />
                <span className="truncate text-ink">{p.label}</span>
                <span className="font-mono tabular-nums text-muted">{nf2.format(p.pct)}%</span>
                {perPayment !== undefined && (
                  <span className="ml-auto font-mono tabular-nums text-faint">每次約 {nf0.format(perPayment * p.pct / 100)} 元</span>
                )}
                <span className={`${perPayment === undefined ? 'ml-auto ' : ''}whitespace-nowrap text-[10.5px] ${p.taxed ? 'text-up' : 'text-faint'}`}>
                  {p.taxed ? '計健保・所得稅' : '免'}
                </span>
              </li>
            ))}
          </ul>
          {showNote && taxPct !== null && (
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
              {taxPct > 0
                ? `計入二代健保（單筆達 2 萬元扣 2.11%）與所得稅部分合計 ${nf2.format(taxPct)}%（僅股利與利息所得）；收益平準金、已實現資本利得免扣免稅。實際以投信收益分配通知為準。`
                : '本次預估組成不含股利與利息所得（0%），免扣二代健保補充保費、不課所得稅；實際以投信收益分配通知為準。'}
            </p>
          )}
        </>
      ) : unavailable ? (
        <p className="text-muted">配息組成資料暫時讀不到，扣不扣健保以投信的收益分配通知為準。</p>
      ) : (
        <p className="text-muted">集保 ETF 觀測站還沒公告這檔的配息組成（新上市、主動式常見），扣不扣健保以投信的收益分配通知為準。</p>
      )}
      {footer}
    </div>
  );
}
