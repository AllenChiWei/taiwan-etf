/* 結算價預測獨立頁（#/settle，2026-11-21 使用者：放在籌碼頁太不顯眼）。內容在 SettleSection（page 模式）。 */

import { SettleSection } from '../components/SettleSection';

export function SettlePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <SettleSection page />
    </div>
  );
}
