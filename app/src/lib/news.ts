/* 新聞與重大訊息的型別、時間格式與篩選。純函式，沒有 React。
 *
 * 時間處理集中在這裡，因為「幾分鐘前」這種相對時間如果散在元件裡，
 * 每個地方的邊界條件都會長得不一樣。
 */

export interface NewsItem {
  /** 標題 */
  t: string;
  /** 原文連結 —— 這一頁只做索引，內文永遠在原站 */
  u: string;
  /** 來源名稱 */
  s: string;
  /** ISO 8601 台北時間；來源沒給就是 null */
  at: string | null;
  /** 這則新聞掛到的、站上有追蹤的代號 */
  codes: string[];
  /** 來源掛的全部代號（含站上沒收的個股） */
  all: string[];
  cat: string;
}

export interface Filing {
  code: string;
  name: string;
  subject: string;
  at: string | null;
  market: string;
  clause: string;
  u: string;
  /** 是不是站上追蹤的標的 */
  known: boolean;
}

export interface NewsData {
  meta: {
    updated: string;
    sources: string[];
    note: string;
    news: number;
    filings: number;
  };
  news: NewsItem[];
  filings: Filing[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 「幾分鐘前」。超過一天就給日期 —— 「48 小時前」要自己換算，沒有幫助。
 *
 * 未來時間（來源時鐘偏差，或剛發佈差幾秒）一律當成「剛剛」，
 * 不要出現「-1 分鐘前」。
 */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const diff = now - t;
  if (diff < MINUTE) return '剛剛';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分鐘前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小時前`;
  return timeOfDay(iso);
}

/** 只要時分，給同一天之內的列表用。 */
export function timeOfDay(iso: string | null): string {
  if (!iso) return '—';
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : '—';
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 分組用的日期標籤。今天與昨天用字，其餘用「9/16（三）」。
 *
 * 刻意用字串前綴取日期而不是 Date 物件：資料裡的 ISO 已經是台北時間，
 * 交給 Date 會再套一次瀏覽器時區，人在美國看就會全部差一天。
 */
export function dayLabel(iso: string | null, today = new Date()): string {
  const key = dayKey(iso);
  if (!key) return '時間不明';
  const t = ymd(today);
  const y = ymd(new Date(today.getTime() - DAY));
  if (key === t) return '今天';
  if (key === y) return '昨天';
  const [, mm, dd] = key.split('-');
  // 用當天中午的 UTC 取星期。寫 +08:00 的午夜再讀 getUTCDay() 會落在前一天的
  // UTC，星期就整個往前一天 —— 2026-09-16（三）會變成（二）。
  const wd = WEEKDAYS[new Date(`${key}T12:00:00Z`).getUTCDay()];
  return `${Number(mm)}/${Number(dd)}（${wd ?? '?'}）`;
}

/** ISO 字串的日期部分。沒有時間的回空字串，排序時會沉到最後。 */
export function dayKey(iso: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function ymd(d: Date): string {
  // 台北時間的今天：把瞬間往後推 8 小時，再讀它的 UTC 日期部分。
  //
  // 不要用 getTimezoneOffset() 去修正 —— 那會抵消掉時區而得到 UTC 日期。
  // 台灣時間凌晨 5 點時 UTC 還是前一天，於是「今天」的新聞會被標成日期、
  // 昨天的反而標成「今天」，兩個標籤一起錯。
  return new Date(d.getTime() + 8 * HOUR).toISOString().slice(0, 10);
}

export interface Group<T> { key: string; label: string; rows: T[] }

/** 依日期分組，新的在前。組內維持原本的順序（來源已經排好了）。 */
export function groupByDay<T extends { at: string | null }>(
  rows: T[], today = new Date(),
): Array<Group<T>> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const key = dayKey(r.at);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([key, group]) => ({ key, label: dayLabel(group[0].at, today), rows: group }));
}

export interface NewsFilter {
  /** 空字串代表全部來源 */
  source: string;
  query: string;
  /** 只看有掛到站上追蹤代號的新聞 */
  onlyTracked: boolean;
}

export function filterNews(rows: NewsItem[], f: NewsFilter): NewsItem[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter(r => {
    if (f.source && r.s !== f.source) return false;
    if (f.onlyTracked && r.codes.length === 0) return false;
    if (!q) return true;
    return r.t.toLowerCase().includes(q)
      || r.all.some(c => c.toLowerCase().includes(q));
  });
}

export interface FilingFilter {
  /** 空字串代表上市與上櫃都看 */
  market: string;
  query: string;
  /** 只看站上追蹤的標的 */
  onlyKnown: boolean;
}

export function filterFilings(rows: Filing[], f: FilingFilter): Filing[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter(r => {
    if (f.market && r.market !== f.market) return false;
    if (f.onlyKnown && !r.known) return false;
    if (!q) return true;
    return r.subject.toLowerCase().includes(q)
      || r.name.toLowerCase().includes(q)
      || r.code.toLowerCase().includes(q);
  });
}

/** 來源清單（出現過的，依資料裡的順序）。用來畫來源篩選鈕。 */
export function sourcesOf(rows: NewsItem[]): string[] {
  const out: string[] = [];
  for (const r of rows) if (!out.includes(r.s)) out.push(r.s);
  return out;
}
