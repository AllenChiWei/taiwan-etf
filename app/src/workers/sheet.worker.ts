/* 把 .xls／.xlsx 讀成二維陣列。**跑在 Web Worker 裡，這是刻意的。**
 *
 * 讀 BIFF8（真正的 .xls，元大匯出的就是）在瀏覽器裡只有 SheetJS 一個實際選項。
 * npm 上的 xlsx 停在 0.18.5，帶著原型污染（GHSA-4r6h-8v6p-xvw6）與 ReDoS
 * （GHSA-5pgg-2g8v-p4x9）兩個 advisory；SheetJS 之後只在自己的 CDN 發布，
 * 所以 package.json 直接指向 cdn.sheetjs.com 的 0.20.3（兩個都修掉了，lock 檔
 * 有完整性雜湊）。升級時改那個網址的版本號，不要改回 npm 的 xlsx。
 *
 * worker 這層隔離照樣留著 —— 解析的是使用者丟進來的任意檔案，多一層總是好的：
 *
 * - **原型污染關在 worker 自己的 realm**。這裡除了解析什麼都不做，沒有 DOM、
 *   沒有金鑰、沒有其他程式碼會讀到被污染的原型。
 * - **ReDoS 卡住的是 worker**，主執行緒還能動，使用者可以關掉或換一份檔案。
 * - 順帶一提，一千多列的解析本來就不該擋住 UI。
 *
 * 檔案自始至終留在瀏覽器裡 —— 這個網站沒有後端，對帳單不會被上傳到任何地方。
 */

export interface SheetRequest { buffer: ArrayBuffer }
export type SheetResponse =
  | { ok: true; rows: unknown[][] }
  | { ok: false; error: string };

self.onmessage = async (e: MessageEvent<SheetRequest>) => {
  try {
    // 動態載入：沒開這一頁的人不會下載這包（約 400 KB）
    const XLSX = await import('xlsx');
    const wb = XLSX.read(new Uint8Array(e.data.buffer), { type: 'array' });
    const first = wb.SheetNames[0];
    if (!first) throw new Error('這個檔案裡沒有工作表');
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[first], {
      header: 1,      // 回二維陣列，不要用第一列當鍵 —— 對帳單有空白標題
      raw: true,      // 日期保持 Excel 序號，由 futures.ts 自己換算
      blankrows: false,
    });
    const res: SheetResponse = { ok: true, rows };
    self.postMessage(res);
  } catch (err) {
    const res: SheetResponse = {
      ok: false,
      error: err instanceof Error ? err.message : '無法讀取這個檔案',
    };
    self.postMessage(res);
  }
};
