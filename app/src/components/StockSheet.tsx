/* 從清單點一檔就滑出來的個股儀表板。
 *
 * **為什麼是抽屜而不是換頁**：使用者在創新高榜掃到第 40 檔時想看一下細節，
 * 換頁再按上一頁，捲動位置就沒了，等於要重新找回剛剛的位置。抽屜蓋在原地，
 * 關掉之後清單還停在同一行 —— 這正是使用者提出這個需求的原因。
 *
 * 面板跟個股頁用的是同一組（components/StockBoard），所以兩邊永遠一致。
 * 資料自己抓：個股那份小（約 600 bytes），highs 與 ranking 在 api 層有快取，
 * 清單頁通常已經抓過了。
 */

import { useEffect, useState } from 'react';
import { fetchStock, fetchHighs, fetchRanking } from '../api/stocks';
import type { StockData, Highs, Ranking } from '../lib/stock';
import {
  InfoSection, PositionSection, PercentileSection, ChipsVisual,
  InstDailySection, RevenueSection, FinancialSection,
} from './StockBoard';

interface Props {
  code: string | null;
  name?: string;
  onClose: () => void;
}

export function StockSheet({ code, name, onClose }: Props) {
  const [data, setData] = useState<StockData | null>(null);
  const [highs, setHighs] = useState<Highs | null>(null);
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    if (!code) return;
    const ac = new AbortController();
    setState('loading');
    setData(null);
    fetchStock(code, ac.signal)
      .then(d => {
        if (ac.signal.aborted) return;
        setData(d);
        setState(d ? 'ready' : 'missing');
      })
      .catch(() => { if (!ac.signal.aborted) setState('missing'); });
    fetchHighs(ac.signal).then(d => { if (!ac.signal.aborted) setHighs(d); }).catch(() => {});
    fetchRanking(ac.signal).then(d => { if (!ac.signal.aborted) setRanking(d); }).catch(() => {});
    return () => ac.abort();
  }, [code]);

  // Esc 關閉，而且開著的時候鎖住背景捲動 —— 不然滑到抽屜底部會變成在滑清單。
  //
  // **捲動位置要自己記下來再還原。** 鎖住／解鎖 overflow 的前後，版面高度會變，
  // 瀏覽器留下的位置會漂掉（實測從 512 跑到 600）。而「關掉之後還停在剛剛那一行」
  // 正是這個抽屜存在的理由，漂掉就等於沒做到。
  useEffect(() => {
    if (!code) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const y = window.scrollY;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      window.scrollTo(0, y);
    };
  }, [code, onClose]);

  if (!code) return null;

  const row = highs?.rows.find(r => r.c === code) ?? null;
  const rank = ranking?.rows.find(r => r.c === code) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
         role="dialog" aria-modal="true" aria-label={`${code} 個股儀表板`}>
      <button type="button" aria-label="關閉"
              onClick={onClose}
              className="absolute inset-0 bg-black/45" />

      <div className="relative flex max-h-[88vh] w-full max-w-2xl flex-col rounded-t-2xl
                      bg-bg shadow-xl sm:max-h-[86vh] sm:rounded-2xl">
        {/* 標題列固定住，捲動的是內容 —— 不然滑到一半就找不到關閉鈕 */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <span className="font-mono text-[13px] text-muted">{code}</span>
            <span className="ml-2 text-[15px] font-bold text-ink">
              {data?.info.name ?? name ?? ''}
            </span>
            {data?.info.industry && (
              <span className="ml-2 text-[11.5px] text-faint">{data.info.industry}</span>
            )}
          </div>
          <button type="button" onClick={onClose}
                  className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center
                             rounded-lg text-[18px] text-muted hover:bg-sunken hover:text-ink">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
          {state === 'loading' && (
            <p className="py-12 text-center text-[13px] text-muted">載入 {code} 中…</p>
          )}
          {state === 'missing' && (
            <p className="py-12 text-center text-[13px] text-muted">
              {code} 還沒有資料，可能不在上市櫃公司清單裡。
            </p>
          )}
          {state === 'ready' && data && (
            <>
              <PositionSection row={row} />
              <PercentileSection row={row} allHighs={highs?.rows ?? []}
                                 rank={rank} allRanks={ranking?.rows ?? []} />
              <ChipsVisual data={data} />
              <InstDailySection data={data} />
              <RevenueSection data={data} />
              <FinancialSection data={data} />
              <InfoSection data={data} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
