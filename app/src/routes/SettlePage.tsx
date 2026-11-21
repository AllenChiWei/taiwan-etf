/* 結算價預測獨立頁（#/settle，2026-11-21 使用者：放在籌碼頁太不顯眼）。內容在 SettleSection（page 模式）；
   下面接隔日漲跌幅（NextDaySection，同日使用者要的選擇權賣方工具）。它在結算價歷史表下面，
   頂端放一個跳過去的按鈕（hash 路由不能用 href="#id"，用 scrollIntoView）。 */

import { SettleSection } from '../components/SettleSection';
import { NextDaySection } from '../components/NextDaySection';

export function SettlePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mt-3 flex justify-end">
        <button type="button"
                onClick={() => document.getElementById('sec-nextday')?.scrollIntoView()}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-accent hover:border-accent">
          隔日漲跌幅（明天最多漲／跌到哪）↓
        </button>
      </div>
      <SettleSection page />
      <NextDaySection />
    </div>
  );
}
