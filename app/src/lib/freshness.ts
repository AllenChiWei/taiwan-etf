/* 資料是否過期。純函式。
 *
 * 2026-09 曾經因為資料來源異常，網站停在 9/25 好幾天沒人發現。這裡算「最新資料日之後，
 * 已經過了幾個應該要有新資料的交易日」：週一到週五算交易日（不認得國定假日，所以連假時會多算，
 * 提示文字要說「遇連假可忽略」）；今天要等台北時間 21:00（每日更新 19:00 開跑）之後才算一天。
 */

/** 台北時間的 YYYY-MM-DD 與小時 */
export function taipeiNow(now: Date = new Date()): { date: string; hour: number } {
  const t = new Date(now.getTime() + 8 * 3600 * 1000);
  return { date: t.toISOString().slice(0, 10), hour: t.getUTCHours() };
}

export function missedTradingDays(updated: string, now: Date = new Date()): number {
  const { date: today, hour } = taipeiNow(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updated) || updated >= today) return 0;
  let n = 0;
  for (let t = Date.parse(updated + 'T00:00:00Z') + 86400000; ; t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (d > today) break;
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    if (d === today && hour < 21) continue;
    n++;
  }
  return n;
}

export const STALE_AFTER = 2;
