/* 把使用者選的檔案讀成二維陣列。
 *
 * 兩條路：
 *
 *   .csv / .txt  -> 這裡直接切，不需要任何相依套件
 *   .xls / .xlsx -> 丟給 Web Worker 用 SheetJS 解析（理由見 workers/sheet.worker.ts）
 *
 * CSV 那條路完全沒有第三方程式碼，所以如果券商能匯出 CSV，那是比較乾淨的選擇 ——
 * 畫面上有說明這件事。
 */

import type { SheetRequest, SheetResponse } from '../workers/sheet.worker';

/** 解析 CSV。支援引號包住的欄位與欄位內的逗號、換行。 */
export function parseCsv(text: string): unknown[][] {
  const rows: unknown[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }   // 逸出的雙引號
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

const isCsv = (name: string) => /\.(csv|txt)$/i.test(name);

/** 讀檔 -> 二維陣列。整個過程都在瀏覽器裡，檔案不會被送到任何地方。 */
export async function readSheet(file: File): Promise<unknown[][]> {
  if (isCsv(file.name)) {
    // 對帳單常見的是 Big5；先試 UTF-8，出現替代字元就改用 Big5 重讀
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) {
      try { text = new TextDecoder('big5').decode(buf); } catch { /* 瀏覽器不支援就算了 */ }
    }
    return parseCsv(text);
  }

  const buffer = await file.arrayBuffer();
  const worker = new Worker(new URL('../workers/sheet.worker.ts', import.meta.url),
                            { type: 'module' });
  try {
    return await new Promise<unknown[][]>((resolve, reject) => {
      // 沒有回應就別一直轉圈 —— ReDoS 正是會卡在這裡的情況
      const timer = setTimeout(() => reject(new Error('讀取超過 30 秒，這個檔案可能有問題')),
                               30_000);
      worker.onmessage = (e: MessageEvent<SheetResponse>) => {
        clearTimeout(timer);
        if (e.data.ok) resolve(e.data.rows);
        else reject(new Error(e.data.error));
      };
      worker.onerror = () => {
        clearTimeout(timer);
        reject(new Error('讀取檔案時發生錯誤'));
      };
      const req: SheetRequest = { buffer };
      worker.postMessage(req, [buffer]);      // 轉移所有權，不複製一份
    });
  } finally {
    worker.terminate();
  }
}
