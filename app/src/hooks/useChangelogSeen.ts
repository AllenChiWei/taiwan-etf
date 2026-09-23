/* 更新日誌的「有新東西」小紅點。
 *
 * 第一次來的人沒有紀錄：直接把目前最新的日期記成看過 —— 對他來說每一條都是新的，
 * 亮一個點沒有資訊；之後再有新條目才會亮。打開更新日誌頁時 markSeen()。 */

import { useCallback, useEffect, useState } from 'react';
import { hasUnseen, latestDate } from '../lib/changelog';
import { loadChangelogSeen, saveChangelogSeen } from '../lib/storage';

export function useChangelogSeen() {
  const [seen, setSeen] = useState<string | null>(loadChangelogSeen);

  useEffect(() => {
    const latest = latestDate();
    if (seen === null && latest) {
      saveChangelogSeen(latest);
      setSeen(latest);
    }
  }, [seen]);

  const markSeen = useCallback(() => {
    const latest = latestDate();
    if (latest) {
      saveChangelogSeen(latest);
      setSeen(latest);
    }
  }, []);

  return { unseen: hasUnseen(seen), markSeen };
}
