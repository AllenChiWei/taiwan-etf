/* 結算價預測獨立頁（#/settle，2026-11-21 使用者：放在籌碼頁太不顯眼）。內容在 SettleSection（page 模式）。
   隔日漲跌幅同日搬到自己的頁（#/nextday），這裡頂端留一個連結。 */

import { Link } from '@tanstack/react-router';
import { SettleSection } from '../components/SettleSection';

export function SettlePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mt-3 flex justify-end">
        <Link to="/nextday"
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-accent hover:border-accent">
          隔日漲跌幅（明天最多漲／跌到哪）→
        </Link>
      </div>
      <SettleSection page />
    </div>
  );
}
