/* 隔日漲跌幅獨立頁（#/nextday，市場 → 隔日漲跌；2026-11-21 使用者：跟結算價一樣獨立一頁、加通道推移圖）。 */

import { NextDaySection } from '../components/NextDaySection';

export function NextDayPage() {
  return (
    <div>
      <NextDaySection />
    </div>
  );
}
