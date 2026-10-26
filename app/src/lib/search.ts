/* 全站快速搜尋（Ctrl＋K，2026-10-26）。純函式，沒有 React。
 *
 * 一個框找頁面、台股 ETF、個股。排序：代號完全相同 > 代號開頭 > 名稱開頭 > 名稱包含 > 關鍵字包含；
 * 同分時頁面 > ETF > 個股（頁面最少、最常是使用者要的）。
 */

export type SearchKind = 'page' | 'etf' | 'stock';

export interface SearchItem {
  kind: SearchKind;
  /** 代號（頁面沒有） */
  code?: string;
  name: string;
  /** 額外比對的字（頁面的別名、ETF 的配息頻率…） */
  keywords?: string;
  /** 導向：路徑＋查詢參數 */
  to: string;
  search?: Record<string, string>;
}

const KIND_ORDER: Record<SearchKind, number> = { page: 0, etf: 1, stock: 2 };

/** 全形英數轉半形、去空白、轉小寫（使用者常在中文輸入法下打代號） */
export function norm(s: string): string {
  return s.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '').toLowerCase();
}

export function score(item: SearchItem, q: string): number {
  const code = norm(item.code ?? '');
  const name = norm(item.name);
  if (code && code === q) return 100;
  if (code && code.startsWith(q)) return 80;
  if (name.startsWith(q)) return 60;
  if (name.includes(q)) return 40;
  if (item.keywords && norm(item.keywords).includes(q)) return 20;
  return 0;
}

export function searchAll(items: SearchItem[], query: string, limit = 12): SearchItem[] {
  const q = norm(query);
  if (!q) return items.filter(i => i.kind === 'page').slice(0, limit);
  return items
    .map(i => ({ i, s: score(i, q) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || KIND_ORDER[a.i.kind] - KIND_ORDER[b.i.kind]
      || (a.i.code ?? '').localeCompare(b.i.code ?? ''))
    .slice(0, limit)
    .map(x => x.i);
}

/** 站上的頁面（含分頁）。私人頁不放（要密碼，也不該被搜尋露出） */
export const PAGES: SearchItem[] = [
  { kind: 'page', name: '台股 ETF 清單', to: '/', keywords: '台股 清單 篩選 報酬 殖利率 保管銀行' },
  { kind: 'page', name: '主動式換股', to: '/', search: { view: 'active' }, keywords: '主動式 經理人 排行 換股 持股 損益 估值' },
  { kind: 'page', name: '即將上市 ETF', to: '/', search: { view: 'upcoming' }, keywords: '新上市 募集 即將上市' },
  { kind: 'page', name: '美股 ETF', to: '/us', keywords: '美股 美國 ETF' },
  { kind: 'page', name: '收藏與比較', to: '/favorites', keywords: '收藏 比較 重疊 績效' },
  { kind: 'page', name: '試算（回測、退休）', to: '/calc', keywords: '試算 回測 退休 定期定額' },
  { kind: 'page', name: '配息規劃', to: '/dividend', keywords: '配息 月配 股息 存股 規劃' },
  { kind: 'page', name: '期貨對帳單', to: '/futures', keywords: '對帳單 期貨 元大' },
  { kind: 'page', name: '籌碼（法人、選擇權）', to: '/chips', keywords: '籌碼 法人 外資 投信 選擇權 put call 大額 散戶 價平和' },
  { kind: 'page', name: '新聞與重大訊息', to: '/news', keywords: '新聞 公告 重大訊息' },
  { kind: 'page', name: '美國總經', to: '/macro', keywords: '總經 通膨 就業 利率 殖利率曲線 cpi' },
  { kind: 'page', name: '行事曆（除權息、股東會）', to: '/calendar', keywords: '行事曆 除權息 除息 股東會 法說會 結算' },
  { kind: 'page', name: '個股財報與籌碼', to: '/stock', keywords: '個股 財報 營收 籌碼 新高' },
  { kind: 'page', name: '德州撲克範圍表', to: '/poker', keywords: '撲克 poker' },
  { kind: 'page', name: '更新日誌', to: '/changelog', keywords: '更新 changelog 版本' },
  { kind: 'page', name: '說明', to: '/about', keywords: '說明 關於 資料來源' },
];
