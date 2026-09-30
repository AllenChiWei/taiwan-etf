/* 配息試算的多帳戶：同一個人有好幾個證券戶，想看總共領多少、也想看每個戶頭各領多少。
 *
 * 持股（localStorage 的 twetf.holdings）每一筆多一個 acct 欄位。舊資料沒有這個欄位，
 * 一律歸到第一個帳戶（預設叫「帳戶A」）—— 這樣升級之後使用者什麼都不用做，畫面跟以前一樣。
 *
 * 同一檔可以同時在兩個帳戶，是兩筆獨立的持股。總帳戶把同一檔的股數**合併成一列**
 * 再算（總帳戶的明細、月曆、佔比圖都以「一檔一列」為前提；兩列同代號會撞顏色、撞 key）；
 * 各帳戶則各算各的。配息是每股金額 × 股數，線性的，所以合併後的總額等於各帳戶相加。
 */

export interface AcctEntry {
  code: string;
  shares: number;
  m?: 'us';
  acct?: string;
}

export const DEFAULT_ACCOUNT = '帳戶A';

/** 帳戶清單：存下來的順序在前，持股裡出現但清單沒有的補在後面；至少有一個。 */
export function accountList(stored: readonly string[], entries: readonly AcctEntry[]): string[] {
  const out: string[] = [];
  const add = (n: string | undefined) => {
    const name = (n ?? '').trim();
    if (name && !out.includes(name)) out.push(name);
  };
  stored.forEach(add);
  for (const e of entries) add(e.acct);
  if (!out.length) out.push(DEFAULT_ACCOUNT);
  return out;
}

/** 沒有帳戶的持股（舊資料）歸到第一個帳戶。 */
export function withAccounts<T extends AcctEntry>(entries: readonly T[], first: string): T[] {
  return entries.map(e => (e.acct && e.acct.trim() ? e : { ...e, acct: first }));
}

/** 下一個預設帳戶名：帳戶B、帳戶C…（跳過已經用掉的）。 */
export function nextAccountName(existing: readonly string[]): string {
  for (let i = 0; i < 26; i++) {
    const name = `帳戶${String.fromCharCode(65 + i)}`;
    if (!existing.includes(name)) return name;
  }
  let n = existing.length + 1;
  while (existing.includes(`帳戶${n}`)) n += 1;
  return `帳戶${n}`;
}

/** 同一檔（同代號、同市場）在各帳戶的股數合併，順序照第一次出現。 */
export function mergeByCode<T extends AcctEntry>(entries: readonly T[]): Array<{ code: string; m?: 'us'; shares: number }> {
  const out: Array<{ code: string; m?: 'us'; shares: number }> = [];
  const idx = new Map<string, number>();
  for (const e of entries) {
    const key = `${e.m ?? ''}:${e.code}`;
    const i = idx.get(key);
    if (i === undefined) {
      idx.set(key, out.length);
      out.push(e.m ? { code: e.code, m: e.m, shares: e.shares } : { code: e.code, shares: e.shares });
    } else {
      out[i].shares += e.shares;
    }
  }
  return out;
}

/** 同一個帳戶裡的同一檔視為同一筆；給畫面當 key 用。 */
export const entryKey = (e: AcctEntry) => `${e.acct ?? ''}|${e.m ?? ''}|${e.code}`;

/** 改帳戶名稱。新名字空白或跟別的帳戶重複時不改（回傳 null）。 */
export function renameAccount<T extends AcctEntry>(
  accounts: readonly string[], entries: readonly T[], from: string, to: string,
): { accounts: string[]; entries: T[] } | null {
  const name = to.trim();
  if (!name || (name !== from && accounts.includes(name))) return null;
  return {
    accounts: accounts.map(a => (a === from ? name : a)),
    entries: entries.map(e => (e.acct === from ? { ...e, acct: name } : e)),
  };
}

/** 刪帳戶連同它的持股。最後一個帳戶不能刪（回傳 null）。 */
export function removeAccount<T extends AcctEntry>(
  accounts: readonly string[], entries: readonly T[], name: string,
): { accounts: string[]; entries: T[] } | null {
  if (accounts.length <= 1) return null;
  return {
    accounts: accounts.filter(a => a !== name),
    entries: entries.filter(e => e.acct !== name),
  };
}

/**
 * 加入持股：同一個帳戶已經有這一檔就把股數加上去（使用者多買了一次），
 * 不在同一個帳戶裡出現兩列。
 */
export function addHolding<T extends AcctEntry>(entries: readonly T[], item: T): T[] {
  const k = entryKey(item);
  if (entries.some(e => entryKey(e) === k)) {
    return entries.map(e => (entryKey(e) === k ? { ...e, shares: e.shares + item.shares } : e));
  }
  return [...entries, item];
}
