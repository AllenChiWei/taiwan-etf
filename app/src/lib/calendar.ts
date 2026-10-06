/* 台股行事曆：交易所公告的除權息與股東會（calendar.json），加上依規則算出來的日子。
 *
 * 依規則算的有兩種，畫面上都標明「法定期限」「依規則推算」，不假裝是公告：
 * - 財報與月營收的**法定公告期限**（證券交易法第 36 條）：年度財報會計年度終了後三個月內
 *   （3/31）、第一～三季各季終了後 45 天內（5/15、8/14、11/14）；月營收每月 10 日前。
 *   這是一般產業的期限，金融保險業另有規定。公司可以提早，期限只是「最晚」。
 * - **台指期與台指選擇權的月結算日**：每月第三個星期三。遇到休市會順延，而這裡不知道
 *   休市日，所以標「遇假日順延」。週選（每週三、週五）太密，不列。
 *
 * 日期一律是 'YYYY-MM-DD' 字串，比較用字典序，不經過時區換算。
 */

export type EventKind = 'exdiv' | 'meeting' | 'report' | 'revenue' | 'settle';

export interface ExDivRow {
  d: string; code: string; name: string;
  /** '息' | '權' | '權息' */
  k: string;
  cash: number | null; stock: number | null; m: 'twse' | 'tpex';
  /** 金額的來源：沒有＝交易所；'est'／'final'＝交易所還沒填，改用投信公告的預估／實際金額 */
  ck?: 'est' | 'final';
  /** 投信公告的網址（ck 有值時） */
  nu?: string;
  /** 收益分配發放日（ETF，e添富或投信公告） */
  pay?: string | null;
  /** 現金增資配股率（每股可認購股數）與認購價。除權不一定是配股，現金增資的認購權也會除權（例：2026-10-07 永豐金） */
  cap?: number | null;
  capPx?: number | null;
}

/** 投信的收益分配公告，整理成一檔一個除息日一筆（實際優先於預估）。 */
export interface NoticeRow {
  code: string;
  ex: string;
  pay: string | null;
  cash: number;
  /** 'final' 實際、'est' 預估、'none' 不分配 */
  ck: 'final' | 'est' | 'none';
  /** 公告日 */
  nd: string;
  u: string;
  /** 簡稱（e添富配息清單）；沒有時畫面用代號 */
  name?: string;
}

export interface MeetingRow {
  d: string; code: string; name: string;
  /** '常會' | '臨時會' */
  k: string;
  elect: boolean; place: string; m: 'twse' | 'tpex';
}

export interface CalendarData {
  meta: { updated: string; until: string; source: string; errors: string[] };
  exdiv: ExDivRow[];
  meetings: MeetingRow[];
  /** '代號|除息日' -> 發放日（e添富，含已除息還沒發錢的） */
  pay?: Record<string, string>;
  notices?: NoticeRow[];
}

export interface CalEvent {
  d: string;
  kind: EventKind;
  code: string | null;
  title: string;
  detail: string;
}

export const KIND_LABEL: Record<EventKind, string> = {
  exdiv: '除權息', meeting: '股東會', report: '財報期限', revenue: '月營收期限', settle: '期貨結算',
};

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function* months(from: string, to: string): Generator<[number, number]> {
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    yield [y, m];
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
}

/** 某年某月的第三個星期三。 */
export function thirdWednesday(y: number, m: number): string {
  const dow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();   // 0 = 星期日
  const first = 1 + ((3 - dow + 7) % 7);
  return iso(y, m, first + 14);
}

const REPORTS: Array<[number, number, (y: number) => string]> = [
  [3, 31, y => `${y - 1} 年度財報`],
  [5, 15, y => `${y} 年第一季財報`],
  [8, 14, y => `${y} 年第二季財報`],
  [11, 14, y => `${y} 年第三季財報`],
];

/** from～to（含）之間依規則推得的日子：財報期限、月營收期限、期貨結算日。 */
export function ruleEvents(from: string, to: string): CalEvent[] {
  const out: CalEvent[] = [];
  for (const [y, m] of months(from, to)) {
    const prev = m === 1 ? 12 : m - 1;
    out.push({
      d: iso(y, m, 10), kind: 'revenue', code: null,
      title: `${prev} 月營收公告期限`,
      detail: '上市櫃公司須於每月 10 日前公告上月營收（法定期限，多數公司會提早）',
    });
    for (const [rm, rd, label] of REPORTS) {
      if (rm === m) {
        out.push({
          d: iso(y, m, rd), kind: 'report', code: null,
          title: `${label(y)}公告期限`,
          detail: '一般產業的法定期限（證券交易法第 36 條），金融保險業另有規定；公司可以提早公告',
        });
      }
    }
    out.push({
      d: thirdWednesday(y, m), kind: 'settle', code: null,
      title: `台指期・台指選 ${m} 月合約結算`,
      detail: '每月第三個星期三，依規則推算；遇假日順延，以期交所公告為準',
    });
  }
  return out.filter(e => e.d >= from && e.d <= to);
}

const fmtNum = (v: number) => (Math.round(v * 10000) / 10000).toString();

export function exdivEvent(r: ExDivRow): CalEvent {
  const parts: string[] = [];
  if (r.cash) {
    parts.push(r.ck === 'est' ? `預估 ${fmtNum(r.cash)} 元（投信公告）`
      : r.ck === 'final' ? `現金 ${fmtNum(r.cash)} 元（投信公告）` : `現金 ${fmtNum(r.cash)} 元`);
  }
  if (r.stock) parts.push(`配股率 ${fmtNum(r.stock)}`);
  if (r.cap) parts.push(`現金增資 每千股認購 ${fmtNum(r.cap * 1000)} 股${r.capPx ? `・認購價 ${fmtNum(r.capPx)} 元` : ''}`);
  if (!parts.length) parts.push(r.k.includes('息') ? '金額待公告' : '');
  if (r.pay) parts.push(`${Number(r.pay.slice(5, 7))}/${Number(r.pay.slice(8, 10))} 發放`);
  return {
    d: r.d, kind: 'exdiv', code: r.code,
    title: `${r.name} 除${r.k}${r.cap ? (r.stock ? '（配股＋現金增資）' : '（現金增資）') : ''}`,
    detail: parts.filter(Boolean).join('・') + `（${r.m === 'twse' ? '上市' : '上櫃'}）`,
  };
}

export function meetingEvent(r: MeetingRow): CalEvent {
  return {
    d: r.d, kind: 'meeting', code: r.code,
    title: `${r.name} 股東${r.k}`,
    detail: [r.elect ? '改選董監' : '', r.place].filter(Boolean).join('・'),
  };
}

/** 合併所有事件並依日期排序（同一天：公告事件在前、規則事件在後，再依代號）。 */
export function allEvents(data: CalendarData | null, from: string, to: string): CalEvent[] {
  const list: CalEvent[] = [];
  if (data) {
    for (const r of data.exdiv) list.push(exdivEvent(r));
    // 投信已經公告、交易所預告表還沒列出的 ETF 除息，也要出現（公告通常比預告表早幾天）
    const listed = new Set(data.exdiv.map(r => `${r.code}|${r.d}`));
    for (const n of data.notices ?? []) {
      const key = `${n.code}|${n.ex}`;
      if (n.ck === 'none' || listed.has(key)) continue;
      list.push(exdivEvent({
        d: n.ex, code: n.code, name: n.name || n.code, k: '息', cash: n.cash, stock: null,
        m: 'twse', ck: n.ck, pay: data.pay?.[key] ?? n.pay,
      }));
    }
    for (const r of data.meetings) list.push(meetingEvent(r));
  }
  list.push(...ruleEvents(from, to));
  const rank = (e: CalEvent) => (e.code ? 0 : 1);
  return list
    .filter(e => e.d >= from && e.d <= to)
    .sort((a, b) => a.d.localeCompare(b.d) || rank(a) - rank(b)
      || (a.code ?? '').localeCompare(b.code ?? ''));
}

export interface CalFilter {
  kinds: ReadonlySet<EventKind>;
  query: string;
  /** 只看這些代號（收藏＋配息持股）；null 表示不限。規則事件不受影響，一律顯示。 */
  mine: ReadonlySet<string> | null;
}

export function filterEvents(list: CalEvent[], f: CalFilter): CalEvent[] {
  const q = f.query.trim().toLowerCase();
  return list.filter(e => {
    if (!f.kinds.has(e.kind)) return false;
    if (f.mine && e.code && !f.mine.has(e.code)) return false;
    if (q && !(e.code ?? '').toLowerCase().includes(q) && !e.title.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
}

export function groupByDate(list: CalEvent[]): Array<{ d: string; items: CalEvent[] }> {
  const out: Array<{ d: string; items: CalEvent[] }> = [];
  for (const e of list) {
    const last = out[out.length - 1];
    if (last && last.d === e.d) last.items.push(e);
    else out.push({ d: e.d, items: [e] });
  }
  return out;
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

/** '2026-10-08' -> '10/8（四）' */
export function dayLabel(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WEEKDAY[t.getUTCDay()]}）`;
}

/** 距今天幾天（今天 0、明天 1）。 */
export function daysUntil(d: string, today: string): number {
  return Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/* ───────────── ETF 除息月曆 ─────────────
 *
 * 行事曆的除權息（calendar.json 的 exdiv）是交易所「預告」，只列還沒到的日子，股票與 ETF 混在一起；
 * 想看「這個月有哪幾檔 ETF 除息」還需要已經除息的那幾天，所以再合併 dividends.json（交易所公告的
 * 配息紀錄，累積式，含已除息與已公告未除息）。同一檔同一天兩邊都有時只留一筆，金額以配息紀錄為準
 * （預告的金額可能還沒公布）。
 */

export interface EtfExDivRow {
  d: string;
  code: string;
  name: string;
  /** 每股現金；null＝交易所預告了日期但金額還沒公布 */
  cash: number | null;
  /** false＝那次是「權息」合併計價、拆不出現金部分，金額會高估 */
  exact: boolean;
  /** 配息頻率（etfs.json），沒有就是 null */
  freq: string | null;
  /** 保管銀行（etfs.json 的 cust），沒有就是 null */
  cust: string | null;
  /** 金額來自投信公告而不是交易所：'est' 預估、'final' 實際 */
  ck?: 'est' | 'final';
  /** 收益分配發放日；不知道是 null */
  pay: string | null;
}

export interface EtfInfo { name: string; freq: string | null; cust?: string | null }

/** 台股 ETF 代號都是 00 開頭（0050、00878、00940B、00400A）。個股不收。 */
const ETF_CODE = /^00\d{2,4}[A-Z]?$/;

/**
 * 某個月（'YYYY-MM'）所有 ETF 的除息，依日期、代號排序。
 * etfs：代號 -> 名稱與頻率（etfs.json）；不在清單裡但代號像 ETF 的，名稱改用預告上的。
 */
export function etfExDivMonth(
  month: string,
  dividends: Record<string, [string, number, number][]> | null,
  calendar: CalendarData | null,
  etfs: ReadonlyMap<string, EtfInfo>,
): EtfExDivRow[] {
  const rows = new Map<string, EtfExDivRow>();
  const isEtf = (code: string) => etfs.has(code) || ETF_CODE.test(code);
  for (const [code, evs] of Object.entries(dividends ?? {})) {
    if (!isEtf(code)) continue;
    for (const [d, cash, exact] of evs) {
      if (!d.startsWith(month)) continue;
      const info = etfs.get(code);
      rows.set(`${code}|${d}`, {
        d, code, name: info?.name ?? code, cash, exact: exact === 1, freq: info?.freq ?? null,
        cust: info?.cust ?? null, pay: null,
      });
    }
  }
  for (const r of calendar?.exdiv ?? []) {
    if (!r.d.startsWith(month) || !isEtf(r.code) || !r.k.includes('息')) continue;
    const key = `${r.code}|${r.d}`;
    const had = rows.get(key);
    if (had) {
      if (had.cash === null && r.cash) { had.cash = r.cash; had.ck = r.ck; }
      continue;
    }
    const info = etfs.get(r.code);
    rows.set(key, {
      d: r.d, code: r.code, name: info?.name ?? r.name, cash: r.cash ?? null,
      exact: true, freq: info?.freq ?? null, cust: info?.cust ?? null, ck: r.ck, pay: null,
    });
  }
  // 投信公告：交易所兩份資料都還沒有金額時補上；預告表還沒列出的除息也補一列
  for (const n of calendar?.notices ?? []) {
    if (!n.ex.startsWith(month) || !isEtf(n.code) || n.ck === 'none') continue;
    const key = `${n.code}|${n.ex}`;
    const had = rows.get(key);
    if (had) {
      if (had.cash === null) { had.cash = n.cash; had.ck = n.ck; }
      continue;
    }
    const info = etfs.get(n.code);
    rows.set(key, {
      d: n.ex, code: n.code, name: info?.name ?? (n.name || n.code), cash: n.cash, exact: true,
      freq: info?.freq ?? null, cust: info?.cust ?? null, ck: n.ck, pay: null,
    });
  }
  const notice = new Map((calendar?.notices ?? []).map(n => [`${n.code}|${n.ex}`, n]));
  for (const [key, r] of rows) {
    r.pay = calendar?.pay?.[key] ?? notice.get(key)?.pay ?? null;
  }
  return [...rows.values()].sort((a, b) => a.d.localeCompare(b.d) || a.code.localeCompare(b.code));
}

/** 'YYYY-MM' 加減 n 個月。 */
export function shiftMonth(month: string, n: number): string {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/**
 * 每一檔「已公告、還沒除息」的下一次配息（今天含以後最近的一次，要有金額）。
 * 交易所預告表優先（它有金額時就是正式的）；預告表還沒列出或還沒金額的，用投信公告。
 * 配息試算拿它來提前反映剛公布的金額（lib/dividend.ts 的 withUpcoming）。
 */
export function upcomingByCode(
  cal: CalendarData | null, today: string,
): Map<string, { d: string; cash: number; ck?: 'est' | 'final'; pay?: string | null }> {
  const out = new Map<string, { d: string; cash: number; ck?: 'est' | 'final'; pay?: string | null }>();
  if (!cal) return out;
  const put = (code: string, v: { d: string; cash: number; ck?: 'est' | 'final'; pay?: string | null }) => {
    const had = out.get(code);
    if (!had || v.d < had.d) out.set(code, v);
  };
  const listed = new Set<string>();
  for (const r of cal.exdiv) {
    if (r.d < today || !r.k.includes('息')) continue;
    listed.add(`${r.code}|${r.d}`);
    if (r.cash && r.cash > 0) {
      put(r.code, { d: r.d, cash: r.cash, ck: r.ck, pay: r.pay ?? cal.pay?.[`${r.code}|${r.d}`] ?? null });
    }
  }
  for (const n of cal.notices ?? []) {
    const key = `${n.code}|${n.ex}`;
    if (n.ex < today || n.ck === 'none' || !(n.cash > 0) || listed.has(key)) continue;
    put(n.code, { d: n.ex, cash: n.cash, ck: n.ck, pay: cal.pay?.[key] ?? n.pay });
  }
  return out;
}
